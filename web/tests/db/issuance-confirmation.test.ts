import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { after, before, beforeEach, test } from "node:test";

import { Keypair } from "@stellar/stellar-sdk/base";

import { createDatabaseClient } from "../../lib/server/persistence/database";
import { migrateDatabase } from "../../lib/server/persistence/migrations";
import { ManagedProjectService } from "../../lib/server/projects/managed-project-service";
import { TestnetIssuanceService } from "../../lib/server/projects/testnet-issuance-service";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL?.trim();

if (!TEST_DATABASE_URL) {
  test("issuance confirmation PostgreSQL suite", { skip: true }, () => {});
} else {
  const sql = createDatabaseClient(TEST_DATABASE_URL);
  const untrustedSql = createDatabaseClient(
    roleUrl(TEST_DATABASE_URL, "orrylo_untrusted_test", "untrusted-test"),
  );
  const writerSql = createDatabaseClient(
    roleUrl(
      TEST_DATABASE_URL,
      "orrylo_confirmation_writer_test",
      "writer-test",
    ),
  );
  const OWNER = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 101)).publicKey();
  const ISSUER = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 102)).publicKey();
  const DESTINATION = Keypair.fromRawEd25519Seed(
    Buffer.alloc(32, 103),
  ).publicKey();
  const PASSPHRASE_HASH =
    "cee0302d59844d32bdca915c8203dd44b33fbb7edc19051ea37abedf28ecd472";
  const NOW = Date.parse("2026-10-12T09:30:00.000Z");

  before(async () => {
    if (!/test/i.test(new URL(TEST_DATABASE_URL).pathname.slice(1))) {
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
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'orrylo_untrusted_test') THEN
          CREATE ROLE orrylo_untrusted_test LOGIN PASSWORD 'untrusted-test';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'orrylo_confirmation_writer_test') THEN
          CREATE ROLE orrylo_confirmation_writer_test LOGIN PASSWORD 'writer-test';
        END IF;
      END;
      $$
    `);
    await sql.unsafe(
      "ALTER ROLE orrylo_untrusted_test PASSWORD 'untrusted-test'",
    );
    await sql.unsafe(
      "ALTER ROLE orrylo_confirmation_writer_test PASSWORD 'writer-test'",
    );
    await sql.unsafe("GRANT USAGE ON SCHEMA public TO orrylo_untrusted_test");
    await sql.unsafe(
      "GRANT INSERT, SELECT ON project_issuance_ledger_confirmations TO orrylo_untrusted_test",
    );
    await sql.unsafe(
      "GRANT orrylo_confirmation_writer TO orrylo_confirmation_writer_test",
    );
  });

  beforeEach(async () => {
    await sql.unsafe(
      "TRUNCATE project_issuance_ledger_confirmations, project_issuance_transaction_attempts, project_issuance_full_intents, project_issuance_intents, project_profile_owners, project_profiles, workflow_intents, audit_events CASCADE",
    );
    await sql`UPDATE audit_chain_heads SET last_sequence = 0,
      last_event_hash = NULL WHERE chain_id = 'application'`;
  });

  after(async () => {
    await Promise.all([
      untrustedSql.end({ timeout: 5 }),
      writerSql.end({ timeout: 5 }),
      sql.end({ timeout: 5 }),
    ]);
  });

  async function createContractFixture() {
    const project = await new ManagedProjectService(sql, {
      network: "testnet",
      now: () => NOW,
    }).createManagedProject({
      ownerPublicKey: OWNER,
      idempotencyKey: randomUUID(),
      code: "NOVA",
      displayName: "Nova",
      description: "Immutable confirmation fixture.",
    });
    const reservation = await new TestnetIssuanceService(sql, {
      network: "testnet",
      approvedIssuerPublicKey: ISSUER,
      now: () => NOW,
    }).request({
      ownerPublicKey: OWNER,
      projectId: project.project.projectId,
      idempotencyKey: randomUUID(),
      expectedAssetCode: "NOVA",
    });
    const intentFingerprint = "1".repeat(64);
    const attemptId = randomUUID();
    const transactionHash = "2".repeat(64);
    const envelopeHash = "3".repeat(64);
    const signedEnvelopeHash = "4".repeat(64);
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
        'NOVA', ${ISSUER}, ${DESTINATION}, 100.0000000,
        'shared-issuer-testnet-v1', ${new Date(NOW)}
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
        123, 100, 1, 2,
        ${ISSUER}, 1, 'payment', ${ISSUER}, 'NOVA', ${ISSUER},
        ${DESTINATION}, 100.0000000, ${new Date(NOW)}
      )
    `;
    return {
      projectId: project.project.projectId,
      requestId: reservation.issuance.requestId,
      intentFingerprint,
      attemptId,
      transactionHash,
      envelopeHash,
      signedEnvelopeHash,
    };
  }

  async function insertConfirmation(
    role: "orrylo_untrusted_test" | "orrylo_confirmation_writer",
    fixture: Awaited<ReturnType<typeof createContractFixture>>,
    assetCode = "NOVA",
  ) {
    const client =
      role === "orrylo_confirmation_writer" ? writerSql : untrustedSql;
    return client`
        INSERT INTO project_issuance_ledger_confirmations (
          confirmation_id, issuance_request_id, issuance_intent_fingerprint,
          attempt_id, project_id, owner_public_key, network,
          network_passphrase_hash, transaction_hash, envelope_xdr_sha256,
          signed_envelope_xdr_sha256, result_xdr_sha256, result_success,
          ledger_sequence,
          ledger_closed_at, transaction_source_public_key, operation_count,
          operation_type, operation_source_public_key, asset_code,
          issuer_public_key, destination_public_key, amount, source_sequence,
          verifier_identity, verification_policy_version, verified_at,
          created_at
        ) VALUES (
          ${randomUUID()}, ${fixture.requestId}, ${fixture.intentFingerprint},
          ${fixture.attemptId}, ${fixture.projectId}, ${OWNER}, 'testnet',
          ${PASSPHRASE_HASH}, ${fixture.transactionHash},
          ${fixture.envelopeHash}, ${fixture.signedEnvelopeHash},
          ${"5".repeat(64)}, true, 456,
          ${new Date(NOW)}, ${ISSUER}, 1, 'payment', ${ISSUER}, ${assetCode},
          ${ISSUER}, ${DESTINATION}, 100.0000000, 123,
          'isolated-test-ledger-verifier', 'test-verification-v1',
          ${new Date(NOW)}, ${new Date(NOW)}
        ) RETURNING confirmation_id
      `;
  }

  test("only the trusted writer can append an exact immutable confirmation", async () => {
    const fixture = await createContractFixture();
    await assert.rejects(
      insertConfirmation("orrylo_untrusted_test", fixture),
      /permission denied|dedicated trusted confirmation writer login required/,
    );
    await assert.rejects(
      insertConfirmation("orrylo_confirmation_writer", fixture, "FAKE"),
      /does not match immutable intent and attempt/,
    );
    const inserted = await insertConfirmation(
      "orrylo_confirmation_writer",
      fixture,
    );
    assert.equal(inserted.length, 1);
    await assert.rejects(
      sql`
      UPDATE project_issuance_ledger_confirmations
      SET ledger_sequence = 999 WHERE issuance_request_id = ${fixture.requestId}
    `,
      /issuance evidence is append-only/,
    );
    await assert.rejects(
      sql`
      DELETE FROM project_issuance_ledger_confirmations
      WHERE issuance_request_id = ${fixture.requestId}
    `,
      /issuance evidence is append-only/,
    );
  });

  test("trusted writer ignores TEMP-shadowed issuance evidence", async () => {
    const fixture = await createContractFixture();

    await writerSql.begin(async (writer) => {
      await writer.unsafe(`
        CREATE TEMP TABLE project_issuance_full_intents (
          issuance_request_id uuid,
          issuance_intent_fingerprint char(64),
          project_id uuid,
          owner_public_key char(56),
          network text,
          network_passphrase_hash char(64),
          asset_code varchar(12),
          issuer_public_key char(56),
          destination_public_key char(56),
          amount numeric(30, 7)
        )
      `);
      await writer.unsafe(`
        CREATE TEMP TABLE project_issuance_transaction_attempts (
          attempt_id uuid,
          issuance_request_id uuid,
          issuance_intent_fingerprint char(64),
          transaction_hash char(64),
          envelope_xdr_sha256 char(64),
          signed_envelope_xdr_sha256 char(64),
          source_sequence numeric(20, 0),
          transaction_source_public_key char(56),
          operation_count integer,
          operation_type text,
          operation_source_public_key char(56),
          asset_code varchar(12),
          issuer_public_key char(56),
          destination_public_key char(56),
          amount numeric(30, 7)
        )
      `);
      await writer`
        INSERT INTO project_issuance_full_intents (
          issuance_request_id, issuance_intent_fingerprint, project_id,
          owner_public_key, network, network_passphrase_hash, asset_code,
          issuer_public_key, destination_public_key, amount
        ) VALUES (
          ${fixture.requestId}, ${fixture.intentFingerprint},
          ${fixture.projectId}, ${OWNER}, 'testnet', ${PASSPHRASE_HASH},
          'FAKE', ${ISSUER}, ${DESTINATION}, 100.0000000
        )
      `;
      await writer`
        INSERT INTO project_issuance_transaction_attempts (
          attempt_id, issuance_request_id, issuance_intent_fingerprint,
          transaction_hash, envelope_xdr_sha256,
          signed_envelope_xdr_sha256, source_sequence,
          transaction_source_public_key, operation_count, operation_type,
          operation_source_public_key, asset_code, issuer_public_key,
          destination_public_key, amount
        ) VALUES (
          ${fixture.attemptId}, ${fixture.requestId},
          ${fixture.intentFingerprint}, ${fixture.transactionHash},
          ${fixture.envelopeHash}, ${fixture.signedEnvelopeHash}, 123,
          ${ISSUER}, 1, 'payment', ${ISSUER}, 'FAKE', ${ISSUER},
          ${DESTINATION}, 100.0000000
        )
      `;

      await assert.rejects(
        writer`
          INSERT INTO public.project_issuance_ledger_confirmations (
            confirmation_id, issuance_request_id,
            issuance_intent_fingerprint, attempt_id, project_id,
            owner_public_key, network, network_passphrase_hash,
            transaction_hash, envelope_xdr_sha256,
            signed_envelope_xdr_sha256, result_xdr_sha256, result_success,
            ledger_sequence, ledger_closed_at,
            transaction_source_public_key, operation_count, operation_type,
            operation_source_public_key, asset_code, issuer_public_key,
            destination_public_key, amount, source_sequence,
            verifier_identity, verification_policy_version, verified_at,
            created_at
          ) VALUES (
            ${randomUUID()}, ${fixture.requestId},
            ${fixture.intentFingerprint}, ${fixture.attemptId},
            ${fixture.projectId}, ${OWNER}, 'testnet', ${PASSPHRASE_HASH},
            ${fixture.transactionHash}, ${fixture.envelopeHash},
            ${fixture.signedEnvelopeHash}, ${"5".repeat(64)}, true, 456,
            ${new Date(NOW)}, ${ISSUER}, 1, 'payment', ${ISSUER}, 'FAKE',
            ${ISSUER}, ${DESTINATION}, 100.0000000, 123,
            'isolated-test-ledger-verifier', 'test-verification-v1',
            ${new Date(NOW)}, ${new Date(NOW)}
          )
        `,
        /does not match immutable intent and attempt/,
      );
    });
  });

  test("full intents and attempts are immutable and exact-fingerprint bound", async () => {
    const fixture = await createContractFixture();
    await assert.rejects(
      sql`
      UPDATE project_issuance_full_intents SET amount = 200
      WHERE issuance_request_id = ${fixture.requestId}
    `,
      /issuance evidence is append-only/,
    );
    await assert.rejects(
      sql`
      DELETE FROM project_issuance_transaction_attempts
      WHERE attempt_id = ${fixture.attemptId}
    `,
      /issuance evidence is append-only/,
    );
    await assert.rejects(sql`
      INSERT INTO project_issuance_transaction_attempts (
        attempt_id, issuance_request_id, issuance_intent_fingerprint,
        attempt_number, transaction_hash, envelope_xdr_sha256,
        source_sequence, fee_stroops, valid_from, valid_until,
        transaction_source_public_key, operation_count, operation_type,
        operation_source_public_key, asset_code, issuer_public_key,
        destination_public_key, amount, created_at
      ) VALUES (
        ${randomUUID()}, ${fixture.requestId}, ${"9".repeat(64)}, 2,
        ${"8".repeat(64)}, ${"7".repeat(64)}, 124, 100, 1, 2,
        ${ISSUER}, 1, 'payment', ${ISSUER}, 'NOVA', ${ISSUER},
        ${DESTINATION}, 100.0000000, ${new Date(NOW)}
      )
    `);
  });
}

function roleUrl(source: string, username: string, password: string): string {
  const url = new URL(source);
  url.username = username;
  url.password = password;
  return url.toString();
}
