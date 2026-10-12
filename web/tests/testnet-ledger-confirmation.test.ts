import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";

import {
  Keypair,
  Networks,
  Transaction,
  TransactionBuilder,
  xdr,
} from "@stellar/stellar-sdk";

import type {
  ImmutableSharedIssuanceIntent,
  ImmutableSharedIssuanceTransactionAttempt,
} from "../lib/server/projects/shared-issuance-persistence";
import {
  SHARED_ISSUER_TESTNET_PASSPHRASE,
  buildSharedIssuerIssuancePlan,
} from "../lib/stellar/shared-issuer-issuance";
import {
  AuthoritativeSharedIssuanceConfirmationValidator,
  StellarLedgerEvidenceError,
  UnavailableStellarTestnetLedgerReader,
  reconcileSharedIssuanceAttempt,
  type StellarTestnetAccountSequenceEvidence,
  type StellarTestnetLedgerReader,
  type StellarTestnetTransactionLookup,
} from "../lib/stellar/testnet-ledger-confirmation";

const ISSUER_KEYPAIR = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 111));
const ISSUER = ISSUER_KEYPAIR.publicKey();
const DESTINATION = Keypair.fromRawEd25519Seed(
  Buffer.alloc(32, 112),
).publicKey();
const OWNER = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 113)).publicKey();
const PROJECT_ID = "00000000-0000-4000-8000-000000000311";
const REQUEST_ID = "00000000-0000-4000-8000-000000000312";
const ATTEMPT_ID = "00000000-0000-4000-8000-000000000313";
const NOW = 1_800_000_200_000;

function paymentOperationResult(success = true): xdr.OperationResult {
  return xdr.OperationResult.opInner(
    xdr.OperationResultTr.payment(
      success
        ? xdr.PaymentResult.paymentSuccess()
        : xdr.PaymentResult.paymentUnderfunded(),
    ),
  );
}

function resultXdr(
  options: {
    transactionSuccess?: boolean;
    operationResults?: xdr.OperationResult[];
  } = {},
): string {
  const transactionSuccess = options.transactionSuccess ?? true;
  const result = transactionSuccess
    ? xdr.TransactionResultResult.txSuccess(
        options.operationResults ?? [paymentOperationResult()],
      )
    : xdr.TransactionResultResult.txFailed(
        options.operationResults ?? [paymentOperationResult(false)],
      );
  return new xdr.TransactionResult({
    feeCharged: xdr.Int64.fromString("100"),
    result,
    ext: xdr.TransactionResultExt.v0(),
  }).toXDR("base64");
}

