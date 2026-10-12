import assert from "node:assert/strict";
import test from "node:test";

import { Keypair, Networks, TransactionBuilder } from "@stellar/stellar-sdk";

import {
  SHARED_ISSUER_TESTNET_PASSPHRASE,
  SharedIssuerIssuanceError,
  assertReplacementPreservesIssuanceIntent,
  assertSignedEnvelopeAuthorizedForSubmission,
  assertSignedEnvelopeMatchesPlan,
  assertSigningRequestMatchesPlan,
  assertSubmissionHashMatchesPlan,
  buildSharedIssuerIssuancePlan,
  classifySharedIssuerRecovery,
  createSharedIssuerSigningRequest,
  type SharedIssuerIssuancePreconditions,
  type SharedIssuerIssuanceRequest,
} from "../lib/stellar/shared-issuer-issuance";

const ISSUER_KEYPAIR = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 41));
const SIGNER_B_KEYPAIR = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 43));
const UNKNOWN_SIGNER_KEYPAIR = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 44));
const ISSUER = ISSUER_KEYPAIR.publicKey();
const DESTINATION = Keypair.fromRawEd25519Seed(
  Buffer.alloc(32, 42),
).publicKey();

const SIGNER_AUTHORIZATION = {
  network: "testnet" as const,
  networkPassphrase: SHARED_ISSUER_TESTNET_PASSPHRASE,
  issuerPublicKey: ISSUER,
  requiredWeight: 2,
  signers: [
    { publicKey: ISSUER_KEYPAIR.publicKey(), weight: 1 },
    { publicKey: SIGNER_B_KEYPAIR.publicKey(), weight: 1 },
  ],
};

const REQUEST: SharedIssuerIssuanceRequest = {
  projectId: "project-123",
  assetCode: "NOVA",
  issuerPublicKey: ISSUER,
  destinationPublicKey: DESTINATION,
  amount: "125.5",
  network: "testnet",
  networkPassphrase: SHARED_ISSUER_TESTNET_PASSPHRASE,
  validFrom: 1_800_000_000,
  validUntil: 1_800_000_300,
};

const PRECONDITIONS: SharedIssuerIssuancePreconditions = {
  assetCodeReservedForProject: true,
  issuerSequence: "123456",
  issuerSpendableNativeStroops: "5000000",
  feeStroops: "100",
  destinationTrustline: {
    network: "testnet",
    networkPassphrase: SHARED_ISSUER_TESTNET_PASSPHRASE,
    destinationPublicKey: DESTINATION,
    assetCode: "NOVA",
    issuerPublicKey: ISSUER,
    observedLedger: 900,
    exists: true,
    authorized: true,
    balance: "10",
    limit: "1000",
    buyingLiabilities: "0",
  },
};

function errorCode(error: unknown): string | undefined {
  return error instanceof SharedIssuerIssuanceError ? error.code : undefined;
}

test("builds one canonical Testnet payment envelope for an approved issuance", () => {
  const plan = buildSharedIssuerIssuancePlan(REQUEST, PRECONDITIONS);
  const transaction = TransactionBuilder.fromXDR(
    plan.unsignedEnvelopeXdr,
    Networks.TESTNET,
  );

  assert.equal(plan.intent.assetCode, "NOVA");
  assert.equal(plan.intent.issuerPublicKey, ISSUER);
  assert.equal(plan.intent.destinationPublicKey, DESTINATION);
  assert.equal(plan.intent.amount, "125.5000000");
  assert.equal(plan.sourceSequence, "123456");
  assert.equal(transaction.operations.length, 1);

  const [operation] = transaction.operations;
  assert.equal(operation.type, "payment");

  if (operation.type === "payment") {
    assert.equal(operation.destination, DESTINATION);
    assert.equal(operation.amount, "125.5000000");
    assert.equal(operation.asset.toString(), `NOVA:${ISSUER}`);
  }

  assert.equal(
    Buffer.from(transaction.hash()).toString("hex"),
    plan.transactionHash,
  );
});

test("canonical intent fingerprint is stable across sequence, fee, and timebound rebuilds", () => {
  const first = buildSharedIssuerIssuancePlan(REQUEST, PRECONDITIONS);
  const second = buildSharedIssuerIssuancePlan(
    {
      ...REQUEST,
      validFrom: REQUEST.validFrom + 60,
      validUntil: REQUEST.validUntil + 60,
    },
    {
      ...PRECONDITIONS,
      issuerSequence: "123457",
      feeStroops: "200",
    },
  );

  assert.equal(first.intentFingerprint, second.intentFingerprint);
  assert.notEqual(first.transactionHash, second.transactionHash);
});

