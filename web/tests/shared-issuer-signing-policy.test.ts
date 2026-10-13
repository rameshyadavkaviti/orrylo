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
  SharedIssuerSigningPolicyError,
  createSharedIssuerMvpLiteSignerAuthorization,
  signDurableSharedIssuerTestnetEnvelope,
  type SharedIssuerSigningPrimitive,
} from "../lib/stellar/shared-issuer-signing-policy";
import {
  SHARED_ISSUER_TESTNET_PASSPHRASE,
  buildSharedIssuerIssuancePlan,
  type SharedIssuerIssuancePlan,
  type SharedIssuerIssuancePreconditions,
} from "../lib/stellar/shared-issuer-issuance";

const ISSUER_KEYPAIR = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 111));
const WRONG_SIGNER = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 112));
const DESTINATION = Keypair.fromRawEd25519Seed(
  Buffer.alloc(32, 113),
).publicKey();
const ISSUER = ISSUER_KEYPAIR.publicKey();

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
    observedLedger: 1_000,
    exists: true,
    authorized: true,
    balance: "0",
    limit: "1000",
    buyingLiabilities: "0",
  },
};

function createPlan(): SharedIssuerIssuancePlan {
  return buildSharedIssuerIssuancePlan(
    {
      projectId: "project-signer-policy",
      assetCode: "NOVA",
      issuerPublicKey: ISSUER,
      destinationPublicKey: DESTINATION,
      amount: "25",
      network: "testnet",
      networkPassphrase: Networks.TESTNET,
      validFrom: 1_800_000_000,
      validUntil: 1_800_000_300,
    },
    PRECONDITIONS,
  );
}

function durableRecords(plan: SharedIssuerIssuancePlan) {
  const issuanceRequestId = randomUUID();
  const attemptId = randomUUID();
  const createdAt = "2026-10-13T08:00:00.000Z";
  const intent: ImmutableSharedIssuanceIntent = {
    issuanceRequestId,
    issuanceIntentFingerprint: plan.intentFingerprint,
    reservationFingerprint: "a".repeat(64),
    projectId: plan.intent.projectId,
    ownerPublicKey: plan.intent.destinationPublicKey,
    network: "testnet",
    networkPassphraseHash: createHash("sha256")
      .update(Networks.TESTNET)
      .digest("hex"),
    assetCode: plan.intent.assetCode,
    issuerPublicKey: plan.intent.issuerPublicKey,
    destinationPublicKey: plan.intent.destinationPublicKey,
    amount: plan.intent.amount,
    policyVersion: plan.intent.policyVersion,
    createdAt,
  };
  const attempt: ImmutableSharedIssuanceTransactionAttempt = {
    attemptId,
    issuanceRequestId,
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
    transactionSourcePublicKey: plan.intent.issuerPublicKey,
    operationCount: 1,
    operationType: "payment",
    operationSourcePublicKey: plan.intent.issuerPublicKey,
    assetCode: plan.intent.assetCode,
    issuerPublicKey: plan.intent.issuerPublicKey,
    destinationPublicKey: plan.intent.destinationPublicKey,
    amount: plan.intent.amount,
    createdAt,
  };
  return { intent, attempt };
}

function readerFor(records: ReturnType<typeof durableRecords>) {
  return {
    async getAttempt(attemptId: string) {
      return attemptId === records.attempt.attemptId ? records.attempt : null;
    },
    async getIntent(issuanceRequestId: string) {
      return issuanceRequestId === records.intent.issuanceRequestId
        ? records.intent
        : null;
    },
  };
}

function signingPrimitive(
  keypair: Keypair,
  calls: Array<{ transactionHash: string; unsignedEnvelopeXdr: string }>,
): SharedIssuerSigningPrimitive {
  return {
    async signCanonicalEnvelope(input) {
      calls.push(input);
      const transaction = TransactionBuilder.fromXDR(
        input.unsignedEnvelopeXdr,
        Networks.TESTNET,
      );
      if (!(transaction instanceof Transaction)) {
        assert.fail("expected classic transaction");
      }
      transaction.sign(keypair);
      return { signedEnvelopeXdr: transaction.toXDR() };
    },
  };
}

function errorCode(error: unknown): string | undefined {
  return error instanceof SharedIssuerSigningPolicyError
    ? error.code
    : undefined;
}

