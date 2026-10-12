import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { after, before, beforeEach, test } from "node:test";

import { Keypair } from "@stellar/stellar-sdk/base";

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
  const service = new TestnetIssuanceService(sql, {
    network: "testnet",
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
      "TRUNCATE project_issuance_intents, project_profile_owners, project_profiles, workflow_intents CASCADE",
    );
  });

  after(async () => {
    await sql.end({ timeout: 5 });
  });

  async function makeProject(code = "NOVA") {
    const outcome = await projectService.createManagedProject({
      ownerPublicKey: OWNER,
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
  ) {
    return {
      ownerPublicKey: OWNER,
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
    const second = await makeProject();
    const results = await Promise.allSettled([
      service.request(input(first.projectId)),
      service.request(input(second.projectId)),
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
}
