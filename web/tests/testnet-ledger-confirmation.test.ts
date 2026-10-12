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

const ISSUER = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 111)).publicKey();
const DESTINATION = Keypair.fromRawEd25519Seed(
  Buffer.alloc(32, 112),
).publicKey();
const OWNER = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 113)).publicKey();
const PROJECT_ID = "00000000-0000-4000-8000-000000000311";
const REQUEST_ID = "00000000-0000-4000-8000-000000000312";
const ATTEMPT_ID = "00000000-0000-4000-8000-000000000313";
const NOW = 1_800_000_200_000;

function resultXdr(success = true): string {
  const result = success
    ? xdr.TransactionResultResult.txSuccess([])
    : xdr.TransactionResultResult.txFailed([]);
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
    authoritative: true,
    network: "testnet",
    networkPassphrase: Networks.TESTNET,
    transactionHash: plan.transactionHash,
    envelopeXdr: plan.unsignedEnvelopeXdr,
    resultXdr: successfulResultXdr,
    ledgerSequence: 500,
    ledgerClosedAt: new Date(NOW - 500).toISOString(),
    observedLedger: 501,
    observedAt: new Date(NOW - 250).toISOString(),
  };
  return { intent, attempt, lookup };
}

class FixtureReader implements StellarTestnetLedgerReader {
  constructor(
    public lookup: StellarTestnetTransactionLookup,
    public sequence: StellarTestnetAccountSequenceEvidence,
  ) {}

  async lookupTransaction() {
    return this.lookup;
  }

  async readAccountSequence() {
    return this.sequence;
  }
}

function readerFor(
  lookup: StellarTestnetTransactionLookup,
  sequence = "123",
): FixtureReader {
  return new FixtureReader(lookup, {
    network: "testnet",
    networkPassphrase: Networks.TESTNET,
    accountPublicKey: ISSUER,
    sequence,
    observedLedger: lookup.observedLedger,
    observedAt: new Date(NOW).toISOString(),
    authoritative: true,
  });
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

test("rejects forged, failed, non-authoritative, and stale ledger evidence", async () => {
  const { intent, attempt, lookup } = fixture();
  const variants: StellarTestnetTransactionLookup[] = [
    {
      ...lookup,
      networkPassphrase: Networks.PUBLIC as typeof Networks.TESTNET,
    },
    { ...lookup, transactionHash: "f".repeat(64) },
    { ...lookup, resultXdr: resultXdr(false) },
    { ...lookup, authoritative: false },
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
    authoritative: false,
    network: "testnet",
    networkPassphrase: Networks.TESTNET,
    transactionHash: attempt.transactionHash,
    observedLedger: 600,
    observedAt: new Date(NOW).toISOString(),
  };

  assert.deepEqual(
    await reconcileSharedIssuanceAttempt({
      reader: readerFor(notFound),
      intent,
      attempt,
      nowUnix: attempt.validUntil,
    }),
    { action: "await_authoritative_reconciliation" },
  );
  assert.deepEqual(
    await reconcileSharedIssuanceAttempt({
      reader: readerFor({ ...notFound, authoritative: true }, "124"),
      intent,
      attempt,
      nowUnix: attempt.validUntil + 1,
    }),
    { action: "reconcile_sequence" },
  );
  assert.deepEqual(
    await reconcileSharedIssuanceAttempt({
      reader: readerFor({ ...notFound, authoritative: true }),
      intent,
      attempt,
      nowUnix: attempt.validUntil + 1,
    }),
    {
      action: "replacement_permitted",
      issuanceIntentFingerprint: intent.issuanceIntentFingerprint,
      supersededAttemptId: attempt.attemptId,
      nextAttemptNumber: 2,
    },
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