test("durable #32 binding gates the only Testnet signing entry before the primitive", async () => {
  const plan = createPlan();
  const records = durableRecords(plan);
  const calls: Array<{
    transactionHash: string;
    unsignedEnvelopeXdr: string;
  }> = [];

  const signed = await signDurableSharedIssuerTestnetEnvelope({
    reader: readerFor(records),
    attemptId: records.attempt.attemptId,
    plan,
    policy: { issuerPublicKey: ISSUER },
    primitive: signingPrimitive(ISSUER_KEYPAIR, calls),
  });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    transactionHash: plan.transactionHash,
    unsignedEnvelopeXdr: plan.unsignedEnvelopeXdr,
  });
  assert.equal(
    Buffer.from(
      TransactionBuilder.fromXDR(
        signed.signedEnvelopeXdr,
        Networks.TESTNET,
      ).hash(),
    ).toString("hex"),
    plan.transactionHash,
  );
});

test("canonical plan B cannot cross the signer boundary when durable intent/attempt A is stored", async () => {
  const planB = createPlan();
  const planA = buildSharedIssuerIssuancePlan(
    {
      projectId: "project-signer-policy",
      assetCode: "NOVA",
      issuerPublicKey: ISSUER,
      destinationPublicKey: DESTINATION,
      amount: "26",
      network: "testnet",
      networkPassphrase: Networks.TESTNET,
      validFrom: 1_800_000_000,
      validUntil: 1_800_000_300,
    },
    PRECONDITIONS,
  );
  const records = durableRecords(planA);
  let primitiveCalls = 0;

  await assert.rejects(
    signDurableSharedIssuerTestnetEnvelope({
      reader: readerFor(records),
      attemptId: records.attempt.attemptId,
      plan: planB,
      policy: { issuerPublicKey: ISSUER },
      primitive: {
        async signCanonicalEnvelope() {
          primitiveCalls += 1;
          return { signedEnvelopeXdr: "" };
        },
      },
    }),
    (error: unknown) =>
      error instanceof Error && error.name === "SharedIssuerIssuanceError",
  );
  assert.equal(primitiveCalls, 0);
});

test("signing primitive cannot substitute another signer", async () => {
  const plan = createPlan();
  const records = durableRecords(plan);
  await assert.rejects(
    signDurableSharedIssuerTestnetEnvelope({
      reader: readerFor(records),
      attemptId: records.attempt.attemptId,
      plan,
      policy: { issuerPublicKey: ISSUER },
      primitive: signingPrimitive(WRONG_SIGNER, []),
    }),
    (error: unknown) => errorCode(error) === "signing_primitive_mismatch",
  );
});

test("valid signature bytes with a corrupted decorated-signature hint are rejected", async () => {
  const plan = createPlan();
  const records = durableRecords(plan);
  await assert.rejects(
    signDurableSharedIssuerTestnetEnvelope({
      reader: readerFor(records),
      attemptId: records.attempt.attemptId,
      plan,
      policy: { issuerPublicKey: ISSUER },
      primitive: {
        async signCanonicalEnvelope(input) {
          const transaction = TransactionBuilder.fromXDR(
            input.unsignedEnvelopeXdr,
            Networks.TESTNET,
          );
          const wrongHintTransaction = TransactionBuilder.fromXDR(
            input.unsignedEnvelopeXdr,
            Networks.TESTNET,
          );
          if (
            !(transaction instanceof Transaction) ||
            !(wrongHintTransaction instanceof Transaction)
          ) {
            assert.fail("expected classic transactions");
          }
          transaction.sign(ISSUER_KEYPAIR);
          wrongHintTransaction.sign(WRONG_SIGNER);
          transaction.signatures[0] = new xdr.DecoratedSignature({
            hint: wrongHintTransaction.signatures[0].hint,
            signature: transaction.signatures[0].signature,
          });
          return { signedEnvelopeXdr: transaction.toXDR() };
        },
      },
    }),
    (error: unknown) => errorCode(error) === "signing_primitive_mismatch",
  );
});

test("primitive failures are sanitized after durable canonical authorization", async () => {
  const plan = createPlan();
  const records = durableRecords(plan);
  await assert.rejects(
    signDurableSharedIssuerTestnetEnvelope({
      reader: readerFor(records),
      attemptId: records.attempt.attemptId,
      plan,
      policy: { issuerPublicKey: ISSUER },
      primitive: {
        async signCanonicalEnvelope() {
          throw new Error("hsm-secret-provider-detail");
        },
      },
    }),
    (error: unknown) =>
      errorCode(error) === "signing_primitive_unavailable" &&
      error instanceof Error &&
      !error.message.includes("secret-provider-detail"),
  );
});

test("MVP Lite authorization is exactly one issuer master signer at weight/threshold 1", () => {
  assert.deepEqual(createSharedIssuerMvpLiteSignerAuthorization(ISSUER), {
    network: "testnet",
    networkPassphrase: SHARED_ISSUER_TESTNET_PASSPHRASE,
    issuerPublicKey: ISSUER,
    requiredWeight: 1,
    signers: [{ publicKey: ISSUER, weight: 1 }],
  });
});