function fixture() {
  const plan = buildSharedIssuerIssuancePlan(
    {
      projectId: PROJECT_ID,
      assetCode: "NOVA",
      issuerPublicKey: ISSUER,
      destinationPublicKey: DESTINATION,
      amount: "100",
      network: "testnet",
      networkPassphrase: SHARED_ISSUER_TESTNET_PASSPHRASE,
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
        networkPassphrase: SHARED_ISSUER_TESTNET_PASSPHRASE,
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
    issuanceRequestId: REQUEST_ID,
    issuanceIntentFingerprint: plan.intentFingerprint,
    reservationFingerprint: "a".repeat(64),
    projectId: PROJECT_ID,
    ownerPublicKey: OWNER,
    network: "testnet",
    networkPassphraseHash: createHash("sha256")
      .update(Networks.TESTNET)
      .digest("hex"),
    assetCode: plan.intent.assetCode,
    issuerPublicKey: plan.intent.issuerPublicKey,
    destinationPublicKey: plan.intent.destinationPublicKey,
    amount: plan.intent.amount,
    policyVersion: plan.intent.policyVersion,
    createdAt: new Date(NOW - 2_000).toISOString(),
  };
  const attempt: ImmutableSharedIssuanceTransactionAttempt = {
    attemptId: ATTEMPT_ID,
    issuanceRequestId: REQUEST_ID,
    issuanceIntentFingerprint: plan.intentFingerprint,
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
    createdAt: new Date(NOW - 1_000).toISOString(),
  };
  const successfulResultXdr = resultXdr();
  const lookup: StellarTestnetTransactionLookup = {
    status: "confirmed",
    network: "testnet",
    networkPassphrase: Networks.TESTNET,
    transactionHash: plan.transactionHash,
    resultTransactionHash: plan.transactionHash,
    envelopeXdr: plan.unsignedEnvelopeXdr,
    resultXdr: successfulResultXdr,
    ledgerSequence: 500,
    ledgerClosedAt: new Date(NOW - 500).toISOString(),
    observedLedger: 501,
    observedAt: new Date(NOW - 250).toISOString(),
    observedLedgerClosedAt: new Date(NOW - 500).toISOString(),
  };
  return { intent, attempt, lookup };
}

function signedFixture() {
  const base = fixture();
  const transaction = TransactionBuilder.fromXDR(
    base.lookup.status === "confirmed" ? base.lookup.envelopeXdr : "",
    Networks.TESTNET,
  );
  if (!(transaction instanceof Transaction)) {
    assert.fail("expected classic transaction");
  }
  transaction.sign(ISSUER_KEYPAIR);
  const signedEnvelopeXdr = transaction.toXDR();
  const signedEnvelopeXdrSha256 = createHash("sha256")
    .update(signedEnvelopeXdr)
    .digest("hex");
  return {
    ...base,
    attempt: { ...base.attempt, signedEnvelopeXdrSha256 },
    lookup: {
      ...base.lookup,
      envelopeXdr: signedEnvelopeXdr,
      resultTransactionHash: base.attempt.transactionHash,
    } as StellarTestnetTransactionLookup,
    signedEnvelopeXdr,
    signedEnvelopeXdrSha256,
  };
}

class FixtureReader implements StellarTestnetLedgerReader {
  requestedTransactionHash?: string;

  constructor(
    public lookup: StellarTestnetTransactionLookup,
    public sequence: StellarTestnetAccountSequenceEvidence,
    public authority:
      "official_testnet_horizon" | "untrusted" = "official_testnet_horizon",
  ) {}

  async lookupTransaction(transactionHash: string) {
    this.requestedTransactionHash = transactionHash;
    return this.lookup;
  }

  async readAccountSequence() {
    return this.sequence;
  }
}

function readerFor(
  lookup: StellarTestnetTransactionLookup,
  sequence = "123",
  options: {
    authority?: "official_testnet_horizon" | "untrusted";
    lookupLedgerClosedAt?: string;
    sequenceLedgerClosedAt?: string;
  } = {},
): FixtureReader {
  const lookupLedgerClosedAt =
    options.lookupLedgerClosedAt ?? lookup.observedLedgerClosedAt;
  const sequenceLedgerClosedAt =
    options.sequenceLedgerClosedAt ?? lookupLedgerClosedAt;
  return new FixtureReader(
    {
      ...lookup,
      observedLedgerClosedAt: lookupLedgerClosedAt,
    },
    {
      network: "testnet",
      networkPassphrase: Networks.TESTNET,
      accountPublicKey: ISSUER,
      sequence,
      observedLedger: lookup.observedLedger,
      observedAt: new Date(
        Math.max(NOW, Date.parse(sequenceLedgerClosedAt)),
      ).toISOString(),
      observedLedgerClosedAt: sequenceLedgerClosedAt,
    },
    options.authority,
  );
}

test("validates exact authoritative raw-XDR evidence into an immutable confirmation", async () => {
  const { intent, attempt, lookup } = fixture();
  const confirmation =
    await new AuthoritativeSharedIssuanceConfirmationValidator(
      readerFor(lookup),
      { now: () => NOW },
    ).validate({
      confirmationId: randomUUID(),
      intent,
      attempt,
      verifierIdentity: "isolated-testnet-ledger-verifier",
      verificationPolicyVersion: "gate-a-v1",
    });

  assert.equal(confirmation.record.transactionHash, attempt.transactionHash);
  assert.equal(confirmation.record.projectId, intent.projectId);
  assert.equal(confirmation.record.ownerPublicKey, intent.ownerPublicKey);
  assert.equal(confirmation.record.resultSuccess, true);
  assert.equal(confirmation.record.ledgerSequence, 500);
});

test("accepts real signed XDR while preserving the signature-independent transaction hash", async () => {
  const { intent, attempt, lookup, signedEnvelopeXdrSha256 } = signedFixture();
  assert.notEqual(signedEnvelopeXdrSha256, attempt.envelopeXdrSha256);

  const confirmation =
    await new AuthoritativeSharedIssuanceConfirmationValidator(
      readerFor(lookup),
      { now: () => NOW },
    ).validate({
      confirmationId: randomUUID(),
      intent,
      attempt,
      verifierIdentity: "official-testnet-horizon",
      verificationPolicyVersion: "gate-a-v2",
    });

  assert.equal(confirmation.record.transactionHash, attempt.transactionHash);
  assert.equal(
    confirmation.record.signedEnvelopeXdrSha256,
    signedEnvelopeXdrSha256,
  );
});

test("rejects a signed envelope whose digest differs from the immutable attempt", async () => {
  const { intent, attempt, lookup } = signedFixture();
  const otherSigner = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 114));
  if (lookup.status !== "confirmed") assert.fail("expected confirmation");
  const transaction = TransactionBuilder.fromXDR(
    lookup.envelopeXdr,
    Networks.TESTNET,
  );
  if (!(transaction instanceof Transaction))
    assert.fail("expected transaction");
  transaction.sign(otherSigner);

  await assert.rejects(
    new AuthoritativeSharedIssuanceConfirmationValidator(
      readerFor({ ...lookup, envelopeXdr: transaction.toXDR() }),
      { now: () => NOW },
    ).validate({
      confirmationId: randomUUID(),
      intent,
      attempt,
      verifierIdentity: "official-testnet-horizon",
      verificationPolicyVersion: "gate-a-v2",
    }),
    (error: unknown) =>
      (error as StellarLedgerEvidenceError).code === "signed_envelope_mismatch",
  );
});

