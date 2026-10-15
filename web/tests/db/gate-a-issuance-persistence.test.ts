import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { after, before, beforeEach, test } from "node:test";

import { Keypair, Networks, Transaction, xdr } from "@stellar/stellar-sdk";

import { createDatabaseClient } from "../../lib/server/persistence/database";
import {
  IssuanceDatabaseIdentityError,
  SharedIssuanceApplicationDatabaseBoundary,
  TrustedConfirmationWriterDatabaseBoundary,
} from "../../lib/server/persistence/issuance-database-boundaries";
import { migrateDatabase } from "../../lib/server/persistence/migrations";
import { ManagedProjectService } from "../../lib/server/projects/managed-project-service";
import {
  PostgresSharedIssuancePersistenceRepository,
  PostgresTrustedLedgerConfirmationWriter,
  SharedIssuancePersistenceConflictError,
  type ImmutableSharedIssuanceIntent,
  type ImmutableSharedIssuanceTransactionAttempt,
} from "../../lib/server/projects/shared-issuance-persistence";
import { TestnetIssuanceService } from "../../lib/server/projects/testnet-issuance-service";
import {
  SHARED_ISSUER_TESTNET_PASSPHRASE,
  buildSharedIssuerIssuancePlan,
} from "../../lib/stellar/shared-issuer-issuance";
import {
  AuthoritativeSharedIssuanceConfirmationValidator,
  type StellarTestnetLedgerReader,
} from "../../lib/stellar/testnet-ledger-confirmation";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL?.trim();