test("different issuance amount changes the canonical intent fingerprint", () => {
  const first = buildSharedIssuerIssuancePlan(REQUEST, PRECONDITIONS);
  const second = buildSharedIssuerIssuancePlan(
    { ...REQUEST, amount: "126" },
    PRECONDITIONS,
  );

  assert.notEqual(first.intentFingerprint, second.intentFingerprint);
});

test("rejects duplicate or unreserved asset codes before transaction construction", () => {
  assert.throws(
    () =>
      buildSharedIssuerIssuancePlan(REQUEST, {
        ...PRECONDITIONS,
        assetCodeReservedForProject: false,
      }),
    (error) => errorCode(error) === "asset_code_not_reserved",
  );
});

test("rejects invalid asset code", () => {
  assert.throws(
    () =>
      buildSharedIssuerIssuancePlan(
        { ...REQUEST, assetCode: "BAD-CODE" },
        PRECONDITIONS,
      ),
    (error) => errorCode(error) === "invalid_asset_code",
  );
});

test("rejects incorrect network passphrase and any non-Testnet network value", () => {
  assert.throws(
    () =>
      buildSharedIssuerIssuancePlan(
        { ...REQUEST, networkPassphrase: Networks.PUBLIC },
        PRECONDITIONS,
      ),
    (error) => errorCode(error) === "invalid_network_passphrase",
  );

  assert.throws(
    () =>
      buildSharedIssuerIssuancePlan(
        {
          ...REQUEST,
          network: "public" as "testnet",
        },
        PRECONDITIONS,
      ),
    (error) => errorCode(error) === "invalid_network",
  );
});

test("rejects missing, unauthorized, and capacity-exceeded destination trustlines", () => {
  assert.throws(
    () =>
      buildSharedIssuerIssuancePlan(REQUEST, {
        ...PRECONDITIONS,
        destinationTrustline: {
          ...PRECONDITIONS.destinationTrustline,
          exists: false,
        },
      }),
    (error) => errorCode(error) === "trustline_missing",
  );

  assert.throws(
    () =>
      buildSharedIssuerIssuancePlan(REQUEST, {
        ...PRECONDITIONS,
        destinationTrustline: {
          ...PRECONDITIONS.destinationTrustline,
          authorized: false,
        },
      }),
    (error) => errorCode(error) === "trustline_unauthorized",
  );

  assert.throws(
    () =>
      buildSharedIssuerIssuancePlan(REQUEST, {
        ...PRECONDITIONS,
        destinationTrustline: {
          ...PRECONDITIONS.destinationTrustline,
          balance: "900",
          limit: "1000",
        },
      }),
    (error) => errorCode(error) === "trustline_capacity_exceeded",
  );
});

test("trustline capacity includes buying liabilities and permits the exact boundary", () => {
  assert.doesNotThrow(() =>
    buildSharedIssuerIssuancePlan(
      { ...REQUEST, amount: "100" },
      {
        ...PRECONDITIONS,
        destinationTrustline: {
          ...PRECONDITIONS.destinationTrustline,
          balance: "800",
          buyingLiabilities: "100",
          limit: "1000",
        },
      },
    ),
  );

  assert.throws(
    () =>
      buildSharedIssuerIssuancePlan(
        { ...REQUEST, amount: "100.0000001" },
        {
          ...PRECONDITIONS,
          destinationTrustline: {
            ...PRECONDITIONS.destinationTrustline,
            balance: "800",
            buyingLiabilities: "100",
            limit: "1000",
          },
        },
      ),
    (error) => errorCode(error) === "trustline_capacity_exceeded",
  );
});

test("rejects a trustline snapshot bound to the wrong identity or network", () => {
  const mismatches = [
    { destinationPublicKey: Keypair.random().publicKey() },
    { assetCode: "OTHER" },
    { issuerPublicKey: Keypair.random().publicKey() },
    { networkPassphrase: Networks.PUBLIC },
    { observedLedger: 0 },
  ];

  for (const mismatch of mismatches) {
    assert.throws(
      () =>
        buildSharedIssuerIssuancePlan(REQUEST, {
          ...PRECONDITIONS,
          destinationTrustline: {
            ...PRECONDITIONS.destinationTrustline,
            ...mismatch,
          } as SharedIssuerIssuancePreconditions["destinationTrustline"],
        }),
      (error) =>
        errorCode(error) === "trustline_snapshot_mismatch" ||
        errorCode(error) === "invalid_ledger_observation",
    );
  }
});

test("rejects insufficient issuer fee headroom", () => {
  assert.throws(
    () =>
      buildSharedIssuerIssuancePlan(REQUEST, {
        ...PRECONDITIONS,
        issuerSpendableNativeStroops: "99",
        feeStroops: "100",
      }),
    (error) => errorCode(error) === "insufficient_fee_balance",
  );
});