test("rejects empty, failed-payment, and unrelated success results", async () => {
  const { intent, attempt, lookup } = fixture();
  if (lookup.status !== "confirmed") assert.fail("expected confirmation");
  const invalidResults: StellarTestnetTransactionLookup[] = [
    { ...lookup, resultXdr: resultXdr({ operationResults: [] }) },
    {
      ...lookup,
      resultXdr: resultXdr({
        operationResults: [paymentOperationResult(false)],
      }),
    },
    {
      ...lookup,
      resultXdr: resultXdr({
        operationResults: [
          xdr.OperationResult.opInner(
            xdr.OperationResultTr.createAccount(
              xdr.CreateAccountResult.createAccountSuccess(),
            ),
          ),
        ],
      }),
    },
    { ...lookup, resultTransactionHash: "f".repeat(64) },
  ];

  for (const evidence of invalidResults) {
    await assert.rejects(
      new AuthoritativeSharedIssuanceConfirmationValidator(
        readerFor(evidence),
        { now: () => NOW },
      ).validate({
        confirmationId: randomUUID(),
        intent,
        attempt,
        verifierIdentity: "official-testnet-horizon",
        verificationPolicyVersion: "gate-a-v2",
      }),
      StellarLedgerEvidenceError,
    );
  }
});

test("enforces requested, returned, result, recomputed, and persisted transaction hash identity", async () => {
  const { intent, attempt, lookup } = fixture();
  const reader = readerFor(lookup);
  await new AuthoritativeSharedIssuanceConfirmationValidator(reader, {
    now: () => NOW,
  }).validate({
    confirmationId: randomUUID(),
    intent,
    attempt,
    verifierIdentity: "official-testnet-horizon",
    verificationPolicyVersion: "gate-a-v2",
  });
  assert.equal(reader.requestedTransactionHash, attempt.transactionHash);

  const cases = [
    {
      attempt,
      evidence: { ...lookup, transactionHash: "e".repeat(64) },
      code: "wrong_transaction",
    },
    {
      attempt,
      evidence: { ...lookup, resultTransactionHash: "d".repeat(64) },
      code: "result_mismatch",
    },
    {
      attempt: { ...attempt, transactionHash: "c".repeat(64) },
      evidence: {
        ...lookup,
        transactionHash: "c".repeat(64),
        resultTransactionHash: "c".repeat(64),
      },
      code: "envelope_mismatch",
    },
  ];

  for (const item of cases) {
    await assert.rejects(
      new AuthoritativeSharedIssuanceConfirmationValidator(
        readerFor(item.evidence),
        { now: () => NOW },
      ).validate({
        confirmationId: randomUUID(),
        intent,
        attempt: item.attempt,
        verifierIdentity: "official-testnet-horizon",
        verificationPolicyVersion: "gate-a-v2",
      }),
      (error: unknown) =>
        (error as StellarLedgerEvidenceError).code === item.code,
    );
  }
});