if (!TEST_DATABASE_URL) {
  test(
    "Gate A issuance persistence PostgreSQL suite",
    { skip: true },
    () => {},
  );
} else {
  const admin = createDatabaseClient(TEST_DATABASE_URL);
  const appUrl = roleUrl(
    TEST_DATABASE_URL,
    "orrylo_gate_a_app_test",
    "gate-a-app-test",
  );
  const writerUrl = roleUrl(
    TEST_DATABASE_URL,
    "orrylo_gate_a_writer_test",
    "gate-a-writer-test",
  );
  const appSql = createDatabaseClient(appUrl);
  const writerSql = createDatabaseClient(writerUrl);
  const OWNER = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 121)).publicKey();
  const ISSUER_KEYPAIR = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 122));
  const ISSUER = ISSUER_KEYPAIR.publicKey();
  const DESTINATION = Keypair.fromRawEd25519Seed(
    Buffer.alloc(32, 123),
  ).publicKey();
  const NOW = 1_800_000_200_000;
  let repository: PostgresSharedIssuancePersistenceRepository;
  let writer: PostgresTrustedLedgerConfirmationWriter;

  before(async () => {
    if (!/test/i.test(new URL(TEST_DATABASE_URL).pathname.slice(1))) {
      throw new Error(
        "TEST_DATABASE_URL must identify an isolated test database.",
      );
    }
    await admin.unsafe("DROP SCHEMA public CASCADE");
    await admin.unsafe("CREATE SCHEMA public");
    await migrateDatabase(admin, resolve(process.cwd(), "db/migrations"));
    await admin.unsafe(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'orrylo_gate_a_app_test') THEN
          CREATE ROLE orrylo_gate_a_app_test LOGIN PASSWORD 'gate-a-app-test';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'orrylo_gate_a_writer_test') THEN
          CREATE ROLE orrylo_gate_a_writer_test LOGIN PASSWORD 'gate-a-writer-test';
        END IF;
      END;
      $$;
      ALTER ROLE orrylo_gate_a_app_test PASSWORD 'gate-a-app-test';
      ALTER ROLE orrylo_gate_a_writer_test PASSWORD 'gate-a-writer-test';
      GRANT USAGE ON SCHEMA public TO orrylo_gate_a_app_test;
      GRANT SELECT, INSERT ON project_issuance_full_intents,
        project_issuance_transaction_attempts TO orrylo_gate_a_app_test;
      GRANT UPDATE (signed_envelope_xdr_sha256)
        ON project_issuance_transaction_attempts TO orrylo_gate_a_app_test;
      GRANT orrylo_confirmation_writer TO orrylo_gate_a_writer_test;
    `);
    repository = new PostgresSharedIssuancePersistenceRepository(
      await SharedIssuanceApplicationDatabaseBoundary.authorize(appSql),
    );
    writer = new PostgresTrustedLedgerConfirmationWriter(
      await TrustedConfirmationWriterDatabaseBoundary.authorize(writerSql),
    );
  });

  beforeEach(async () => {
    await admin.unsafe(
      "TRUNCATE project_issuance_ledger_confirmations, project_issuance_transaction_attempts, project_issuance_full_intents, project_issuance_intents, project_profile_owners, project_profiles, workflow_intents, audit_events CASCADE",
    );
    await admin`UPDATE audit_chain_heads SET last_sequence = 0,
      last_event_hash = NULL WHERE chain_id = 'application'`;
  });

  after(async () => {
    await Promise.all([
      appSql.end({ timeout: 5 }),
      writerSql.end({ timeout: 5 }),
      admin.end({ timeout: 5 }),
    ]);
  });

  async function createFixture() {
    const project = await new ManagedProjectService(admin, {
      network: "testnet",
      now: () => NOW,
    }).createManagedProject({
      ownerPublicKey: OWNER,
      idempotencyKey: randomUUID(),
      code: "NOVA",
      displayName: "Nova",
      description: "Gate A persistence fixture.",
    });
    const reservation = await new TestnetIssuanceService(admin, {
      network: "testnet",
      approvedIssuerPublicKey: ISSUER,
      now: () => NOW,
    }).request({
      ownerPublicKey: OWNER,
      projectId: project.project.projectId,
      idempotencyKey: randomUUID(),
      expectedAssetCode: "NOVA",
    });
    const plan = buildSharedIssuerIssuancePlan(
      {
        projectId: project.project.projectId,
        assetCode: "NOVA",
        issuerPublicKey: ISSUER,
        destinationPublicKey: DESTINATION,
        amount: "100",
        network: "testnet",
        networkPassphrase: Networks.TESTNET,
        validFrom: 1_800_000_000,
        validUntil: 1_800_000_300,
      },
      {
        assetCodeReservedForProject: true,
        issuerSequence: "123",
        issuerSpendableNativeStroops: "1000",
        feeStroops: "100",
        destinationTrustline: {
          network: "testnet",
          networkPassphrase: Networks.TESTNET,
          destinationPublicKey: DESTINATION,
          assetCode: "NOVA",
          issuerPublicKey: ISSUER,
          observedLedger: 400,
          exists: true,
          authorized: true,
          balance: "0",
          limit: "1000",
          buyingLiabilities: "0",
        },
      },
    );
    const intent: ImmutableSharedIssuanceIntent = {
      issuanceRequestId: reservation.issuance.requestId,
      issuanceIntentFingerprint: plan.intentFingerprint,
      reservationFingerprint: reservation.issuance.reservationFingerprint,
      projectId: project.project.projectId,
      ownerPublicKey: OWNER,
      network: "testnet",
      networkPassphraseHash: createHash("sha256")
        .update(Networks.TESTNET)
        .digest("hex"),
      assetCode: "NOVA",
      issuerPublicKey: ISSUER,
      destinationPublicKey: DESTINATION,
      amount: "100.0000000",
      policyVersion: plan.intent.policyVersion,
      createdAt: new Date(NOW - 2_000).toISOString(),
    };
    const attempt: ImmutableSharedIssuanceTransactionAttempt = {
      attemptId: randomUUID(),
      issuanceRequestId: intent.issuanceRequestId,
      issuanceIntentFingerprint: intent.issuanceIntentFingerprint,
      attemptNumber: 1,
      transactionHash: plan.transactionHash,
      envelopeXdrSha256: createHash("sha256")
        .update(plan.unsignedEnvelopeXdr)
        .digest("hex"),
      sourceSequence: plan.sourceSequence,
      feeStroops: plan.feeStroops,
      validFrom: plan.validFrom,
      validUntil: plan.validUntil,
      transactionSourcePublicKey: ISSUER,
      operationCount: 1,
      operationType: "payment",
      operationSourcePublicKey: ISSUER,
      assetCode: "NOVA",
      issuerPublicKey: ISSUER,
      destinationPublicKey: DESTINATION,
      amount: "100.0000000",
      createdAt: new Date(NOW - 2_000).toISOString(),
    };
    const transaction = new Transaction(
      plan.unsignedEnvelopeXdr,
      Networks.TESTNET,
    );
    transaction.sign(ISSUER_KEYPAIR);
    const signedEnvelopeXdr = transaction.toXDR();
    const signedEnvelopeXdrSha256 = createHash("sha256")
      .update(signedEnvelopeXdr)
      .digest("hex");
    return {
      intent,
      attempt,
      signedEnvelopeXdr,
      signedEnvelopeXdrSha256,
    };
  }

  test("application and trusted-writer identities are mutually isolated from the migration owner", async () => {
    await assert.rejects(
      SharedIssuanceApplicationDatabaseBoundary.authorize(admin),
      IssuanceDatabaseIdentityError,
    );
    await assert.rejects(
      TrustedConfirmationWriterDatabaseBoundary.authorize(admin),
      IssuanceDatabaseIdentityError,
    );
    await assert.rejects(
      TrustedConfirmationWriterDatabaseBoundary.authorize(appSql),
      IssuanceDatabaseIdentityError,
    );
    await assert.rejects(
      SharedIssuanceApplicationDatabaseBoundary.authorize(writerSql),
      IssuanceDatabaseIdentityError,
    );
  });

  test("exact intent and attempt races are idempotent while conflicting replay fails closed", async () => {
    const { intent, attempt } = await createFixture();
    const intents = await Promise.all(
      Array.from({ length: 8 }, () => repository.appendIntent(intent)),
    );
    assert.equal(
      new Set(intents.map((value) => value.issuanceRequestId)).size,
      1,
    );
    await assert.rejects(
      repository.appendIntent({ ...intent, amount: "101.0000000" }),
      SharedIssuancePersistenceConflictError,
    );

    const attempts = await Promise.all(
      Array.from({ length: 8 }, () => repository.appendAttempt(attempt)),
    );
    assert.equal(new Set(attempts.map((value) => value.attemptId)).size, 1);
    assert.deepEqual(await repository.listAttempts(intent.issuanceRequestId), [
      attempt,
    ]);
    await assert.rejects(
      repository.appendAttempt({ ...attempt, sourceSequence: "124" }),
      SharedIssuancePersistenceConflictError,
    );
  });

  test("MVP Lite accepts attempt 1 but rejects every successor or conflicting attempt replay", async () => {
    const { intent, attempt } = await createFixture();
    await repository.appendIntent(intent);
    const first = await repository.appendAttempt(attempt);
    assert.equal(first.attemptNumber, 1);

    // Direct repository use is the application persistence boundary. It cannot
    // bypass reconciliation to construct a successor, even when the logical
    // issuance identity is otherwise identical.
    await assert.rejects(
      repository.appendAttempt({
        ...attempt,
        attemptId: randomUUID(),
        attemptNumber: 2,
        transactionHash: "d".repeat(64),
        envelopeXdrSha256: "e".repeat(64),
        sourceSequence: "124",
      }),
      SharedIssuancePersistenceConflictError,
    );

    // A different attempt-1 identity is also a conflict; the first immutable
    // transaction attempt is the only attempt for MVP Lite.
    await assert.rejects(
      repository.appendAttempt({
        ...attempt,
        attemptId: randomUUID(),
        transactionHash: "c".repeat(64),
        envelopeXdrSha256: "b".repeat(64),
      }),
      SharedIssuancePersistenceConflictError,
    );

    // Conflicting replay of the real attempt 1 continues to fail safely.
    await assert.rejects(
      repository.appendAttempt({ ...attempt, sourceSequence: "124" }),
      SharedIssuancePersistenceConflictError,
    );
    assert.deepEqual(await repository.listAttempts(intent.issuanceRequestId), [
      attempt,
    ]);
  });

  test("PostgreSQL itself permits attempt 1 and rejects direct SQL attempt 2 for the authorized app identity", async () => {
    const { intent, attempt, signedEnvelopeXdrSha256 } = await createFixture();
    await repository.appendIntent(intent);
    await appSql`
      INSERT INTO project_issuance_transaction_attempts (
        attempt_id, issuance_request_id, issuance_intent_fingerprint,
        attempt_number, transaction_hash, envelope_xdr_sha256,
        source_sequence, fee_stroops, valid_from, valid_until,
        transaction_source_public_key, operation_count, operation_type,
        operation_source_public_key, asset_code, issuer_public_key,
        destination_public_key, amount, created_at
      ) VALUES (
        ${attempt.attemptId}, ${attempt.issuanceRequestId},
        ${attempt.issuanceIntentFingerprint}, 1, ${attempt.transactionHash},
        ${attempt.envelopeXdrSha256}, ${attempt.sourceSequence},
        ${attempt.feeStroops}, ${attempt.validFrom}, ${attempt.validUntil},
        ${attempt.transactionSourcePublicKey}, 1, 'payment',
        ${attempt.operationSourcePublicKey}, ${attempt.assetCode},
        ${attempt.issuerPublicKey}, ${attempt.destinationPublicKey},
        ${attempt.amount}, ${new Date(attempt.createdAt)}
      )
    `;

    await assert.rejects(
      appSql`
        INSERT INTO project_issuance_transaction_attempts (
          attempt_id, issuance_request_id, issuance_intent_fingerprint,
          attempt_number, transaction_hash, envelope_xdr_sha256,
          source_sequence, fee_stroops, valid_from, valid_until,
          transaction_source_public_key, operation_count, operation_type,
          operation_source_public_key, asset_code, issuer_public_key,
          destination_public_key, amount, created_at
        ) VALUES (
          ${randomUUID()}, ${attempt.issuanceRequestId},
          ${attempt.issuanceIntentFingerprint}, 2, ${"d".repeat(64)},
          ${"e".repeat(64)}, 124, ${attempt.feeStroops},
          ${attempt.validFrom}, ${attempt.validUntil},
          ${attempt.transactionSourcePublicKey}, 1, 'payment',
          ${attempt.operationSourcePublicKey}, ${attempt.assetCode},
          ${attempt.issuerPublicKey}, ${attempt.destinationPublicKey},
          ${attempt.amount}, ${new Date(attempt.createdAt)}
        )
      `,
      (error: unknown) =>
        (error as { constraint_name?: string }).constraint_name ===
        "project_issuance_attempt_number_mvp_lite",
    );

    const [{ count }] = await appSql<{ count: string }[]>`
      SELECT count(*)::text AS count
      FROM project_issuance_transaction_attempts
      WHERE issuance_request_id = ${attempt.issuanceRequestId}
    `;
    assert.equal(count, "1");

    const recorded = await repository.recordSignedEnvelope({
      attemptId: attempt.attemptId,
      transactionHash: attempt.transactionHash,
      signedEnvelopeXdrSha256,
    });
    assert.equal(recorded.signedEnvelopeXdrSha256, signedEnvelopeXdrSha256);
    await assert.rejects(
      appSql`
        UPDATE project_issuance_transaction_attempts
        SET signed_envelope_xdr_sha256 = ${"f".repeat(64)}
        WHERE attempt_id = ${attempt.attemptId}
      `,
      /append-only/,
    );
  });

  test("attempts remain immutable and the ordinary application identity cannot fabricate confirmation", async () => {
    const { intent, attempt } = await createFixture();
    await repository.appendIntent(intent);
    await repository.appendAttempt(attempt);
    await assert.rejects(
      appSql`UPDATE project_issuance_transaction_attempts
        SET source_sequence = 999 WHERE attempt_id = ${attempt.attemptId}`,
    );
    await assert.rejects(
      appSql`INSERT INTO project_issuance_ledger_confirmations (
        confirmation_id, issuance_request_id, issuance_intent_fingerprint,
        attempt_id, project_id, owner_public_key, network,
        network_passphrase_hash, transaction_hash, envelope_xdr_sha256,
        result_xdr_sha256, result_success, ledger_sequence, ledger_closed_at,
        transaction_source_public_key, operation_count, operation_type,
        operation_source_public_key, asset_code, issuer_public_key,
        destination_public_key, amount, source_sequence, verifier_identity,
        verification_policy_version, verified_at, created_at
      ) SELECT ${randomUUID()}, issuance_request_id,
        issuance_intent_fingerprint, attempt_id, ${intent.projectId},
        ${intent.ownerPublicKey}, 'testnet', ${intent.networkPassphraseHash},
        transaction_hash, envelope_xdr_sha256, ${"f".repeat(64)}, true, 500,
        ${new Date(NOW)}, transaction_source_public_key, 1, 'payment',
        operation_source_public_key, asset_code, issuer_public_key,
        destination_public_key, amount, source_sequence, 'forged', 'forged',
        ${new Date(NOW)}, ${new Date(NOW)}
      FROM project_issuance_transaction_attempts
      WHERE attempt_id = ${attempt.attemptId}`,
    );
  });

  test("signed-envelope digest has one immutable pre-submission transition", async () => {
    const { intent, attempt, signedEnvelopeXdrSha256 } = await createFixture();
    await repository.appendIntent(intent);
    await repository.appendAttempt(attempt);

    const recorded = await repository.recordSignedEnvelope({
      attemptId: attempt.attemptId,
      transactionHash: attempt.transactionHash,
      signedEnvelopeXdrSha256,
    });
    assert.equal(recorded.signedEnvelopeXdrSha256, signedEnvelopeXdrSha256);
    await assert.rejects(
      repository.recordSignedEnvelope({
        attemptId: attempt.attemptId,
        transactionHash: attempt.transactionHash,
        signedEnvelopeXdrSha256,
      }),
      SharedIssuancePersistenceConflictError,
    );
    await assert.rejects(
      repository.recordSignedEnvelope({
        attemptId: attempt.attemptId,
        transactionHash: attempt.transactionHash,
        signedEnvelopeXdrSha256: "f".repeat(64),
      }),
      SharedIssuancePersistenceConflictError,
    );
    await assert.rejects(
      appSql`UPDATE project_issuance_transaction_attempts
        SET signed_envelope_xdr_sha256 = ${"e".repeat(64)}
        WHERE attempt_id = ${attempt.attemptId}`,
      /append-only/,
    );
  });

  test("signed-envelope claim has exactly one concurrent winner", async () => {
    const { intent, attempt, signedEnvelopeXdrSha256 } = await createFixture();
    await repository.appendIntent(intent);
    await repository.appendAttempt(attempt);

    const results = await Promise.allSettled([
      repository.recordSignedEnvelope({
        attemptId: attempt.attemptId,
        transactionHash: attempt.transactionHash,
        signedEnvelopeXdrSha256,
      }),
      repository.recordSignedEnvelope({
        attemptId: attempt.attemptId,
        transactionHash: attempt.transactionHash,
        signedEnvelopeXdrSha256,
      }),
    ]);

    assert.equal(
      results.filter((result) => result.status === "fulfilled").length,
      1,
    );
    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    assert.equal(rejected.length, 1);
    assert.ok(
      rejected[0]!.reason instanceof SharedIssuancePersistenceConflictError,
    );
    assert.equal(
      (await repository.getAttempt(attempt.attemptId))
        ?.signedEnvelopeXdrSha256,
      signedEnvelopeXdrSha256,
    );
  });

  test("only validated ledger evidence can be written and confirmation replay is immutable", async () => {
    const { intent, attempt, signedEnvelopeXdr, signedEnvelopeXdrSha256 } =
      await createFixture();
    await repository.appendIntent(intent);
    await repository.appendAttempt(attempt);
    const persistedAttempt = await repository.recordSignedEnvelope({
      attemptId: attempt.attemptId,
      transactionHash: attempt.transactionHash,
      signedEnvelopeXdrSha256,
    });
    const successfulResultXdr = new xdr.TransactionResult({
      feeCharged: xdr.Int64.fromString("100"),
      result: xdr.TransactionResultResult.txSuccess([
        xdr.OperationResult.opInner(
          xdr.OperationResultTr.payment(xdr.PaymentResult.paymentSuccess()),
        ),
      ]),
      ext: xdr.TransactionResultExt.v0(),
    }).toXDR("base64");
    const reader: StellarTestnetLedgerReader = {
      authority: "official_testnet_horizon",
      lookupTransaction: async () => ({
        status: "confirmed",
        network: "testnet",
        networkPassphrase: SHARED_ISSUER_TESTNET_PASSPHRASE,
        transactionHash: attempt.transactionHash,
        resultTransactionHash: attempt.transactionHash,
        envelopeXdr: signedEnvelopeXdr,
        resultXdr: successfulResultXdr,
        ledgerSequence: 500,
        ledgerClosedAt: new Date(NOW - 1_000).toISOString(),
        observedLedger: 501,
        observedAt: new Date(NOW - 500).toISOString(),
        observedLedgerClosedAt: new Date(NOW - 1_000).toISOString(),
      }),
      readAccountSequence: async () => ({
        network: "testnet",
        networkPassphrase: SHARED_ISSUER_TESTNET_PASSPHRASE,
        accountPublicKey: ISSUER,
        sequence: "124",
        observedLedger: 501,
        observedAt: new Date(NOW).toISOString(),
        observedLedgerClosedAt: new Date(NOW - 500).toISOString(),
      }),
    };
    const validated =
      await new AuthoritativeSharedIssuanceConfirmationValidator(reader, {
        now: () => NOW,
      }).validate({
        confirmationId: randomUUID(),
        intent,
        attempt: persistedAttempt,
        verifierIdentity: "gate-a-testnet-ledger-verifier",
        verificationPolicyVersion: "gate-a-v1",
      });

    const results = await Promise.all(
      Array.from({ length: 8 }, () => writer.appendConfirmation(validated)),
    );
    assert.equal(new Set(results.map((value) => value.confirmationId)).size, 1);
    await assert.rejects(writer.appendConfirmation({} as never));

    const replay = await new AuthoritativeSharedIssuanceConfirmationValidator(
      reader,
      { now: () => NOW },
    ).validate({
      confirmationId: randomUUID(),
      intent,
      attempt: persistedAttempt,
      verifierIdentity: "gate-a-testnet-ledger-verifier",
      verificationPolicyVersion: "gate-a-v1",
    });
    await assert.rejects(
      writer.appendConfirmation(replay),
      SharedIssuancePersistenceConflictError,
    );
    await assert.rejects(
      admin`DELETE FROM project_issuance_ledger_confirmations
        WHERE issuance_request_id = ${intent.issuanceRequestId}`,
      /append-only/,
    );
  });
}

function roleUrl(source: string, username: string, password: string): string {
  const url = new URL(source);
  url.username = username;
  url.password = password;
  return url.toString();
}
