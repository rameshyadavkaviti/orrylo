import assert from "node:assert/strict";
import test from "node:test";

import {
  Keypair,
  Networks,
  Transaction,
  TransactionBuilder,
} from "@stellar/stellar-sdk";

import {
  PolicyBoundSharedIssuerTestnetSigner,
  SharedIssuerSigningPolicyError,
  type SharedIssuerCanonicalSigningPlanResolver,
  type SharedIssuerSigningPrimitive,
} from "../lib/stellar/shared-issuer-signing-policy";
import {
  SHARED_ISSUER_TESTNET_PASSPHRASE,
  buildSharedIssuerIssuancePlan,
  createSharedIssuerSigningRequest,
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

function errorCode(error: unknown): string | undefined {
  return error instanceof SharedIssuerSigningPolicyError
    ? error.code
    : undefined;
}

function resolverFor(
  plan: SharedIssuerIssuancePlan | null,
): SharedIssuerCanonicalSigningPlanResolver {
  return {
    async resolveActiveCanonicalPlan(transactionHash) {
      if (!plan || plan.transactionHash !== transactionHash) {
        return null;
      }
      return plan;
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
      assert.equal(
        Buffer.from(transaction.hash()).toString("hex"),
        input.transactionHash,
      );
      transaction.sign(keypair);
      return { signedEnvelopeXdr: transaction.toXDR() };
    },
  };
}

test("isolated signer resolves the active canonical plan, reconstructs policy, and signs only the exact envelope", async () => {
  const plan = createPlan();
  const calls: Array<{
    transactionHash: string;
    unsignedEnvelopeXdr: string;
  }> = [];
  const signer = new PolicyBoundSharedIssuerTestnetSigner(
    { issuerPublicKey: ISSUER },
    resolverFor(plan),
    signingPrimitive(ISSUER_KEYPAIR, calls),
  );

  const signed = await signer.signCanonicalEnvelope(
    createSharedIssuerSigningRequest(plan),
  );

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    transactionHash: plan.transactionHash,
    unsignedEnvelopeXdr: plan.unsignedEnvelopeXdr,
  });

  const transaction = TransactionBuilder.fromXDR(
    signed.signedEnvelopeXdr,
    Networks.TESTNET,
  );
  assert.ok(transaction instanceof Transaction);
  assert.equal(
    Buffer.from(transaction.hash()).toString("hex"),
    plan.transactionHash,
  );
  assert.equal(transaction.signatures.length, 1);
  assert.equal(
    ISSUER_KEYPAIR.verify(
      Buffer.from(transaction.hash()),
      transaction.signatures[0].signature,
    ),
    true,
  );
});

test("unknown or inactive canonical transaction hash is rejected before the signing primitive", async () => {
  const plan = createPlan();
  const calls: Array<{
    transactionHash: string;
    unsignedEnvelopeXdr: string;
  }> = [];
  const signer = new PolicyBoundSharedIssuerTestnetSigner(
    { issuerPublicKey: ISSUER },
    resolverFor(null),
    signingPrimitive(ISSUER_KEYPAIR, calls),
  );

  await assert.rejects(
    signer.signCanonicalEnvelope(createSharedIssuerSigningRequest(plan)),
    (error: unknown) => errorCode(error) === "canonical_plan_not_found",
  );
  assert.equal(calls.length, 0);
});

test("mutated network, issuer, hash, or empty envelope request is rejected before policy lookup or signing", async () => {
  const plan = createPlan();
  let resolverCalls = 0;
  let primitiveCalls = 0;
  const resolver: SharedIssuerCanonicalSigningPlanResolver = {
    async resolveActiveCanonicalPlan() {
      resolverCalls += 1;
      return plan;
    },
  };
  const primitive: SharedIssuerSigningPrimitive = {
    async signCanonicalEnvelope() {
      primitiveCalls += 1;
      return { signedEnvelopeXdr: "" };
    },
  };
  const signer = new PolicyBoundSharedIssuerTestnetSigner(
    { issuerPublicKey: ISSUER },
    resolver,
    primitive,
  );
  const request = createSharedIssuerSigningRequest(plan);

  const mutations = [
    {
      ...request,
      networkPassphrase:
        Networks.PUBLIC as typeof request.networkPassphrase,
    },
    { ...request, issuerPublicKey: DESTINATION },
    { ...request, transactionHash: "A".repeat(64) },
    { ...request, unsignedEnvelopeXdr: "" },
  ];

  for (const mutation of mutations) {
    await assert.rejects(
      signer.signCanonicalEnvelope(mutation),
      (error: unknown) => errorCode(error) === "invalid_signing_request",
    );
  }

  assert.equal(resolverCalls, 0);
  assert.equal(primitiveCalls, 0);
});

