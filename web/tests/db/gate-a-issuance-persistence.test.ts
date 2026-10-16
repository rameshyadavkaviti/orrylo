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
  validateBoundedSharedIssuanceRecoveryEvidence,
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
  const appUrl = roleUrl(TEST_DATABASE_URL, "orrylo_app", "gate-a-app-test");
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
    await admin.unsafe(`
      DO $role$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'orrylo_app') THEN
          CREATE ROLE orrylo_app LOGIN PASSWORD 'gate-a-app-test';
        END IF;
      END;
      $role$;
      ALTER ROLE orrylo_app LOGIN PASSWORD 'gate-a-app-test';
    `);
    await migrateDatabase(admin, resolve(process.cwd(), "db/migrations"));
    await admin.unsafe(`
      DO $role$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'orrylo_gate_a_writer_test') THEN
          CREATE ROLE orrylo_gate_a_writer_test LOGIN PASSWORD 'gate-a-writer-test';
        END IF;
      END;
      $role$;
      ALTER ROLE orrylo_gate_a_writer_test PASSWORD 'gate-a-writer-test';
      REVOKE orrylo_confirmation_writer FROM orrylo_app;
      GRANT USAGE ON SCHEMA public TO orrylo_app;
      GRANT SELECT, INSERT ON project_issuance_full_intents,
        project_issuance_transaction_attempts TO orrylo_app;
      GRANT UPDATE (signed_envelope_xdr_sha256)
        ON project_issuance_transaction_attempts TO orrylo_app;
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
      "TRUNCATE project_issuance_recovery_evidence, project_issuance_ledger_confirmations, project_issuance_transaction_attempts, project_issuance_full_intents, project_issuance_intents, project_profile_owners, project_profiles, workflow_intents, audit_events CASCADE",
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

  async function claimPrivateSigning(
    attempt: ImmutableSharedIssuanceTransactionAttempt,
  ) {
    const claimed = await repository.claimSigningMode({
      attemptId: attempt.attemptId,
      transactionHash: attempt.transactionHash,
      signingMode: "private",
    });
    assert.equal(claimed?.signingMode, "private");
    return claimed;
  }

  async function claimManualSigning(
    attempt: ImmutableSharedIssuanceTransactionAttempt,
  ) {
    const claimed = await repository.claimSigningMode({
      attemptId: attempt.attemptId,
      transactionHash: attempt.transactionHash,
      signingMode: "manual",
    });
    assert.equal(claimed?.signingMode, "manual");
    return claimed!;
  }

  async function insertRecoveryAuthorization(
    intent: ImmutableSharedIssuanceIntent,
    attempt: ImmutableSharedIssuanceTransactionAttempt,
  ) {
    await admin`
      INSERT INTO project_issuance_recovery_authorizations (
        issuance_request_id, project_id, owner_public_key,
        superseded_attempt_id, superseded_transaction_hash,
        next_attempt_number, network, issuer_public_key,
        destination_public_key, asset_code, amount,
        authorization_policy_version, authorized_at
      ) VALUES (
        ${intent.issuanceRequestId}, ${intent.projectId},
        ${intent.ownerPublicKey}, ${attempt.attemptId},
        ${attempt.transactionHash}, 2, 'testnet',
        ${intent.issuerPublicKey}, ${intent.destinationPublicKey},
        ${intent.assetCode}, ${intent.amount},
        'db-test-bounded-recovery-v1',
        ${new Date((attempt.validUntil + 1) * 1_000)}
      )
    `;
  }

  function recoveryReaderFor(
    attempt: ImmutableSharedIssuanceTransactionAttempt,
    sequence = attempt.sourceSequence,
  ): StellarTestnetLedgerReader {
    const afterExpiry = new Date((attempt.validUntil + 1) * 1_000).toISOString();
    return {
      authority: "official_testnet_horizon",
      async lookupTransaction(transactionHash) {
        return {
          status: "not_found",
          network: "testnet",
          networkPassphrase: Networks.TESTNET,
          transactionHash,
          observedLedger: 900,
          observedAt: afterExpiry,
          observedLedgerClosedAt: afterExpiry,
        };
      },
      async readAccountSequence(accountPublicKey) {
        return {
          network: "testnet",
          networkPassphrase: Networks.TESTNET,
          accountPublicKey,
          sequence,
          observedLedger: 900,
          observedAt: afterExpiry,
          observedLedgerClosedAt: afterExpiry,
        };
      },
    };
  }

  function buildRecoveryAttempt(
    intent: ImmutableSharedIssuanceIntent,
    previous: ImmutableSharedIssuanceTransactionAttempt,
  ): ImmutableSharedIssuanceTransactionAttempt {
    const validFrom = previous.validUntil + 10;
    const plan = buildSharedIssuerIssuancePlan(
      {
        projectId: intent.projectId,
        assetCode: intent.assetCode,
        issuerPublicKey: intent.issuerPublicKey,
        destinationPublicKey: intent.destinationPublicKey,
        amount: intent.amount,
        network: "testnet",
        networkPassphrase: Networks.TESTNET,
        validFrom,
        validUntil: validFrom + 300,
      },
      {
        assetCodeReservedForProject: true,
        issuerSequence: previous.sourceSequence,
        issuerSpendableNativeStroops: "1000",
        feeStroops: previous.feeStroops,
        destinationTrustline: {
          network: "testnet",
          networkPassphrase: Networks.TESTNET,
          destinationPublicKey: intent.destinationPublicKey,
          assetCode: intent.assetCode,
          issuerPublicKey: intent.issuerPublicKey,
          observedLedger: 901,
          exists: true,
          authorized: true,
          balance: "0.0000000",
          limit: "1000.0000000",
          buyingLiabilities: "0.0000000",
        },
      },
    );
    return {
      attemptId: randomUUID(),
      issuanceRequestId: intent.issuanceRequestId,
      issuanceIntentFingerprint: intent.issuanceIntentFingerprint,
      attemptNumber: 2,
      transactionHash: plan.transactionHash,
      envelopeXdrSha256: createHash("sha256")
        .update(plan.unsignedEnvelopeXdr)
        .digest("hex"),
      sourceSequence: plan.sourceSequence,
      feeStroops: plan.feeStroops,
      validFrom: plan.validFrom,
      validUntil: plan.validUntil,
      transactionSourcePublicKey: intent.issuerPublicKey,
      operationCount: 1,
      operationType: "payment",
      operationSourcePublicKey: intent.issuerPublicKey,
      assetCode: intent.assetCode,
      issuerPublicKey: intent.issuerPublicKey,
      destinationPublicKey: intent.destinationPublicKey,
      amount: intent.amount,
      createdAt: new Date(validFrom * 1_000).toISOString(),
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

    await claimPrivateSigning(attempt);
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

  test("signing mode has exactly one concurrent winner and cannot switch", async () => {
    const { intent, attempt } = await createFixture();
    await repository.appendIntent(intent);
    await repository.appendAttempt(attempt);

    const [privateClaim, manualClaim] = await Promise.all([
      repository.claimSigningMode({
        attemptId: attempt.attemptId,
        transactionHash: attempt.transactionHash,
        signingMode: "private",
      }),
      repository.claimSigningMode({
        attemptId: attempt.attemptId,
        transactionHash: attempt.transactionHash,
        signingMode: "manual",
      }),
    ]);

    const winners = [privateClaim, manualClaim].filter(
      (claim): claim is ImmutableSharedIssuanceTransactionAttempt =>
        claim !== null,
    );
    assert.equal(winners.length, 1);
    assert.ok(
      winners[0]!.signingMode === "private" ||
        winners[0]!.signingMode === "manual",
    );

    const stored = await repository.getAttempt(attempt.attemptId);
    assert.equal(stored?.signingMode, winners[0]!.signingMode);
    assert.equal(stored?.signedEnvelopeXdrSha256, undefined);

    assert.equal(
      await repository.claimSigningMode({
        attemptId: attempt.attemptId,
        transactionHash: attempt.transactionHash,
        signingMode: winners[0]!.signingMode!,
      }),
      null,
    );

    await assert.rejects(
      appSql`
        UPDATE project_issuance_transaction_attempts
        SET signing_mode = ${winners[0]!.signingMode === "private" ? "manual" : "private"}
        WHERE attempt_id = ${attempt.attemptId}
      `,
      /append-only/,
    );
  });

  test("signed-envelope provenance cannot be persisted before signing mode ownership", async () => {
    const { intent, attempt, signedEnvelopeXdrSha256 } = await createFixture();
    await repository.appendIntent(intent);
    await repository.appendAttempt(attempt);

    await assert.rejects(
      repository.recordSignedEnvelope({
        attemptId: attempt.attemptId,
        transactionHash: attempt.transactionHash,
        signedEnvelopeXdrSha256,
      }),
      SharedIssuancePersistenceConflictError,
    );
    assert.equal(
      (await repository.getAttempt(attempt.attemptId))?.signedEnvelopeXdrSha256,
      undefined,
    );
  });

  test("signed-envelope digest has one immutable pre-submission transition", async () => {
    const { intent, attempt, signedEnvelopeXdrSha256 } = await createFixture();
    await repository.appendIntent(intent);
    await repository.appendAttempt(attempt);

    await claimPrivateSigning(attempt);
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
    await claimPrivateSigning(attempt);

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
      (await repository.getAttempt(attempt.attemptId))?.signedEnvelopeXdrSha256,
      signedEnvelopeXdrSha256,
    );
  });

  test("only validated ledger evidence can be written and confirmation replay is immutable", async () => {
    const { intent, attempt, signedEnvelopeXdr, signedEnvelopeXdrSha256 } =
      await createFixture();
    await repository.appendIntent(intent);
    await repository.appendAttempt(attempt);
    await claimPrivateSigning(attempt);
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
  test("bounded recovery requires protected evidence, permits exactly attempt 2, and PostgreSQL rejects attempt 3", async () => {
    const { intent, attempt } = await createFixture();
    await repository.appendIntent(intent);
    const previous = await repository.appendAttempt(attempt);
    await claimManualSigning(previous);
    await insertRecoveryAuthorization(intent, previous);
    const recovery = buildRecoveryAttempt(intent, previous);

    await assert.rejects(
      repository.appendAttempt(recovery),
      SharedIssuancePersistenceConflictError,
    );

    await assert.rejects(
      appSql`
        INSERT INTO project_issuance_recovery_evidence (
          issuance_request_id, superseded_attempt_id,
          issuance_intent_fingerprint, superseded_transaction_hash,
          network, lookup_status, lookup_observed_ledger,
          lookup_observed_ledger_closed_at, sequence_observed_ledger,
          sequence_observed_ledger_closed_at, issuer_public_key,
          issuer_sequence, verifier_identity, verification_policy_version,
          verified_at
        ) VALUES (
          ${intent.issuanceRequestId}, ${previous.attemptId},
          ${intent.issuanceIntentFingerprint}, ${previous.transactionHash},
          'testnet', 'not_found', 900,
          ${new Date((previous.validUntil + 1) * 1_000)}, 900,
          ${new Date((previous.validUntil + 1) * 1_000)},
          ${intent.issuerPublicKey}, ${previous.sourceSequence},
          'forged-app', 'forged-app',
          ${new Date((previous.validUntil + 2) * 1_000)}
        )
      `,
    );

    const evidence = await validateBoundedSharedIssuanceRecoveryEvidence({
      reader: recoveryReaderFor(previous),
      intent,
      attempt: previous,
      recoveryAttempt: recovery,
      nowUnix: previous.validUntil + 2,
      verifierIdentity: "official-stellar-testnet-horizon",
      verificationPolicyVersion: "db-test-bounded-recovery-v1",
    });
    await writer.appendRecoveryEvidence(evidence);

    const storedRecovery = await repository.appendAttempt(recovery);
    assert.equal(storedRecovery.attemptNumber, 2);
    assert.equal(
      (await repository.listAttempts(intent.issuanceRequestId)).length,
      2,
    );

    await assert.rejects(
      repository.claimSigningMode({
        attemptId: recovery.attemptId,
        transactionHash: recovery.transactionHash,
        signingMode: "private",
      }),
    );
    const manualClaim = await repository.claimSigningMode({
      attemptId: recovery.attemptId,
      transactionHash: recovery.transactionHash,
      signingMode: "manual",
    });
    assert.equal(manualClaim?.signingMode, "manual");

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
          ${randomUUID()}, ${intent.issuanceRequestId},
          ${intent.issuanceIntentFingerprint}, 3, ${"9".repeat(64)},
          ${"8".repeat(64)}, ${previous.sourceSequence},
          ${previous.feeStroops}, ${recovery.validUntil + 10},
          ${recovery.validUntil + 310}, ${intent.issuerPublicKey},
          1, 'payment', ${intent.issuerPublicKey}, ${intent.assetCode},
          ${intent.issuerPublicKey}, ${intent.destinationPublicKey},
          ${intent.amount}, ${new Date((recovery.validUntil + 10) * 1_000)}
        )
      `,
      (error: unknown) =>
        (error as { constraint_name?: string }).constraint_name ===
        "project_issuance_attempt_number_bounded_recovery",
    );
  });

  test("bounded recovery evidence fails closed for signed attempt 1, confirmation, or changed sequence", async () => {
    const signedFixture = await createFixture();
    await repository.appendIntent(signedFixture.intent);
    const signedAttempt = await repository.appendAttempt(signedFixture.attempt);
    await claimManualSigning(signedAttempt);
    await repository.recordSignedEnvelope({
      attemptId: signedAttempt.attemptId,
      transactionHash: signedAttempt.transactionHash,
      signedEnvelopeXdrSha256: signedFixture.signedEnvelopeXdrSha256,
    });
    await insertRecoveryAuthorization(signedFixture.intent, signedAttempt);

    const signedRecovery = buildRecoveryAttempt(
      signedFixture.intent,
      signedAttempt,
    );
    await assert.rejects(
      validateBoundedSharedIssuanceRecoveryEvidence({
        reader: recoveryReaderFor(signedAttempt),
        intent: signedFixture.intent,
        attempt: (await repository.getAttempt(signedAttempt.attemptId))!,
        recoveryAttempt: signedRecovery,
        nowUnix: signedAttempt.validUntil + 2,
        verifierIdentity: "official-stellar-testnet-horizon",
        verificationPolicyVersion: "db-test-bounded-recovery-v1",
      }),
      (error: unknown) =>
        error instanceof Error &&
        "code" in error &&
        error.code === "recovery_not_eligible",
    );

    await admin.unsafe(
      "TRUNCATE project_issuance_recovery_evidence, project_issuance_ledger_confirmations, project_issuance_transaction_attempts, project_issuance_full_intents, project_issuance_intents, project_profile_owners, project_profiles, workflow_intents, audit_events CASCADE",
    );
    const changed = await createFixture();
    await repository.appendIntent(changed.intent);
    const previous = await repository.appendAttempt(changed.attempt);
    await claimManualSigning(previous);
    await insertRecoveryAuthorization(changed.intent, previous);

    await assert.rejects(
      validateBoundedSharedIssuanceRecoveryEvidence({
        reader: recoveryReaderFor(previous, "124"),
        intent: changed.intent,
        attempt: previous,
        recoveryAttempt: buildRecoveryAttempt(changed.intent, previous),
        nowUnix: previous.validUntil + 2,
        verifierIdentity: "official-stellar-testnet-horizon",
        verificationPolicyVersion: "db-test-bounded-recovery-v1",
      }),
      (error: unknown) =>
        error instanceof Error &&
        "code" in error &&
        error.code === "recovery_sequence_changed",
    );
  });

}

function roleUrl(source: string, username: string, password: string): string {
  const url = new URL(source);
  url.username = username;
  url.password = password;
  return url.toString();
}