test("rejects forged, failed, non-authoritative, and stale ledger evidence", async () => {
  const { intent, attempt, lookup } = fixture();
  const variants: StellarTestnetTransactionLookup[] = [
    {
      ...lookup,
      networkPassphrase: Networks.PUBLIC as typeof Networks.TESTNET,
    },
    { ...lookup, transactionHash: "f".repeat(64) },
    { ...lookup, resultXdr: resultXdr({ transactionSuccess: false }) },
    { ...lookup, observedLedger: 499 },
    { ...lookup, observedAt: new Date(NOW - 1_000).toISOString() },
  ];

  for (const evidence of variants) {
    await assert.rejects(
      new AuthoritativeSharedIssuanceConfirmationValidator(
        readerFor(evidence),
        { now: () => NOW },
      ).validate({
        confirmationId: randomUUID(),
        intent,
        attempt,
        verifierIdentity: "isolated-testnet-ledger-verifier",
        verificationPolicyVersion: "gate-a-v1",
      }),
      StellarLedgerEvidenceError,
    );
  }

  await assert.rejects(
    new AuthoritativeSharedIssuanceConfirmationValidator(
      readerFor(lookup, "123", { authority: "untrusted" }),
      { now: () => NOW },
    ).validate({
      confirmationId: randomUUID(),
      intent,
      attempt,
      verifierIdentity: "untrusted-reader",
      verificationPolicyVersion: "gate-a-v2",
    }),
    (error: unknown) =>
      (error as StellarLedgerEvidenceError).code ===
      "non_authoritative_evidence",
  );
});

test("rejects evidence when issuer, asset, or amount differs from the immutable intent", async () => {
  const { intent, attempt, lookup } = fixture();
  const mismatches: ImmutableSharedIssuanceIntent[] = [
    { ...intent, issuerPublicKey: Keypair.random().publicKey() },
    { ...intent, assetCode: "OTHER" },
    { ...intent, amount: "101.0000000" },
  ];

  for (const mismatchedIntent of mismatches) {
    await assert.rejects(
      new AuthoritativeSharedIssuanceConfirmationValidator(readerFor(lookup), {
        now: () => NOW,
      }).validate({
        confirmationId: randomUUID(),
        intent: mismatchedIntent,
        attempt,
        verifierIdentity: "isolated-testnet-ledger-verifier",
        verificationPolicyVersion: "gate-a-v1",
      }),
      StellarLedgerEvidenceError,
    );
  }
});

test("reconciliation never permits replacement for ambiguity or sequence conflict", async () => {
  const { intent, attempt } = fixture();
  const notFound: StellarTestnetTransactionLookup = {
    status: "not_found",
    network: "testnet",
    networkPassphrase: Networks.TESTNET,
    transactionHash: attempt.transactionHash,
    observedLedger: 600,
    observedAt: new Date(NOW).toISOString(),
    observedLedgerClosedAt: new Date(NOW).toISOString(),
  };

  assert.deepEqual(
    await reconcileSharedIssuanceAttempt({
      reader: readerFor(notFound, "123", { authority: "untrusted" }),
      intent,
      attempt,
      nowUnix: attempt.validUntil,
    }),
    { action: "await_authoritative_reconciliation" },
  );
  assert.deepEqual(
    await reconcileSharedIssuanceAttempt({
      reader: readerFor(notFound, "124"),
      intent,
      attempt,
      nowUnix: attempt.validUntil + 1,
    }),
    { action: "reconcile_sequence" },
  );
  assert.deepEqual(
    await reconcileSharedIssuanceAttempt({
      reader: readerFor(notFound),
      intent,
      attempt,
      nowUnix: attempt.validUntil + 1,
    }),
    { action: "await_authoritative_reconciliation" },
  );
});

test("untrusted readers cannot advance confirmed, failed, or not-found reconciliation", async () => {
  const { intent, attempt, lookup } = fixture();
  if (lookup.status !== "confirmed") assert.fail("expected confirmation");
  const observations: StellarTestnetTransactionLookup[] = [
    lookup,
    {
      status: "failed",
      network: "testnet",
      networkPassphrase: Networks.TESTNET,
      transactionHash: attempt.transactionHash,
      ledgerSequence: 500,
      observedLedger: 501,
      observedAt: new Date(NOW).toISOString(),
      observedLedgerClosedAt: new Date(NOW).toISOString(),
    },
    {
      status: "not_found",
      network: "testnet",
      networkPassphrase: Networks.TESTNET,
      transactionHash: attempt.transactionHash,
      observedLedger: 501,
      observedAt: new Date(NOW).toISOString(),
      observedLedgerClosedAt: new Date(NOW).toISOString(),
    },
  ];

  for (const observation of observations) {
    assert.deepEqual(
      await reconcileSharedIssuanceAttempt({
        reader: readerFor(observation, "123", { authority: "untrusted" }),
        intent,
        attempt,
        nowUnix: attempt.validUntil + 1,
      }),
      { action: "await_authoritative_reconciliation" },
    );
  }
});