test("request that differs from the resolved immutable plan is rejected before signing", async () => {
  const plan = createPlan();
  const calls: Array<{
    transactionHash: string;
    unsignedEnvelopeXdr: string;
  }> = [];
  const signer = new PolicyBoundSharedIssuerTestnetSigner(
    { issuerPublicKey: ISSUER },
    resolverFor(plan),
    signingPrimitive(ISSUER_KEYPAIR, calls),
  );
  const request = createSharedIssuerSigningRequest(plan);

  await assert.rejects(
    signer.signCanonicalEnvelope({
      ...request,
      unsignedEnvelopeXdr: request.unsignedEnvelopeXdr + "A",
    }),
    (error: unknown) => errorCode(error) === "invalid_signing_request",
  );
  assert.equal(calls.length, 0);
});

test("internally inconsistent durable plan is rejected before the signing primitive", async () => {
  const plan = createPlan();
  const corruptPlan = {
    ...plan,
    intent: {
      ...plan.intent,
      amount: "26.0000000",
    },
  };
  const calls: Array<{
    transactionHash: string;
    unsignedEnvelopeXdr: string;
  }> = [];
  const resolver: SharedIssuerCanonicalSigningPlanResolver = {
    async resolveActiveCanonicalPlan(transactionHash) {
      return transactionHash === plan.transactionHash ? corruptPlan : null;
    },
  };
  const signer = new PolicyBoundSharedIssuerTestnetSigner(
    { issuerPublicKey: ISSUER },
    resolver,
    signingPrimitive(ISSUER_KEYPAIR, calls),
  );

  await assert.rejects(
    signer.signCanonicalEnvelope(createSharedIssuerSigningRequest(plan)),
    (error: unknown) => errorCode(error) === "canonical_plan_mismatch",
  );
  assert.equal(calls.length, 0);
});

test("signing primitive cannot substitute an unknown signer even when transaction hash is unchanged", async () => {
  const plan = createPlan();
  const calls: Array<{
    transactionHash: string;
    unsignedEnvelopeXdr: string;
  }> = [];
  const signer = new PolicyBoundSharedIssuerTestnetSigner(
    { issuerPublicKey: ISSUER },
    resolverFor(plan),
    signingPrimitive(WRONG_SIGNER, calls),
  );

  await assert.rejects(
    signer.signCanonicalEnvelope(createSharedIssuerSigningRequest(plan)),
    (error: unknown) => errorCode(error) === "signing_primitive_mismatch",
  );
  assert.equal(calls.length, 1);
});

test("unsigned or empty primitive output never escapes the isolated policy shell", async () => {
  const plan = createPlan();

  for (const primitive of [
    {
      async signCanonicalEnvelope() {
        return { signedEnvelopeXdr: plan.unsignedEnvelopeXdr };
      },
    },
    {
      async signCanonicalEnvelope() {
        return { signedEnvelopeXdr: "" };
      },
    },
  ] satisfies SharedIssuerSigningPrimitive[]) {
    const signer = new PolicyBoundSharedIssuerTestnetSigner(
      { issuerPublicKey: ISSUER },
      resolverFor(plan),
      primitive,
    );

    await assert.rejects(
      signer.signCanonicalEnvelope(createSharedIssuerSigningRequest(plan)),
      (error: unknown) => errorCode(error) === "signing_primitive_mismatch",
    );
  }
});

test("resolver failures are sanitized and never reach the signing primitive", async () => {
  const plan = createPlan();
  let primitiveCalls = 0;
  const signer = new PolicyBoundSharedIssuerTestnetSigner(
    { issuerPublicKey: ISSUER },
    {
      async resolveActiveCanonicalPlan() {
        throw new Error("postgres://secret-internal-detail");
      },
    },
    {
      async signCanonicalEnvelope() {
        primitiveCalls += 1;
        return { signedEnvelopeXdr: "" };
      },
    },
  );

  await assert.rejects(
    signer.signCanonicalEnvelope(createSharedIssuerSigningRequest(plan)),
    (error: unknown) =>
      errorCode(error) === "signing_policy_unavailable" &&
      error instanceof Error &&
      !error.message.includes("secret-internal-detail"),
  );
  assert.equal(primitiveCalls, 0);
});

test("signing primitive failures are sanitized after exact canonical authorization", async () => {
  const plan = createPlan();
  const signer = new PolicyBoundSharedIssuerTestnetSigner(
    { issuerPublicKey: ISSUER },
    resolverFor(plan),
    {
      async signCanonicalEnvelope() {
        throw new Error("hsm-secret-provider-detail");
      },
    },
  );

  await assert.rejects(
    signer.signCanonicalEnvelope(createSharedIssuerSigningRequest(plan)),
    (error: unknown) =>
      errorCode(error) === "signing_primitive_unavailable" &&
      error instanceof Error &&
      !error.message.includes("hsm-secret-provider-detail"),
  );
});

test("constructor rejects an invalid local issuer policy before any request can be processed", () => {
  assert.throws(
    () =>
      new PolicyBoundSharedIssuerTestnetSigner(
        { issuerPublicKey: "not-a-key" },
        resolverFor(null),
        {
          async signCanonicalEnvelope() {
            return { signedEnvelopeXdr: "" };
          },
        },
      ),
  );
});