test("rejects invalid amount, sequence, and timebounds", () => {
  assert.throws(
    () =>
      buildSharedIssuerIssuancePlan(
        { ...REQUEST, amount: "1.00000001" },
        PRECONDITIONS,
      ),
    (error) => errorCode(error) === "invalid_amount",
  );

  assert.throws(
    () =>
      buildSharedIssuerIssuancePlan(REQUEST, {
        ...PRECONDITIONS,
        issuerSequence: "-1",
      }),
    (error) => errorCode(error) === "invalid_sequence",
  );

  assert.throws(
    () =>
      buildSharedIssuerIssuancePlan(
        { ...REQUEST, validUntil: REQUEST.validFrom },
        PRECONDITIONS,
      ),
    (error) => errorCode(error) === "invalid_timebounds",
  );
});

test("signer boundary accepts only the exact reviewed canonical plan", () => {
  const plan = buildSharedIssuerIssuancePlan(REQUEST, PRECONDITIONS);
  const signingRequest = createSharedIssuerSigningRequest(plan);

  assert.doesNotThrow(() =>
    assertSigningRequestMatchesPlan(signingRequest, plan),
  );

  assert.throws(
    () =>
      assertSigningRequestMatchesPlan(
        { ...signingRequest, transactionHash: "0".repeat(64) },
        plan,
      ),
    (error) => errorCode(error) === "unauthorized_signing_request",
  );
});

test("signed envelope validation accepts signatures without permitting transaction mutation", () => {
  const plan = buildSharedIssuerIssuancePlan(REQUEST, PRECONDITIONS);
  const transaction = TransactionBuilder.fromXDR(
    plan.unsignedEnvelopeXdr,
    Networks.TESTNET,
  );

  transaction.sign(ISSUER_KEYPAIR);
  assert.equal(
    assertSignedEnvelopeMatchesPlan(transaction.toXDR(), plan),
    plan.transactionHash,
  );

  const mutatedPlan = buildSharedIssuerIssuancePlan(
    { ...REQUEST, amount: "126" },
    PRECONDITIONS,
  );

  assert.throws(
    () => assertSignedEnvelopeMatchesPlan(transaction.toXDR(), mutatedPlan),
    (error) => errorCode(error) === "signed_envelope_mismatch",
  );
});

test("submission authorization requires valid approved signatures meeting configured weight", () => {
  const plan = buildSharedIssuerIssuancePlan(REQUEST, PRECONDITIONS);

  const unsigned = TransactionBuilder.fromXDR(
    plan.unsignedEnvelopeXdr,
    Networks.TESTNET,
  );
  assert.throws(
    () =>
      assertSignedEnvelopeAuthorizedForSubmission(
        unsigned.toXDR(),
        plan,
        SIGNER_AUTHORIZATION,
      ),
    (error) => errorCode(error) === "missing_required_signatures",
  );

  const insufficient = TransactionBuilder.fromXDR(
    plan.unsignedEnvelopeXdr,
    Networks.TESTNET,
  );
  insufficient.sign(ISSUER_KEYPAIR);
  assert.throws(
    () =>
      assertSignedEnvelopeAuthorizedForSubmission(
        insufficient.toXDR(),
        plan,
        SIGNER_AUTHORIZATION,
      ),
    (error) => errorCode(error) === "missing_required_signatures",
  );

  const invalid = TransactionBuilder.fromXDR(
    plan.unsignedEnvelopeXdr,
    Networks.TESTNET,
  );
  invalid.sign(ISSUER_KEYPAIR, UNKNOWN_SIGNER_KEYPAIR);
  assert.throws(
    () =>
      assertSignedEnvelopeAuthorizedForSubmission(
        invalid.toXDR(),
        plan,
        SIGNER_AUTHORIZATION,
      ),
    (error) => errorCode(error) === "invalid_signature",
  );

  const authorized = TransactionBuilder.fromXDR(
    plan.unsignedEnvelopeXdr,
    Networks.TESTNET,
  );
  authorized.sign(ISSUER_KEYPAIR, SIGNER_B_KEYPAIR);
  assert.equal(
    assertSignedEnvelopeAuthorizedForSubmission(
      authorized.toXDR(),
      plan,
      SIGNER_AUTHORIZATION,
    ),
    plan.transactionHash,
  );
});