test("pre-expiry and mixed-freshness checkpoints cannot permit replacement", async () => {
  const { intent, attempt } = fixture();
  const notFound: StellarTestnetTransactionLookup = {
    status: "not_found",
    network: "testnet",
    networkPassphrase: Networks.TESTNET,
    transactionHash: attempt.transactionHash,
    observedLedger: 600,
    observedAt: new Date((attempt.validUntil + 2) * 1_000).toISOString(),
    observedLedgerClosedAt: new Date(
      (attempt.validUntil + 2) * 1_000,
    ).toISOString(),
  };
  const beforeExpiry = new Date((attempt.validUntil - 1) * 1_000).toISOString();
  const afterExpiry = new Date((attempt.validUntil + 1) * 1_000).toISOString();
  const checkpoints = [
    [beforeExpiry, beforeExpiry],
    [beforeExpiry, afterExpiry],
    [afterExpiry, beforeExpiry],
  ] as const;

  for (const [lookupLedgerClosedAt, sequenceLedgerClosedAt] of checkpoints) {
    assert.deepEqual(
      await reconcileSharedIssuanceAttempt({
        reader: readerFor(notFound, "123", {
          lookupLedgerClosedAt,
          sequenceLedgerClosedAt,
        }),
        intent,
        attempt,
        nowUnix: attempt.validUntil + 2,
      }),
      { action: "await_authoritative_reconciliation" },
    );
  }
});

test("post-expiry exact not-found plus unchanged sequence permits replacement", async () => {
  const { intent, attempt } = fixture();
  const afterExpiry = new Date((attempt.validUntil + 1) * 1_000).toISOString();
  const notFound: StellarTestnetTransactionLookup = {
    status: "not_found",
    network: "testnet",
    networkPassphrase: Networks.TESTNET,
    transactionHash: attempt.transactionHash,
    observedLedger: 600,
    observedAt: afterExpiry,
    observedLedgerClosedAt: afterExpiry,
  };

  assert.deepEqual(
    await reconcileSharedIssuanceAttempt({
      reader: readerFor(notFound, "123", {
        lookupLedgerClosedAt: afterExpiry,
        sequenceLedgerClosedAt: afterExpiry,
      }),
      intent,
      attempt,
      nowUnix: attempt.validUntil + 2,
    }),
    {
      action: "replacement_permitted",
      issuanceIntentFingerprint: intent.issuanceIntentFingerprint,
      supersededAttemptId: attempt.attemptId,
      nextAttemptNumber: 2,
    },
  );
});

test("advanced issuer sequence prevents blind replacement after fresh checkpoints", async () => {
  const { intent, attempt } = fixture();
  const afterExpiry = new Date((attempt.validUntil + 1) * 1_000).toISOString();
  const notFound: StellarTestnetTransactionLookup = {
    status: "not_found",
    network: "testnet",
    networkPassphrase: Networks.TESTNET,
    transactionHash: attempt.transactionHash,
    observedLedger: 600,
    observedAt: afterExpiry,
    observedLedgerClosedAt: afterExpiry,
  };

  assert.deepEqual(
    await reconcileSharedIssuanceAttempt({
      reader: readerFor(notFound, "124", {
        lookupLedgerClosedAt: afterExpiry,
        sequenceLedgerClosedAt: afterExpiry,
      }),
      intent,
      attempt,
      nowUnix: attempt.validUntil + 2,
    }),
    { action: "reconcile_sequence" },
  );
});

test("the production Testnet ledger reader remains explicitly unavailable", async () => {
  const reader = new UnavailableStellarTestnetLedgerReader();
  await assert.rejects(reader.lookupTransaction("a".repeat(64)), /unavailable/);
  await assert.rejects(reader.readAccountSequence(ISSUER), /unavailable/);
});

test("fixture transaction source sequence is bound to the recorded pre-build sequence", () => {
  const { attempt, lookup } = fixture();
  if (lookup.status !== "confirmed") assert.fail("expected confirmation");
  const transaction = TransactionBuilder.fromXDR(
    lookup.envelopeXdr,
    Networks.TESTNET,
  );
  if (!(transaction instanceof Transaction)) {
    assert.fail("expected classic transaction");
  }
  assert.equal(
    transaction.sequence,
    (BigInt(attempt.sourceSequence) + 1n).toString(),
  );
});
