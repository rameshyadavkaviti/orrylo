import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { after, before, beforeEach, test } from "node:test";

import { Keypair } from "@stellar/stellar-sdk/base";

import {
  renderSharedTestnetToml,
  type MetadataPublicationState,
} from "../../lib/projects/metadata-publication";
import { hashJson } from "../../lib/persistence/json";
import { PostgresAuditRepository } from "../../lib/server/persistence/audit-repository";
import { createDatabaseClient } from "../../lib/server/persistence/database";
import { migrateDatabase } from "../../lib/server/persistence/migrations";
import { PostgresMetadataPublicationRepository } from "../../lib/server/persistence/metadata-publication-repository";
import { PostgresProjectProfileRepository } from "../../lib/server/persistence/project-profile-repository";
import {
  MetadataPublicationError,
  MetadataPublicationService,
} from "../../lib/server/projects/metadata-publication-service";
import type {
  MetadataPublicationVerifier,
  MetadataVerificationResult,
} from "../../lib/server/projects/metadata-publication-verifier";
import { ManagedProjectService } from "../../lib/server/projects/managed-project-service";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL?.trim();

if (!TEST_DATABASE_URL) {
  test("metadata publication PostgreSQL suite", { skip: true }, () => {});
} else {
  const databaseUrl = TEST_DATABASE_URL;
  const sql = createDatabaseClient(databaseUrl);
  const migrationsDirectory = resolve(process.cwd(), "db/migrations");
  const OWNER = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 81)).publicKey();
  const OTHER = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 82)).publicKey();
  const ISSUER = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 83)).publicKey();
  const ARBITRARY = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 84)).publicKey();
  const NOW = Date.parse("2026-10-09T12:00:00.000Z");
  let clock = NOW;

  const successVerifier: MetadataPublicationVerifier = {
    verify: async () => ({ ok: true }),
  };

  before(async () => {
    const databaseName = new URL(databaseUrl).pathname.slice(1);

    if (!/test/i.test(databaseName)) {
      throw new Error(
        "TEST_DATABASE_URL must point to a database whose name contains 'test'.",
      );
    }

    await sql.unsafe("DROP SCHEMA public CASCADE");
    await sql.unsafe("CREATE SCHEMA public");
    await migrateDatabase(sql, migrationsDirectory);
    // An isolated Testnet fixture simulates future reviewed migration 007.
    // This does not create an asset, execute a Stellar transaction, or claim
    // production issuer authorization. Production 006 has no writer for 007.
    await sql.unsafe(`
      CREATE TABLE project_issuance_intents (
        project_id uuid PRIMARY KEY REFERENCES project_profiles(project_id),
        request_id uuid UNIQUE NOT NULL REFERENCES workflow_intents(request_id),
        owner_public_key char(56) NOT NULL,
        network text NOT NULL,
        asset_code varchar(12) NOT NULL,
        reservation_issuer_public_key char(56) NOT NULL,
        reservation_fingerprint char(64) NOT NULL,
        status text NOT NULL,
        issuer_public_key char(56),
        transaction_hash char(64),
        ledger_sequence bigint,
        UNIQUE (network, reservation_issuer_public_key, asset_code)
      )
    `);
  });

  beforeEach(async () => {
    clock = NOW;
    await sql.unsafe(
      "TRUNCATE project_metadata_publications, project_issuance_intents, audit_events, project_profile_owners, project_profiles, workflow_intents CASCADE",
    );
    await sql`UPDATE audit_chain_heads SET last_sequence = 0,
      last_event_hash = NULL WHERE chain_id = 'application'`;
  });

  after(async () => {
    await sql.end({ timeout: 5 });
  });

  test("owner publishes an eligible Shared Issuer Testnet snapshot without publishing the landing page", async () => {
    const project = await createEligibleProject({
      code: "NOVA",
      displayName: "Nova",
      idempotencyKey: "11111111-1111-4111-8111-111111111111",
    });
    const service = publicationService(successVerifier);
    const result = await service.publishOwnedProject(project.projectId, OWNER);

    assert.equal(result.status, "verified");
    assert.equal(result.changed, true);
    assert.equal(result.publication.reachable, true);
    assert.ok(result.publication.verifiedAt);
    assert.equal(result.publication.revision, 1);

    const projectRepository = new PostgresProjectProfileRepository(sql);
    const managed = await projectRepository.findOwnedById(
      project.projectId,
      OWNER,
    );
    assert.equal(managed?.publicStatus, "draft");

    const publicationRepository = new PostgresMetadataPublicationRepository(
      sql,
      ISSUER,
    );
    const publications =
      await publicationRepository.listSharedTestnetPublications();
    assert.equal(publications.length, 1);
    assert.equal(publications[0]?.projectId, project.projectId);
  });

  test("non-owner cannot publish and creates no publication row", async () => {
    const project = await createEligibleProject({
      code: "NOVA",
      displayName: "Nova",
      idempotencyKey: "22222222-2222-4222-8222-222222222222",
    });
    const service = publicationService(successVerifier);

    await assert.rejects(
      service.publishOwnedProject(project.projectId, OTHER),
      (error: unknown) =>
        error instanceof MetadataPublicationError &&
        error.code === "project_not_found",
    );

    const [{ count }] = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count
      FROM project_metadata_publications
    `;
    assert.equal(count, "0");
  });

  test("unpublished project metadata is absent from the public Shared Issuer aggregate", async () => {
    await createEligibleProject({
      code: "NOVA",
      displayName: "Nova",
      idempotencyKey: "33333333-3333-4333-8333-333333333333",
    });

    const repository = new PostgresMetadataPublicationRepository(sql, ISSUER);
    assert.deepEqual(await repository.listSharedTestnetPublications(), []);
    assert.equal(renderSharedTestnetToml([]), "");
  });

  test("eight concurrent identical publications are idempotent at revision one", async () => {
    const project = await createEligibleProject({
      code: "NOVA",
      displayName: "Nova",
      idempotencyKey: "44444444-4444-4444-8444-444444444444",
    });
    const service = publicationService(successVerifier);

    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        service.publishOwnedProject(project.projectId, OWNER),
      ),
    );

    assert.equal(results.filter((result) => result.changed).length, 1);
    assert.equal(
      new Set(results.map((result) => result.publication.contentHash)).size,
      1,
    );

    const repository = new PostgresMetadataPublicationRepository(sql, ISSUER);
    const publication = await repository.getByProjectId(project.projectId);
    assert.ok(publication);
    assert.equal(publication.revision, 1);
    assert.equal(publication.reachable, true);

    const [{ count }] = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count
      FROM project_metadata_publications
      WHERE project_id = ${project.projectId}
    `;
    assert.equal(count, "1");
  });

  test("two Shared Issuer projects publish concurrently without losing either TOML entry", async () => {
    const alpha = await createEligibleProject({
      code: "ALPHA",
      displayName: "Alpha",
      idempotencyKey: "55555555-5555-4555-8555-555555555555",
    });
    const nova = await createEligibleProject({
      code: "NOVA",
      displayName: "Nova",
      idempotencyKey: "66666666-6666-4666-8666-666666666666",
    });
    const service = publicationService(successVerifier);

    await Promise.all([
      service.publishOwnedProject(nova.projectId, OWNER),
      service.publishOwnedProject(alpha.projectId, OWNER),
    ]);

    const repository = new PostgresMetadataPublicationRepository(sql, ISSUER);
    const publications = await repository.listSharedTestnetPublications();

    assert.equal(publications.length, 2);
    assert.deepEqual(
      publications.map((item) => item.assetCode),
      ["ALPHA", "NOVA"],
    );

    const content = renderSharedTestnetToml(publications);
    assert.match(content, /code = "ALPHA"/);
    assert.match(content, /code = "NOVA"/);
    assert.equal(
      content.split("\n").filter((line) => line === "[[CURRENCIES]]").length,
      2,
    );
  });

  test("metadata edits do not alter the published snapshot until republish and republish preserves other assets", async () => {
    const alpha = await createEligibleProject({
      code: "ALPHA",
      displayName: "Alpha",
      idempotencyKey: "77777777-7777-4777-8777-777777777777",
    });
    const nova = await createEligibleProject({
      code: "NOVA",
      displayName: "Nova",
      idempotencyKey: "88888888-8888-4888-8888-888888888888",
    });
    const service = publicationService(successVerifier);

    await service.publishOwnedProject(alpha.projectId, OWNER);
    await service.publishOwnedProject(nova.projectId, OWNER);

    const publicationRepository = new PostgresMetadataPublicationRepository(
      sql,
      ISSUER,
    );
    const before = await publicationRepository.getByProjectId(alpha.projectId);
    assert.ok(before);

    const profileRepository = new PostgresProjectProfileRepository(sql);
    clock += 10;
    await profileRepository.updateOwnedMetadata(
      alpha.projectId,
      OWNER,
      {
        displayName: "Alpha Updated",
        description: "New canonical metadata.",
        logoUrl: null,
        websiteUrl: null,
        communityUrl: null,
      },
      clock,
    );

    const stillPublished = await publicationRepository.getByProjectId(
      alpha.projectId,
    );
    assert.equal(stillPublished?.currencyToml, before.currencyToml);
    assert.doesNotMatch(stillPublished?.currencyToml ?? "", /Alpha Updated/);

    clock += 10;
    const republished = await service.publishOwnedProject(
      alpha.projectId,
      OWNER,
    );
    assert.equal(republished.changed, true);
    assert.equal(republished.publication.revision, 2);
    assert.match(republished.publication.currencyToml, /Alpha Updated/);

    const all = await publicationRepository.listSharedTestnetPublications();
    assert.equal(all.length, 2);
    assert.match(renderSharedTestnetToml(all), /code = "NOVA"/);
  });

  test("verification failure leaves a durable published but unreachable snapshot and retry verifies it without a new revision", async () => {
    const project = await createEligibleProject({
      code: "NOVA",
      displayName: "Nova",
      idempotencyKey: "99999999-9999-4999-8999-999999999999",
    });
    const failureVerifier = verifierResult({
      ok: false,
      code: "request_failed",
    });
    const failed = await publicationService(
      failureVerifier,
    ).publishOwnedProject(project.projectId, OWNER);

    assert.equal(failed.status, "published_not_reachable");
    assert.equal(failed.publication.reachable, false);
    assert.equal(failed.publication.verifiedAt, null);
    assert.equal(failed.publication.verificationErrorCode, "request_failed");
    assert.equal(failed.publication.revision, 1);

    clock += 10;
    const retried = await publicationService(
      successVerifier,
    ).publishOwnedProject(project.projectId, OWNER);

    assert.equal(retried.status, "verified");
    assert.equal(retried.changed, false);
    assert.equal(retried.publication.revision, 1);
    assert.equal(retried.publication.reachable, true);
    assert.ok(retried.publication.verifiedAt);
  });

  test("same Shared Issuer asset identity cannot be claimed by two projects", async () => {
    const first = await createEligibleProject({
      code: "NOVA",
      displayName: "First Nova",
      idempotencyKey: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
    });
    const second = await createEligibleProject({
      code: "NOVA",
      displayName: "Second Nova",
      idempotencyKey: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
      skipProvenance: true,
    });
    const service = publicationService(successVerifier);

    await service.publishOwnedProject(first.projectId, OWNER);

    await assert.rejects(
      service.publishOwnedProject(second.projectId, OWNER),
      (error: unknown) =>
        error instanceof MetadataPublicationError &&
        error.code === "issuer_provenance_unavailable",
    );

    const repository = new PostgresMetadataPublicationRepository(sql, ISSUER);
    assert.equal((await repository.listSharedTestnetPublications()).length, 1);
  });

  test("Dedicated Issuer and Mainnet projects are never routed through the Shared Issuer Testnet publisher", async () => {
    const dedicated = await createEligibleProject({
      code: "DED",
      displayName: "Dedicated",
      idempotencyKey: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
    });
    await sql`
      UPDATE project_profiles
      SET issuer_model = 'dedicated', metadata_home = NULL
      WHERE project_id = ${dedicated.projectId}
    `;

    const publicNetwork = await createEligibleProject({
      code: "MAIN",
      displayName: "Mainnet",
      idempotencyKey: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2",
      network: "public",
    });

    const service = publicationService(successVerifier);

    await assert.rejects(
      service.publishOwnedProject(dedicated.projectId, OWNER),
      (error: unknown) =>
        error instanceof MetadataPublicationError &&
        error.code === "unsupported_issuer_model",
    );
    await assert.rejects(
      service.publishOwnedProject(publicNetwork.projectId, OWNER),
      (error: unknown) =>
        error instanceof MetadataPublicationError &&
        error.code === "unsupported_network",
    );

    const repository = new PostgresMetadataPublicationRepository(sql, ISSUER);
    assert.deepEqual(await repository.listSharedTestnetPublications(), []);
  });

  test("stale verification hash cannot mark a newer publication reachable", async () => {
    const project = await createEligibleProject({
      code: "NOVA",
      displayName: "Nova",
      idempotencyKey: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1",
    });
    const failed = await publicationService(
      verifierResult({ ok: false, code: "content_mismatch" }),
    ).publishOwnedProject(project.projectId, OWNER);

    const repository = new PostgresMetadataPublicationRepository(sql, ISSUER);
    const stale = await repository.markVerifiedIfCurrent({
      projectId: project.projectId,
      contentHash: "0".repeat(64),
      now: clock + 1,
    });

    assert.equal(stale, null);
    assert.equal(
      (await repository.getByProjectId(project.projectId))?.contentHash,
      failed.publication.contentHash,
    );
    assert.equal(
      (await repository.getByProjectId(project.projectId))?.reachable,
      false,
    );
  });


  async function recordSyntheticConfirmedProvenance(
    projectId: string,
    assetCode: string,
    issuer = ISSUER,
    owner = OWNER,
  ) {
    const requestId = randomUUID();
    const payload = {
      projectId,
      network: "testnet",
      issuerModel: "shared",
      assetCode,
      issuerPublicKey: issuer,
      preparationPolicyVersion: "shared-issuer-testnet-v1",
    };
    const fingerprint = hashJson({
      workflowType: "shared_asset_issuance",
      subjectPublicKey: owner,
      policyVersion: "testnet-shared-issuance-foundation-v2",
      payload,
    });
    await sql`
      INSERT INTO workflow_intents (
        request_id, workflow_scope, workflow_type, subject_public_key,
        state, idempotency_key, payload_hash, payload,
        created_at, updated_at, policy_version
      ) VALUES (
        ${requestId}, 'asset:testnet-shared-issuance', 'shared_asset_issuance',
        ${owner}, 'confirmed', ${requestId}, ${fingerprint},
        ${sql.json(payload)}, ${new Date(clock)}, ${new Date(clock)},
        'testnet-shared-issuance-foundation-v2'
      )
    `;
    await sql`
      INSERT INTO project_issuance_intents (
        project_id, request_id, owner_public_key, network,
        reservation_issuer_public_key, asset_code, reservation_fingerprint,
        status, issuer_public_key, transaction_hash, ledger_sequence
      ) VALUES (
        ${projectId}, ${requestId}, ${owner}, 'testnet',
        ${issuer}, ${assetCode}, ${fingerprint},
        'confirmed', ${issuer}, ${"a".repeat(64)}, 1234
      )
    `;
    const audit = new PostgresAuditRepository(sql);
    for (const [eventType, metadata] of [
      ["SHARED_ISSUANCE_INTENT_CREATED", { projectId, assetCode, issuerPublicKey: issuer, reservationFingerprint: fingerprint, network: "testnet" }],
      ["SHARED_ISSUANCE_ASSET_CODE_RESERVED", { projectId, assetCode, issuerPublicKey: issuer, status: "awaiting_issuer_integration" }],
    ] as const) {
      await audit.append({
        eventType,
        requestId,
        source: "testnet-issuance-service",
        targetPublicKey: owner,
        policyVersion: "testnet-shared-issuance-foundation-v2",
        metadata,
        occurredAt: clock,
      });
    }
    return { requestId, fingerprint };
  }


  test("arbitrary checksum-valid issuer from mutable Project Profile is rejected", async () => {
    const project = await createEligibleProject({
      code: "NOVA",
      displayName: "Nova",
      idempotencyKey: randomUUID(),
    });
    await sql`UPDATE project_profiles SET issuer_public_key = ${ARBITRARY}
      WHERE project_id = ${project.projectId}`;
    await assert.rejects(
      publicationService(successVerifier).publishOwnedProject(project.projectId, OWNER),
      (error: unknown) => error instanceof MetadataPublicationError &&
        error.code === "issuer_provenance_mismatch",
    );
    assert.deepEqual(
      await new PostgresMetadataPublicationRepository(sql, ISSUER).listSharedTestnetPublications(),
      [],
    );
  });

  test("missing or wrong-issuer provenance fails closed even with a valid profile key", async () => {
    const project = await createEligibleProject({
      code: "NOVA",
      displayName: "Nova",
      idempotencyKey: randomUUID(),
      skipProvenance: true,
    });
    await assert.rejects(
      publicationService(successVerifier).publishOwnedProject(project.projectId, OWNER),
      (error: unknown) => error instanceof MetadataPublicationError &&
        error.code === "issuer_provenance_unavailable",
    );
    await recordSyntheticConfirmedProvenance(project.projectId, "NOVA", ARBITRARY);
    await assert.rejects(
      publicationService(successVerifier).publishOwnedProject(project.projectId, OWNER),
      (error: unknown) => error instanceof MetadataPublicationError &&
        error.code === "issuer_provenance_unavailable",
    );
  });

  test("cross-owner, wrong-network, mismatched asset code and tampered fingerprint are rejected", async () => {
    for (const mutation of [
      async (id: string) => sql`UPDATE project_issuance_intents SET owner_public_key = ${OTHER}
        WHERE project_id = ${id}`,
      async (id: string) => sql`UPDATE project_issuance_intents SET network = 'public'
        WHERE project_id = ${id}`,
      async (id: string) => sql`UPDATE project_issuance_intents SET asset_code = 'WRONG'
        WHERE project_id = ${id}`,
      async (id: string) => sql`UPDATE project_issuance_intents SET reservation_fingerprint = ${"f".repeat(64)}
        WHERE project_id = ${id}`,
    ]) {
      const project = await createEligibleProject({
        code: "NOVA", displayName: "Nova", idempotencyKey: randomUUID(),
      });
      await mutation(project.projectId);
      await assert.rejects(
        publicationService(successVerifier).publishOwnedProject(project.projectId, OWNER),
        (error: unknown) => error instanceof MetadataPublicationError &&
          error.code === "issuer_provenance_unavailable",
      );
      assert.equal(
        (await new PostgresMetadataPublicationRepository(sql, ISSUER).listSharedTestnetPublications()).length,
        0,
      );
      await sql`DELETE FROM project_issuance_intents WHERE project_id = ${project.projectId}`;
    }
  });

  test("stale or failed issuance provenance removes previously published TOML and blocks retry", async () => {
    const project = await createEligibleProject({
      code: "NOVA", displayName: "Nova", idempotencyKey: randomUUID(),
    });
    await publicationService(successVerifier).publishOwnedProject(project.projectId, OWNER);
    const repository = new PostgresMetadataPublicationRepository(sql, ISSUER);
    assert.equal((await repository.listSharedTestnetPublications()).length, 1);
    await sql`UPDATE project_issuance_intents SET status = 'failed'
      WHERE project_id = ${project.projectId}`;
    assert.deepEqual(await repository.listSharedTestnetPublications(), []);
    assert.equal(await repository.getByProjectId(project.projectId), null);
    await assert.rejects(
      publicationService(successVerifier).publishOwnedProject(project.projectId, OWNER),
      (error: unknown) => error instanceof MetadataPublicationError &&
        error.code === "issuer_provenance_unavailable",
    );
  });

  test("no configured approved issuer can ever publish, regardless of database rows", async () => {
    const project = await createEligibleProject({
      code: "NOVA", displayName: "Nova", idempotencyKey: randomUUID(),
    });
    const unconfigured = new MetadataPublicationService(sql, {
      verifier: successVerifier,
      approvedIssuerPublicKey: null,
    });
    await assert.rejects(
      unconfigured.publishOwnedProject(project.projectId, OWNER),
      (error: unknown) => error instanceof MetadataPublicationError &&
        error.code === "issuer_provenance_unavailable",
    );
    assert.deepEqual(
      await new PostgresMetadataPublicationRepository(sql, null).listSharedTestnetPublications(),
      [],
    );
  });

  function publicationService(
    verifier: MetadataPublicationVerifier,
  ): MetadataPublicationService {
    return new MetadataPublicationService(sql, {
      now: () => clock,
      verifier,
      approvedIssuerPublicKey: ISSUER,
    });
  }

  function verifierResult(
    result: MetadataVerificationResult,
  ): MetadataPublicationVerifier {
    return {
      verify: async (
        _publication: Pick<
          MetadataPublicationState,
          "assetCode" | "issuerPublicKey" | "currencyToml" | "contentHash"
        >,
      ) => result,
    };
  }

  async function createEligibleProject(input: {
    code: string;
    displayName: string;
    idempotencyKey: string;
    network?: "testnet" | "public";
    skipProvenance?: boolean;
  }) {
    const service = new ManagedProjectService(sql, {
      network: input.network ?? "testnet",
      now: () => clock,
    });
    const created = await service.createManagedProject({
      ownerPublicKey: OWNER,
      idempotencyKey: input.idempotencyKey,
      code: input.code,
      displayName: input.displayName,
      description: `${input.displayName} metadata.`,
    });

    await sql`
      UPDATE project_profiles
      SET issuer_public_key = ${ISSUER}
      WHERE project_id = ${created.project.projectId}
    `;
    if (!input.skipProvenance) {
      await recordSyntheticConfirmedProvenance(
        created.project.projectId,
        input.code,
      );
    }

    return {
      ...created.project,
      issuerPublicKey: ISSUER,
    };
  }
}
