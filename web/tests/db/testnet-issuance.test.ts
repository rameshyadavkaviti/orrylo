import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { after, before, beforeEach, test } from "node:test";

import { Keypair } from "@stellar/stellar-sdk/base";

import { PostgresAuditRepository } from "../../lib/server/persistence/audit-repository";
import { createDatabaseClient } from "../../lib/server/persistence/database";
import { migrateDatabase } from "../../lib/server/persistence/migrations";
import { ManagedProjectService } from "../../lib/server/projects/managed-project-service";
import {
  TestnetIssuanceError,
  TestnetIssuanceService,
} from "../../lib/server/projects/testnet-issuance-service";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL?.trim();

if (!TEST_DATABASE_URL) {
  test("Testnet issuance PostgreSQL suite", { skip: true }, () => {});
} else {
  const databaseUrl = TEST_DATABASE_URL;
  const sql = createDatabaseClient(databaseUrl);
  const OWNER = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 91)).publicKey();
  const OTHER = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 92)).publicKey();
  const NOW = Date.parse("2026-10-12T08:00:00.000Z");
  const ISSUER = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 93)).publicKey();
  const ISSUER2 = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 94)).publicKey();
  const service = new TestnetIssuanceService(sql, {
    network: "testnet",
    approvedIssuerPublicKey: ISSUER,
    now: () => NOW,
  });
  const projectService = new ManagedProjectService(sql, {
    network: "testnet",
    now: () => NOW,
  });

  before(async () => {
    if (!/test/i.test(new URL(databaseUrl).pathname.slice(1))) {
      throw new Error(
        "TEST_DATABASE_URL must point to an isolated test database.",
      );
    }
    await sql.unsafe("DROP SCHEMA public CASCADE");
    await sql.unsafe("CREATE SCHEMA public");
    await migrateDatabase(sql, resolve(process.cwd(), "db/migrations"));
  });

  beforeEach(async () => {
    await sql.unsafe(
      "TRUNCATE project_issuance_intents, project_profile_owners, project_profiles, workflow_intents, audit_events CASCADE",
    );
    await sql`UPDATE audit_chain_heads SET last_sequence = 0, last_event_hash = NULL WHERE chain_id = 'application'`;
  });

  after(async () => {
    await sql.end({ timeout: 5 });
  });

  async function makeProject(code = "NOVA", ownerPublicKey = OWNER) {
    const outcome = await projectService.createManagedProject({
      ownerPublicKey,
      idempotencyKey: randomUUID(),
      code,
      displayName: "Test token",
      description: "A private test project.",
    });
    return outcome.project;
  }

  function input(
    projectId: string,
    idempotencyKey = randomUUID(),
    expectedAssetCode = "NOVA",
    ownerPublicKey = OWNER,
  ) {
    return {
      ownerPublicKey,
      projectId,
      idempotencyKey,
      expectedAssetCode,
    };
  }

  test("a new project has no issuance and first request has no fabricated evidence", async () => {
    const project = await makeProject();
    assert.equal(await service.getOwnedStatus(project.projectId, OWNER), null);
    const result = await service.request(input(project.projectId));
    assert.equal(result.created, true);
    assert.equal(result.issuance.status, "awaiting_issuer_integration");
    assert.equal(result.issuance.reservationIssuerPublicKey, ISSUER);
    assert.match(result.issuance.reservationFingerprint, /^[a-f0-9]{64}$/);
    assert.equal(result.issuance.issuerPublicKey, null);
    assert.equal(result.issuance.transactionHash, null);
    assert.equal(result.issuance.ledgerSequence, null);
    assert.equal(result.issuance.failureCode, null);

    const [workflow] = await sql<
      { state: string; onchain_reference: string | null }[]
    >`
      SELECT state, onchain_reference FROM workflow_intents
      WHERE request_id = ${result.issuance.requestId}
    `;
    assert.equal(workflow?.state, "created");
    assert.equal(workflow?.onchain_reference, null);
  });

  test("concurrent replay of one idempotency key creates exactly one issuance", async () => {
    const project = await makeProject();
    const same = input(project.projectId);
    const results = await Promise.all([
      service.request(same),
      service.request(same),
    ]);
    assert.equal(results.filter((result) => result.created).length, 1);
    assert.equal(results[0].issuance.requestId, results[1].issuance.requestId);
    const [{ count }] = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count FROM project_issuance_intents
    `;
    assert.equal(count, "1");
  });

  test("distinct request IDs cannot fork one project's issuance", async () => {
    const project = await makeProject();
    await service.request(input(project.projectId));
    await assert.rejects(
      service.request(input(project.projectId)),
      (error: unknown) =>
        error instanceof TestnetIssuanceError &&
        error.code === "issuance_already_requested",
    );
  });

  test("same idempotency key rejects changes to the canonical project payload", async () => {
    const project = await makeProject();
    const same = input(project.projectId);
    await service.request(same);
    await sql`UPDATE project_profiles SET asset_code = 'CHANGED', updated_at = ${new Date(NOW + 1)} WHERE project_id = ${project.projectId}`;
    await assert.rejects(
      service.request({ ...same, expectedAssetCode: "CHANGED" }),
      (error: unknown) =>
        error instanceof TestnetIssuanceError &&
        error.code === "idempotency_conflict",
    );
  });

  test("concurrent requests from different projects cannot reserve the same asset code", async () => {
    const first = await makeProject();
    const second = await makeProject("NOVA", OTHER);
    const results = await Promise.allSettled([
      service.request(input(first.projectId)),
      service.request(input(second.projectId, randomUUID(), "NOVA", OTHER)),
    ]);
    assert.equal(
      results.filter((result) => result.status === "fulfilled").length,
      1,
    );
    const rejected = results.find((result) => result.status === "rejected");
    assert.ok(rejected && rejected.status === "rejected");
    assert.ok(rejected.reason instanceof TestnetIssuanceError);
    assert.equal(rejected.reason.code, "asset_code_reserved");
  });

  test("non-owner and nonexistent projects never reveal or reserve an intent", async () => {
    const project = await makeProject();
    await assert.rejects(
      service.getOwnedStatus(project.projectId, OTHER),
      (error: unknown) =>
        error instanceof TestnetIssuanceError &&
        error.code === "project_not_found",
    );
    await assert.rejects(
      service.request({ ...input(project.projectId), ownerPublicKey: OTHER }),
      (error: unknown) =>
        error instanceof TestnetIssuanceError &&
        error.code === "project_not_found",
    );
    const [{ count }] = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count FROM project_issuance_intents
    `;
    assert.equal(count, "0");
  });

  test("only a Testnet Shared Issuer project with valid config may request", async () => {
    const project = await makeProject();
    const mainnet = new TestnetIssuanceService(sql, { network: "public" });
    await assert.rejects(
      mainnet.request(input(project.projectId)),
      (error: unknown) =>
        error instanceof TestnetIssuanceError &&
        error.code === "unsupported_network",
    );
    await sql`UPDATE project_profiles SET network = 'public' WHERE project_id = ${project.projectId}`;
    await assert.rejects(
      service.request(input(project.projectId)),
      (error: unknown) =>
        error instanceof TestnetIssuanceError &&
        error.code === "unsupported_network",
    );
    await sql`UPDATE project_profiles SET network = 'testnet', issuer_model = 'dedicated' WHERE project_id = ${project.projectId}`;
    await assert.rejects(
      service.request(input(project.projectId)),
      (error: unknown) =>
        error instanceof TestnetIssuanceError &&
        error.code === "ineligible_project",
    );
    await sql`UPDATE project_profiles SET issuer_model = 'shared', display_name = ${"X".repeat(50)} WHERE project_id = ${project.projectId}`;
    await assert.rejects(
      service.request(input(project.projectId)),
      (error: unknown) =>
        error instanceof TestnetIssuanceError &&
        error.code === "invalid_asset_configuration",
    );
  });

  test("database refuses confirmation without evidence and submission without a hash", async () => {
    const project = await makeProject();
    const result = await service.request(input(project.projectId));
    await assert.rejects(sql`
      UPDATE project_issuance_intents SET status = 'confirmed'
      WHERE request_id = ${result.issuance.requestId}
    `);
    await assert.rejects(sql`
      UPDATE project_issuance_intents SET status = 'submitted'
      WHERE request_id = ${result.issuance.requestId}
    `);
    assert.equal(
      (await service.getOwnedStatus(project.projectId, OWNER))?.status,
      "awaiting_issuer_integration",
    );
  });

  test("issuer remains unselected until explicitly configured on the server", async () => {
    const project = await makeProject();
    const unavailable = new TestnetIssuanceService(sql, { network: "testnet" });
    await assert.rejects(
      unavailable.request(input(project.projectId)),
      (error: unknown) =>
        error instanceof TestnetIssuanceError && error.code === "issuer_integration_unavailable",
    );
    const [{ count }] = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count FROM project_issuance_intents
    `;
    assert.equal(count, "0");
  });

  test("reservation is scoped to the explicitly approved issuer identity", async () => {
    const project1 = await makeProject();
    const project2 = await makeProject("NOVA", OTHER);
    const secondIssuer = new TestnetIssuanceService(sql, {
      network: "testnet",
      approvedIssuerPublicKey: ISSUER2,
      now: () => NOW,
    });
    const first = await service.request(input(project1.projectId));
    const second = await secondIssuer.request(
      input(project2.projectId, randomUUID(), "NOVA", OTHER),
    );
    assert.notEqual(first.issuance.requestId, second.issuance.requestId);
    assert.equal(first.issuance.reservationIssuerPublicKey, ISSUER);
    assert.equal(second.issuance.reservationIssuerPublicKey, ISSUER2);
  });

  test("one outstanding reservation per wallet bounds speculative code squatting", async () => {
    const one = await makeProject("ONE");
    const two = await makeProject("TWO");
    await service.request(input(one.projectId, randomUUID(), "ONE"));
    await assert.rejects(
      service.request(input(two.projectId, randomUUID(), "TWO")),
      (error: unknown) =>
        error instanceof TestnetIssuanceError && error.code === "reservation_limit_reached",
    );
  });

  test("reservation identity and workflow fingerprint are immutable in PostgreSQL", async () => {
    const project = await makeProject();
    const created = await service.request(input(project.projectId));
    const id = created.issuance.requestId;
    for (const mutation of [
      sql`UPDATE project_issuance_intents SET asset_code = 'MUTANT' WHERE request_id = ${id}`,
      sql`UPDATE project_issuance_intents SET reservation_issuer_public_key = ${ISSUER2} WHERE request_id = ${id}`,
      sql`UPDATE project_issuance_intents SET reservation_fingerprint = ${"f".repeat(64)} WHERE request_id = ${id}`,
      sql`UPDATE workflow_intents SET payload_hash = ${"a".repeat(64)} WHERE request_id = ${id}`,
      sql`UPDATE workflow_intents SET payload = ${sql.json({ hacked: true })} WHERE request_id = ${id}`,
    ]) {
      await assert.rejects(mutation);
    }
    const loaded = await service.getOwnedStatus(project.projectId, OWNER);
    assert.equal(loaded?.reservationFingerprint, created.issuance.reservationFingerprint);
    assert.equal(loaded?.reservationIssuerPublicKey, ISSUER);
    assert.equal(loaded?.assetCode, "NOVA");
  });

  test("each created reservation appends two linked audit events; replay is audit-idempotent", async () => {
    const project = await makeProject();
    const same = input(project.projectId);
    const created = await service.request(same);
    const replay = await service.request(same);
    assert.equal(replay.created, false);
    assert.equal(replay.issuance.requestId, created.issuance.requestId);
    const events = await new PostgresAuditRepository(sql).list();
    assert.deepEqual(events.map((event) => event.eventType), [
      "SHARED_ISSUANCE_INTENT_CREATED",
      "SHARED_ISSUANCE_ASSET_CODE_RESERVED",
    ]);
    for (const event of events) {
      assert.equal(event.requestId, created.issuance.requestId);
      assert.equal(event.targetPublicKey, OWNER);
      assert.equal(event.metadata.projectId, project.projectId);
      assert.equal(event.metadata.assetCode, "NOVA");
    }
    assert.equal(await new PostgresAuditRepository(sql).verifyChain(), true);
  });

  test("audit append failure rolls back workflow and issuer-scoped reservation", async () => {
    const project = await makeProject();
    await sql`DELETE FROM audit_chain_heads WHERE chain_id = 'application'`;
    await assert.rejects(service.request(input(project.projectId)));
    const [{ reserveCount }] = await sql<{ reserveCount: string }[]>`
      SELECT count(*)::text AS "reserveCount" FROM project_issuance_intents
    `;
    const [{ workflowCount }] = await sql<{ workflowCount: string }[]>`
      SELECT count(*)::text AS "workflowCount" FROM workflow_intents
      WHERE workflow_type = 'shared_asset_issuance'
    `;
    assert.equal(reserveCount, "0");
    assert.equal(workflowCount, "0");
    await sql`INSERT INTO audit_chain_heads (chain_id, last_sequence, last_event_hash)
      VALUES ('application', 0, NULL)`;
  });

  test("independent competing requests for one project commit only one workflow and audit pair", async () => {
    const project = await makeProject();
    const results = await Promise.allSettled([
      service.request(input(project.projectId)),
      service.request(input(project.projectId)),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    const rejected = results.find((r) => r.status === "rejected");
    assert.ok(rejected && rejected.status === "rejected");
    assert.ok(rejected.reason instanceof TestnetIssuanceError);
    assert.equal(rejected.reason.code, "issuance_already_requested");
    const [{ workflowCount }] = await sql<{ workflowCount: string }[]>`
      SELECT count(*)::text AS "workflowCount" FROM workflow_intents
      WHERE workflow_type = 'shared_asset_issuance'
    `;
    assert.equal(workflowCount, "1");
    assert.equal((await new PostgresAuditRepository(sql).list()).length, 2);
  });

  test("replay under changed issuer configuration fails instead of rebinding identity", async () => {
    const project = await makeProject();
    const same = input(project.projectId);
    await service.request(same);
    const other = new TestnetIssuanceService(sql, {
      network: "testnet",
      approvedIssuerPublicKey: ISSUER2,
    });
    await assert.rejects(
      other.request(same),
      (error: unknown) =>
        error instanceof TestnetIssuanceError && error.code === "idempotency_conflict",
    );
    assert.equal((await service.getOwnedStatus(project.projectId, OWNER))?.reservationIssuerPublicKey, ISSUER);
  });
}