test("replacement transactions must preserve the immutable logical issuance intent", () => {
  const original = buildSharedIssuerIssuancePlan(REQUEST, PRECONDITIONS);
  const safeReplacement = buildSharedIssuerIssuancePlan(
    {
      ...REQUEST,
      validFrom: REQUEST.validFrom + 600,
      validUntil: REQUEST.validUntil + 600,
    },
    {
      ...PRECONDITIONS,
      issuerSequence: "123457",
    },
  );
  const otherDestination = Keypair.random().publicKey();
  const changedDestination = buildSharedIssuerIssuancePlan(
    {
      ...REQUEST,
      destinationPublicKey: otherDestination,
    },
    {
      ...PRECONDITIONS,
      destinationTrustline: {
        ...PRECONDITIONS.destinationTrustline,
        destinationPublicKey: otherDestination,
      },
    },
  );

  assert.doesNotThrow(() =>
    assertReplacementPreservesIssuanceIntent(original, safeReplacement),
  );
  assert.throws(
    () => assertReplacementPreservesIssuanceIntent(original, changedDestination),
    (error) => errorCode(error) === "issuance_intent_mismatch",
  );
});

test("submission response must match the precomputed canonical transaction hash", () => {
  const plan = buildSharedIssuerIssuancePlan(REQUEST, PRECONDITIONS);

  assert.doesNotThrow(() =>
    assertSubmissionHashMatchesPlan({ hash: plan.transactionHash }, plan),
  );

  assert.throws(
    () => assertSubmissionHashMatchesPlan({ hash: "f".repeat(64) }, plan),
    (error) => errorCode(error) === "submission_hash_mismatch",
  );
});

test("lost response recovery confirms an already-successful transaction without resubmission", () => {
  const plan = buildSharedIssuerIssuancePlan(REQUEST, PRECONDITIONS);

  assert.deepEqual(
    classifySharedIssuerRecovery({
      plan,
      lookup: {
        status: "confirmed",
        hash: plan.transactionHash,
        ledger: 999,
      },
      currentIssuerSequence: "123457",
      nowUnix: REQUEST.validFrom + 30,
    }),
    {
      action: "confirmed",
      hash: plan.transactionHash,
      ledger: 999,
    },
  );
});

test("not-found recovery retries only the same live envelope while outcome remains ambiguous", () => {
  const plan = buildSharedIssuerIssuancePlan(REQUEST, PRECONDITIONS);

  assert.deepEqual(
    classifySharedIssuerRecovery({
      plan,
      lookup: {
        status: "not_found",
        observedLedger: 1000,
        authoritative: false,
      },
      currentIssuerSequence: "123456",
      nowUnix: REQUEST.validFrom + 30,
    }),
    { action: "retry_same_envelope" },
  );
});

test("expired ambiguous transactions wait for authoritative reconciliation before rebuild", () => {
  const plan = buildSharedIssuerIssuancePlan(REQUEST, PRECONDITIONS);

  assert.deepEqual(
    classifySharedIssuerRecovery({
      plan,
      lookup: {
        status: "not_found",
        observedLedger: 1000,
        authoritative: false,
      },
      currentIssuerSequence: "123456",
      nowUnix: REQUEST.validUntil,
    }),
    { action: "await_authoritative_reconciliation" },
  );

  assert.deepEqual(
    classifySharedIssuerRecovery({
      plan,
      lookup: {
        status: "not_found",
        observedLedger: 1005,
        authoritative: true,
      },
      currentIssuerSequence: "123456",
      nowUnix: REQUEST.validUntil + 30,
    }),
    { action: "rebuild_expired" },
  );
});

test("issuer sequence advancement wins over expiry and requires reconciliation", () => {
  const plan = buildSharedIssuerIssuancePlan(REQUEST, PRECONDITIONS);

  assert.deepEqual(
    classifySharedIssuerRecovery({
      plan,
      lookup: {
        status: "not_found",
        observedLedger: 1010,
        authoritative: true,
      },
      currentIssuerSequence: "123457",
      nowUnix: REQUEST.validUntil + 30,
    }),
    { action: "reconcile_sequence" },
  );
});

test("delayed lookup visibility can later resolve the same lost-response transaction", () => {
  const plan = buildSharedIssuerIssuancePlan(REQUEST, PRECONDITIONS);

  assert.deepEqual(
    classifySharedIssuerRecovery({
      plan,
      lookup: {
        status: "not_found",
        observedLedger: 1000,
        authoritative: false,
      },
      currentIssuerSequence: "123456",
      nowUnix: REQUEST.validUntil + 1,
    }),
    { action: "await_authoritative_reconciliation" },
  );

  assert.deepEqual(
    classifySharedIssuerRecovery({
      plan,
      lookup: {
        status: "confirmed",
        hash: plan.transactionHash,
        ledger: 1001,
      },
      currentIssuerSequence: "123457",
      nowUnix: REQUEST.validUntil + 20,
    }),
    {
      action: "confirmed",
      hash: plan.transactionHash,
      ledger: 1001,
    },
  );
});
