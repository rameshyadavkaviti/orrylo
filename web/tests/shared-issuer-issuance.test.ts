import assert from "node:assert/strict";
import test from "node:test";

import {
  Keypair,
  Networks,
  TransactionBuilder,
} from "@stellar/stellar-sdk";

import {
  SHARED_ISSUER_TESTNET_PASSPHRASE,
  SharedIssuerIssuanceError,
  assertSignedEnvelopeMatchesPlan,
  assertSigningRequestMatchesPlan,
  assertSubmissionHashMatchesPlan,
  buildSharedIssuerIssuancePlan,
  classifySharedIssuerRecovery,
  createSharedIssuerSigningRequest,
  type SharedIssuerIssuancePreconditions,
  type SharedIssuerIssuanceRequest,
} from "../lib/stellar/shared-issuer-issuance";

const ISSUER = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 41)).publicKey();
const DESTINATION = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 42)).publicKey();

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
    exists: true,
    authorized: true,
    balance: "10",
    limit: "1000",
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
    transaction.hash().toString("hex"),
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
          exists: true,
          authorized: true,
          balance: "900",
          limit: "1000",
        },
      }),
    (error) => errorCode(error) === "trustline_capacity_exceeded",
  );
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
  const issuerKeypair = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 41));
  const plan = buildSharedIssuerIssuancePlan(REQUEST, PRECONDITIONS);
  const transaction = TransactionBuilder.fromXDR(
    plan.unsignedEnvelopeXdr,
    Networks.TESTNET,
  );

  transaction.sign(issuerKeypair);
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

test("submission response must match the precomputed canonical transaction hash", () => {
  const plan = buildSharedIssuerIssuancePlan(REQUEST, PRECONDITIONS);

  assert.doesNotThrow(() =>
    assertSubmissionHashMatchesPlan({ hash: plan.transactionHash }, plan),
  );

  assert.throws(
    () =>
      assertSubmissionHashMatchesPlan(
        { hash: "f".repeat(64) },
        plan,
      ),
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

test("not-found recovery distinguishes safe same-envelope retry, expiry, and sequence conflict", () => {
  const plan = buildSharedIssuerIssuancePlan(REQUEST, PRECONDITIONS);

  assert.deepEqual(
    classifySharedIssuerRecovery({
      plan,
      lookup: { status: "not_found" },
      currentIssuerSequence: "123456",
      nowUnix: REQUEST.validFrom + 30,
    }),
    { action: "retry_same_envelope" },
  );

  assert.deepEqual(
    classifySharedIssuerRecovery({
      plan,
      lookup: { status: "not_found" },
      currentIssuerSequence: "123456",
      nowUnix: REQUEST.validUntil,
    }),
    { action: "rebuild_expired" },
  );

  assert.deepEqual(
    classifySharedIssuerRecovery({
      plan,
      lookup: { status: "not_found" },
      currentIssuerSequence: "123457",
      nowUnix: REQUEST.validFrom + 30,
    }),
    { action: "reconcile_sequence" },
  );
});
