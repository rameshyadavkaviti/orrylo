import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { after, before, beforeEach, test } from "node:test";

import { Keypair } from "@stellar/stellar-sdk/base";

import { createDatabaseClient } from "../../lib/server/persistence/database";
import { migrateDatabase } from "../../lib/server/persistence/migrations";
import { PostgresMetadataPublicationRepository } from "../../lib/server/persistence/metadata-publication-repository";
import { ManagedProjectService } from "../../lib/server/projects/managed-project-service";
import {
  MetadataPublicationError,
  MetadataPublicationService,
} from "../../lib/server/projects/metadata-publication-service";
import type { MetadataPublicationVerifier } from "../../lib/server/projects/metadata-publication-verifier";
import type {
  SharedAssetConfirmationReader,
  VerifiedSharedAssetProvenance,
} from "../../lib/server/projects/shared-asset-provenance";
import { TestnetIssuanceService } from "../../lib/server/projects/testnet-issuance-service";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL?.trim();

if (!TEST_DATABASE_URL) {
  test("metadata publication PostgreSQL suite", { skip: true }, () => {});
} else {
  const sql = createDatabaseClient(TEST_DATABASE_URL);
  const writerSql = createDatabaseClient(
    roleUrl(
      TEST_DATABASE_URL,
      "orrylo_metadata_writer_test",
      "metadata-writer-test",
    ),
  );
  const OWNER = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 81)).publicKey();
  const OTHER = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 82)).publicKey();
  const ISSUER = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 83)).publicKey();
  const ARBITRARY = Keypair.fromRawEd25519Seed(
    Buffer.alloc(32, 84),
  ).publicKey();
  const DESTINATION = Keypair.fromRawEd25519Seed(
    Buffer.alloc(32, 85),
  ).publicKey();
  const PASSPHRASE_HASH =
    "cee0302d59844d32bdca915c8203dd44b33fbb7edc19051ea37abedf28ecd472";
  const NOW = Date.parse("2026-10-09T12:00:00.000Z");
  let clock = NOW;

  class FixtureConfirmationReader implements SharedAssetConfirmationReader {
    readonly records = new Map<string, VerifiedSharedAssetProvenance>();
    available = true;
    enforceOwnerLookup = true;
    remainingReads: number | null = null;

    async findConfirmed(projectId: string, ownerPublicKey: string) {
      if (!this.available) return null;
      if (this.remainingReads !== null) {
        if (this.remainingReads <= 0) return null;
        this.remainingReads -= 1;
      }
      const record = this.records.get(projectId) ?? null;
      if (!record) return null;
      if (this.enforceOwnerLookup && record.ownerPublicKey !== ownerPublicKey) {
        return null;
      }
      return record;
    }
  }

  let reader: FixtureConfirmationReader;
  const successVerifier: MetadataPublicationVerifier = {
    verify: async () => ({ ok: true }),
  };

  before(async () => {
    const databaseName = new URL(TEST_DATABASE_URL).pathname.slice(1);
    if (!/test/i.test(databaseName)) {
      throw new Error(
        "TEST_DATABASE_URL must identify an isolated test database.",
      );
    }
    await sql.unsafe("DROP SCHEMA public CASCADE");
    await sql.unsafe("CREATE SCHEMA public");
    await migrateDatabase(sql, resolve(process.cwd(), "db/migrations"));
    await sql.unsafe(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'orrylo_metadata_writer_test') THEN
          CREATE ROLE orrylo_metadata_writer_test LOGIN PASSWORD 'metadata-writer-test';
        END IF;
      END;
      $$;
      ALTER ROLE orrylo_metadata_writer_test PASSWORD 'metadata-writer-test';
      GRANT orrylo_confirmation_writer TO orrylo_metadata_writer_test;
    `);
  });

  beforeEach(async () => {
    clock = NOW;
    reader = new FixtureConfirmationReader();
    await sql.unsafe(
      "TRUNCATE project_metadata_publications, project_issuance_ledger_confirmations, project_issuance_transaction_attempts, project_issuance_full_intents, project_issuance_intents, audit_events, project_profile_owners, project_profiles, workflow_intents CASCADE",
    );
    await sql`UPDATE audit_chain_heads SET last_sequence = 0,
      last_event_hash = NULL WHERE chain_id = 'application'`;
  });

  after(async () => {
    await Promise.all([writerSql.end({ timeout: 5 }), sql.end({ timeout: 5 })]);
  });

  function repository() {
    return new PostgresMetadataPublicationRepository(sql, {
      confirmationReader: reader,
      approvedIssuerPublicKey: ISSUER,
    });
  }

  function service(
    verifier: MetadataPublicationVerifier = successVerifier,
    approvedIssuerPublicKey: string | null = ISSUER,
  ) {
    return new MetadataPublicationService(sql, {
      now: () => clock,
      verifier,
      approvedIssuerPublicKey,
      confirmationReader: reader,
    });
  }

  async function createConfirmedProject(code = "NOVA") {
    const project = await new ManagedProjectService(sql, {
      network: "testnet",
      now: () => clock,
    }).createManagedProject({
      ownerPublicKey: OWNER,
      idempotencyKey: randomUUID(),
      code,
      displayName: `${code} token`,
      description: "Confirmed metadata fixture.",
    });
    const reservation = await new TestnetIssuanceService(sql, {
      network: "testnet",
      approvedIssuerPublicKey: ISSUER,
      now: () => clock,
    }).request({
      ownerPublicKey: OWNER,
      projectId: project.project.projectId,
      idempotencyKey: randomUUID(),
      expectedAssetCode: code,
    });
    const intentFingerprint = randomUUID().replaceAll("-", "").repeat(2);
    const attemptId = randomUUID();
    const confirmationId = randomUUID();
    const transactionHash = "a".repeat(64);
    const envelopeHash = "b".repeat(64);
    const signedEnvelopeHash = "d".repeat(64);
    await sql`
      INSERT INTO project_issuance_full_intents (
        issuance_request_id, issuance_intent_fingerprint,
        reservation_fingerprint, project_id, owner_public_key, network,
        network_passphrase_hash, asset_code, issuer_public_key,
        destination_public_key, amount, policy_version, created_at
      ) VALUES (
        ${reservation.issuance.requestId}, ${intentFingerprint},
        ${reservation.issuance.reservationFingerprint},
        ${project.project.projectId}, ${OWNER}, 'testnet', ${PASSPHRASE_HASH},
        ${code}, ${ISSUER}, ${DESTINATION}, 100.0000000,
        'shared-issuer-testnet-v1', ${new Date(clock)}
      )
    `;
    await sql`
      INSERT INTO project_issuance_transaction_attempts (
        attempt_id, issuance_request_id, issuance_intent_fingerprint,
        attempt_number, transaction_hash, envelope_xdr_sha256,
        signed_envelope_xdr_sha256,
        source_sequence, fee_stroops, valid_from, valid_until,
        transaction_source_public_key, operation_count, operation_type,
        operation_source_public_key, asset_code, issuer_public_key,
        destination_public_key, amount, created_at
      ) VALUES (
        ${attemptId}, ${reservation.issuance.requestId}, ${intentFingerprint},
        1, ${transactionHash}, ${envelopeHash}, ${signedEnvelopeHash},
        123, 100, 1, 2, ${ISSUER},
        1, 'payment', ${ISSUER}, ${code}, ${ISSUER}, ${DESTINATION},
        100.0000000, ${new Date(clock)}
      )
    `;
    await writerSql`
      INSERT INTO project_issuance_ledger_confirmations (
        confirmation_id, issuance_request_id, issuance_intent_fingerprint,
        attempt_id, project_id, owner_public_key, network,
        network_passphrase_hash, transaction_hash, envelope_xdr_sha256,
        signed_envelope_xdr_sha256, result_xdr_sha256, result_success,
        ledger_sequence, ledger_closed_at,
        transaction_source_public_key, operation_count, operation_type,
        operation_source_public_key, asset_code, issuer_public_key,
        destination_public_key, amount, source_sequence, verifier_identity,
        verification_policy_version, verified_at, created_at
      ) VALUES (
        ${confirmationId}, ${reservation.issuance.requestId},
        ${intentFingerprint}, ${attemptId}, ${project.project.projectId},
        ${OWNER}, 'testnet', ${PASSPHRASE_HASH}, ${transactionHash},
        ${envelopeHash}, ${signedEnvelopeHash}, ${"c".repeat(64)}, true, 456,
        ${new Date(clock)},
        ${ISSUER}, 1, 'payment', ${ISSUER}, ${code}, ${ISSUER}, ${DESTINATION},
        100.0000000, 123, 'isolated-test-ledger-verifier',
        'test-verification-v1', ${new Date(clock)}, ${new Date(clock)}
      )
    `;
    const provenance: VerifiedSharedAssetProvenance = {
      confirmationId,
      projectId: project.project.projectId,
      ownerPublicKey: OWNER,
      network: "testnet",
      assetCode: code,
      issuerPublicKey: ISSUER,
      destinationPublicKey: DESTINATION,
      amount: "100.0000000",
      issuanceRequestId: reservation.issuance.requestId,
      issuanceIntentFingerprint: intentFingerprint,
      transactionHash,
      ledgerSequence: 456,
    };
    reader.records.set(project.project.projectId, provenance);
    return { project: project.project, provenance };
  }

  test("the application is fail-closed without the explicitly injected confirmation reader", async () => {
    const { project } = await createConfirmedProject();
    await assert.rejects(
      new MetadataPublicationService(sql, {
        approvedIssuerPublicKey: ISSUER,
        verifier: successVerifier,
      }).publishOwnedProject(project.projectId, OWNER),
      (error: unknown) =>
        error instanceof MetadataPublicationError &&
        error.code === "issuer_provenance_unavailable",
    );
    assert.deepEqual(
      await new PostgresMetadataPublicationRepository(
        sql,
      ).listSharedTestnetPublications(),
      [],
    );
  });

  test("an exact authenticated confirmation can bind and verify one metadata snapshot", async () => {
    const { project, provenance } = await createConfirmedProject();
    const result = await service().publishOwnedProject(
      project.projectId,
      OWNER,
    );
    assert.equal(result.status, "verified");
    assert.equal(result.changed, true);
    assert.equal(result.publication.reachable, true);
    const [stored] = await sql<
      { confirmation_id: string; issuance_fingerprint: string }[]
    >`
      SELECT confirmation_id, issuance_fingerprint
      FROM project_metadata_publications WHERE project_id = ${project.projectId}
    `;
    assert.equal(stored.confirmation_id, provenance.confirmationId);
    assert.equal(
      stored.issuance_fingerprint.trim(),
      provenance.issuanceIntentFingerprint,
    );
    assert.equal(
      (await repository().listSharedTestnetPublications()).length,
      1,
    );
  });

  test("owner authorization and approved issuer matching remain fail closed", async () => {
    const { project } = await createConfirmedProject();
    await assert.rejects(
      service().publishOwnedProject(project.projectId, OTHER),
    );
    await assert.rejects(
      service(successVerifier, ARBITRARY).publishOwnedProject(
        project.projectId,
        OWNER,
      ),
      (error: unknown) =>
        error instanceof MetadataPublicationError &&
        error.code === "issuer_provenance_mismatch",
    );
    await sql`UPDATE project_profiles SET issuer_public_key = ${ARBITRARY}
      WHERE project_id = ${project.projectId}`;
    await assert.rejects(
      service().publishOwnedProject(project.projectId, OWNER),
      (error: unknown) =>
        error instanceof MetadataPublicationError &&
        error.code === "issuer_provenance_mismatch",
    );
  });

  test("stale confirmation provenance for another project or owner is rejected", async () => {
    const { project, provenance } = await createConfirmedProject();
    reader.records.set(project.projectId, {
      ...provenance,
      projectId: randomUUID(),
    });
    await assert.rejects(
      service().publishOwnedProject(project.projectId, OWNER),
      (error: unknown) =>
        error instanceof MetadataPublicationError &&
        error.code === "issuer_provenance_mismatch",
    );

    reader.records.set(project.projectId, {
      ...provenance,
      ownerPublicKey: OTHER,
    });
    reader.enforceOwnerLookup = false;
    await assert.rejects(
      service().publishOwnedProject(project.projectId, OWNER),
      (error: unknown) =>
        error instanceof MetadataPublicationError &&
        error.code === "issuer_provenance_mismatch",
    );
  });

  test("concurrent identical publication is idempotent at revision one", async () => {
    const { project } = await createConfirmedProject();
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        service().publishOwnedProject(project.projectId, OWNER),
      ),
    );
    assert.equal(results.filter((result) => result.changed).length, 1);
    assert.equal(
      new Set(results.map((result) => result.publication.contentHash)).size,
      1,
    );
    assert.equal(results[0]?.publication.revision, 1);
  });

  test("verification failure is retryable without creating a new revision", async () => {
    const { project } = await createConfirmedProject();
    const failed = await service({
      verify: async () => ({ ok: false, code: "request_failed" }),
    }).publishOwnedProject(project.projectId, OWNER);
    assert.equal(failed.status, "published_not_reachable");
    assert.equal(failed.publication.revision, 1);
    clock += 1;
    const retried = await service().publishOwnedProject(
      project.projectId,
      OWNER,
    );
    assert.equal(retried.status, "verified");
    assert.equal(retried.changed, false);
    assert.equal(retried.publication.revision, 1);
  });

  test("verified fast path revalidates confirmation provenance before returning", async () => {
    const { project } = await createConfirmedProject();
    await service().publishOwnedProject(project.projectId, OWNER);
    reader.remainingReads = 1;
    await assert.rejects(
      service().publishOwnedProject(project.projectId, OWNER),
      (error: unknown) =>
        error instanceof MetadataPublicationError &&
        error.code === "issuer_provenance_unavailable",
    );
  });

  test("confirmation loss during reachability verification cannot report success", async () => {
    const { project } = await createConfirmedProject();
    const verifier: MetadataPublicationVerifier = {
      verify: async () => {
        reader.available = false;
        return { ok: true };
      },
    };
    await assert.rejects(
      service(verifier).publishOwnedProject(project.projectId, OWNER),
      (error: unknown) =>
        error instanceof MetadataPublicationError &&
        error.code === "issuer_provenance_unavailable",
    );
    assert.deepEqual(await repository().listSharedTestnetPublications(), []);
  });
}

function roleUrl(source: string, username: string, password: string): string {
  const url = new URL(source);
  url.username = username;
  url.password = password;
  return url.toString();
}
