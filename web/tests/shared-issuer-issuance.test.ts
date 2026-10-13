import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";

import {
  Account,
  Asset,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";

import type {
  ImmutableSharedIssuanceIntent,
  ImmutableSharedIssuanceTransactionAttempt,
} from "../lib/server/projects/shared-issuance-persistence";
import {
  persistAndSubmitSharedIssuerEnvelope,
  signPersistedSharedIssuerEnvelope,
  type SignedEnvelopeAttemptWriter,
} from "../lib/stellar/shared-issuer-execution";
import {
  SHARED_ISSUER_TESTNET_PASSPHRASE,
  SharedIssuerIssuanceError,
  assertReplacementPreservesIssuanceIntent,
  assertSharedIssuerIssuancePlanCanonical,
  assertSignedEnvelopeAuthorizedForSubmission,
  assertSignedEnvelopeMatchesPlan,
  assertSigningRequestMatchesPlan,
  assertSubmissionHashMatchesPlan,
  buildSharedIssuerIssuancePlan,
  classifySharedIssuerRecovery,
  createSharedIssuerSigningRequest,
  hashSharedIssuerIssuanceIntent,
  type SharedIssuerIssuancePlan,
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

function withIntentPatch(
  plan: SharedIssuerIssuancePlan,
  patch: Partial<SharedIssuerIssuancePlan["intent"]>,
): SharedIssuerIssuancePlan {
  const intent = { ...plan.intent, ...patch };
  return {
    ...plan,
    intent,
    intentFingerprint: hashSharedIssuerIssuanceIntent(intent),
  };
}

function buildCustomEnvelope(
  plan: SharedIssuerIssuancePlan,
  options: {
    sourcePublicKey?: string;
    operationSource?: string;
    extraOperation?: boolean;
    wrongOperation?: boolean;
  } = {},
): Pick<SharedIssuerIssuancePlan, "unsignedEnvelopeXdr" | "transactionHash"> {
  const builder = new TransactionBuilder(
    new Account(
      options.sourcePublicKey ?? plan.intent.issuerPublicKey,
      plan.sourceSequence,
    ),
    {
      fee: plan.feeStroops,
      networkPassphrase: Networks.TESTNET,
    },
  );

  if (options.wrongOperation) {
    builder.addOperation(
      Operation.manageData({
        name: "unexpected",
        value: "1",
      }),
    );
  } else {
    builder.addOperation(
      Operation.payment({
        ...(options.operationSource ? { source: options.operationSource } : {}),
        destination: plan.intent.destinationPublicKey,
        asset: new Asset(plan.intent.assetCode, plan.intent.issuerPublicKey),
        amount: plan.intent.amount,
      }),
    );

    if (options.extraOperation) {
      builder.addOperation(
        Operation.payment({
          destination: plan.intent.destinationPublicKey,
          asset: new Asset(plan.intent.assetCode, plan.intent.issuerPublicKey),
          amount: "1.0000000",
        }),
      );
    }
  }

  const transaction = builder
    .setTimebounds(plan.validFrom, plan.validUntil)
    .build();

  return {
    unsignedEnvelopeXdr: transaction.toXDR(),
    transactionHash: Buffer.from(transaction.hash()).toString("hex"),
  };
}

function createDurableExecutionRecords(
  plan: SharedIssuerIssuancePlan,
  attemptId = randomUUID(),
): {
  intent: ImmutableSharedIssuanceIntent;
  attempt: ImmutableSharedIssuanceTransactionAttempt;
} {
  const issuanceRequestId = randomUUID();
  const createdAt = "2027-01-15T08:00:00.000Z";
  const intent: ImmutableSharedIssuanceIntent = {
    issuanceRequestId,
    issuanceIntentFingerprint: plan.intentFingerprint,
    reservationFingerprint: "a".repeat(64),
    projectId: plan.intent.projectId,
    ownerPublicKey: plan.intent.destinationPublicKey,
    network: "testnet",
    networkPassphraseHash: createHash("sha256")
      .update(SHARED_ISSUER_TESTNET_PASSPHRASE)
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

function createDurableExecutionWriter(
  records: {
    intent: ImmutableSharedIssuanceIntent;
    attempt: ImmutableSharedIssuanceTransactionAttempt;
  },
  counters: { digestWrites: number },
): SignedEnvelopeAttemptWriter {
  let storedAttempt = records.attempt;
  return {
    async getAttempt(attemptId) {
      return attemptId === storedAttempt.attemptId ? storedAttempt : null;
    },
    async getIntent(issuanceRequestId) {
      return issuanceRequestId === records.intent.issuanceRequestId
        ? records.intent
        : null;
    },
    async recordSignedEnvelope(input) {
      counters.digestWrites += 1;
      if (
        input.attemptId !== storedAttempt.attemptId ||
        input.transactionHash !== storedAttempt.transactionHash
      ) {
        return storedAttempt;
      }
      storedAttempt = {
        ...storedAttempt,
        signedEnvelopeXdrSha256: input.signedEnvelopeXdrSha256,
      };
      return storedAttempt;
    },
  };
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

test("canonical plan validation rejects body substitution before signing, digest persistence, or submission", async () => {
  const canonical = buildSharedIssuerIssuancePlan(REQUEST, PRECONDITIONS);
  assert.doesNotThrow(() => assertSharedIssuerIssuancePlanCanonical(canonical));

  const otherDestination = Keypair.fromRawEd25519Seed(
    Buffer.alloc(32, 45),
  ).publicKey();
  const otherIssuer = Keypair.fromRawEd25519Seed(
    Buffer.alloc(32, 46),
  ).publicKey();

  const transactionSourceMismatch = buildCustomEnvelope(canonical, {
    sourcePublicKey: otherIssuer,
  });
  const operationSourceMismatch = buildCustomEnvelope(canonical, {
    operationSource: otherIssuer,
  });
  const extraOperation = buildCustomEnvelope(canonical, {
    extraOperation: true,
  });
  const wrongOperation = buildCustomEnvelope(canonical, {
    wrongOperation: true,
  });

  const networkIntent = {
    ...canonical.intent,
    network: "public" as typeof canonical.intent.network,
  };

  const transactionB = buildSharedIssuerIssuancePlan(
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

  const cases: Array<{ name: string; plan: SharedIssuerIssuancePlan }> = [
    {
      name: "intent fingerprint mismatch",
      plan: { ...canonical, intentFingerprint: "0".repeat(64) },
    },
    {
      name: "destination mismatch",
      plan: withIntentPatch(canonical, {
        destinationPublicKey: otherDestination,
      }),
    },
    {
      name: "amount mismatch",
      plan: withIntentPatch(canonical, { amount: "126.0000000" }),
    },
    {
      name: "issuer mismatch",
      plan: withIntentPatch(canonical, { issuerPublicKey: otherIssuer }),
    },
    {
      name: "asset-code mismatch",
      plan: withIntentPatch(canonical, { assetCode: "SOLAR" }),
    },
    {
      name: "network mismatch",
      plan: {
        ...canonical,
        intent: networkIntent,
        intentFingerprint: hashSharedIssuerIssuanceIntent(networkIntent),
      },
    },
    {
      name: "transaction source mismatch",
      plan: { ...canonical, ...transactionSourceMismatch },
    },
    {
      name: "operation source mismatch",
      plan: { ...canonical, ...operationSourceMismatch },
    },
    {
      name: "sequence mismatch",
      plan: { ...canonical, sourceSequence: "123457" },
    },
    {
      name: "fee mismatch",
      plan: { ...canonical, feeStroops: "200" },
    },
    {
      name: "timebound mismatch",
      plan: { ...canonical, validUntil: canonical.validUntil + 1 },
    },
    {
      name: "extra operation",
      plan: { ...canonical, ...extraOperation },
    },
    {
      name: "wrong operation",
      plan: { ...canonical, ...wrongOperation },
    },
    {
      name: "unsigned XDR mismatch",
      plan: {
        ...canonical,
        unsignedEnvelopeXdr: extraOperation.unsignedEnvelopeXdr,
      },
    },
    {
      name: "transaction hash mismatch",
      plan: { ...canonical, transactionHash: "f".repeat(64) },
    },
    {
      name: "hybrid intent A / transaction B",
      plan: {
        ...canonical,
        unsignedEnvelopeXdr: transactionB.unsignedEnvelopeXdr,
        transactionHash: transactionB.transactionHash,
      },
    },
  ];

  const signed = TransactionBuilder.fromXDR(
    canonical.unsignedEnvelopeXdr,
    Networks.TESTNET,
  );
  signed.sign(ISSUER_KEYPAIR, SIGNER_B_KEYPAIR);
  const signedEnvelopeXdr = signed.toXDR();

  for (const candidate of cases) {
    let signerCalls = 0;
    const signer = {
      async signCanonicalEnvelope(
        _request: ReturnType<typeof createSharedIssuerSigningRequest>,
      ) {
        signerCalls += 1;
        return { signedEnvelopeXdr };
      },
    };

    await assert.rejects(
      async () =>
        signer.signCanonicalEnvelope(
          createSharedIssuerSigningRequest(candidate.plan),
        ),
      (error: unknown) => errorCode(error) === "canonical_plan_mismatch",
      candidate.name,
    );
    assert.equal(signerCalls, 0, candidate.name);

    const counters = { digestWrites: 0 };
    let submissions = 0;
    const attemptId = randomUUID();
    const durableWriter = createDurableExecutionWriter(
      createDurableExecutionRecords(canonical, attemptId),
      counters,
    );
    await assert.rejects(
      persistAndSubmitSharedIssuerEnvelope({
        writer: durableWriter,
        attemptId,
        plan: candidate.plan,
        signedEnvelopeXdr,
        authorization: SIGNER_AUTHORIZATION,
        submission: {
          async submitSignedEnvelope() {
            submissions += 1;
            return { hash: candidate.plan.transactionHash };
          },
        },
      }),
      (error: unknown) => errorCode(error) === "canonical_plan_mismatch",
      candidate.name,
    );
    assert.equal(counters.digestWrites, 0, candidate.name);
    assert.equal(submissions, 0, candidate.name);
  }
});

test("durable intent and attempt must match the canonical plan before signing, digest persistence, or submission", async () => {
  const planB = buildSharedIssuerIssuancePlan(REQUEST, PRECONDITIONS);
  const otherDestination = Keypair.fromRawEd25519Seed(
    Buffer.alloc(32, 47),
  ).publicKey();
  const otherIssuer = Keypair.fromRawEd25519Seed(
    Buffer.alloc(32, 48),
  ).publicKey();

  const fullPlanA = buildSharedIssuerIssuancePlan(
    {
      ...REQUEST,
      destinationPublicKey: otherDestination,
      amount: "126",
    },
    {
      ...PRECONDITIONS,
      destinationTrustline: {
        ...PRECONDITIONS.destinationTrustline,
        destinationPublicKey: otherDestination,
      },
    },
  );
  const destinationPlanA = buildSharedIssuerIssuancePlan(
    { ...REQUEST, destinationPublicKey: otherDestination },
    {
      ...PRECONDITIONS,
      destinationTrustline: {
        ...PRECONDITIONS.destinationTrustline,
        destinationPublicKey: otherDestination,
      },
    },
  );
  const amountPlanA = buildSharedIssuerIssuancePlan(
    { ...REQUEST, amount: "126" },
    PRECONDITIONS,
  );
  const issuerPlanA = buildSharedIssuerIssuancePlan(
    { ...REQUEST, issuerPublicKey: otherIssuer },
    {
      ...PRECONDITIONS,
      destinationTrustline: {
        ...PRECONDITIONS.destinationTrustline,
        issuerPublicKey: otherIssuer,
      },
    },
  );
  const codePlanA = buildSharedIssuerIssuancePlan(
    { ...REQUEST, assetCode: "SOLAR" },
    {
      ...PRECONDITIONS,
      destinationTrustline: {
        ...PRECONDITIONS.destinationTrustline,
        assetCode: "SOLAR",
      },
    },
  );
  const sequencePlanA = buildSharedIssuerIssuancePlan(REQUEST, {
    ...PRECONDITIONS,
    issuerSequence: "123457",
  });
  const feePlanA = buildSharedIssuerIssuancePlan(REQUEST, {
    ...PRECONDITIONS,
    feeStroops: "200",
  });
  const timeboundPlanA = buildSharedIssuerIssuancePlan(
    {
      ...REQUEST,
      validFrom: REQUEST.validFrom + 60,
      validUntil: REQUEST.validUntil + 60,
    },
    PRECONDITIONS,
  );

  const fingerprintMismatch = createDurableExecutionRecords(planB);
  fingerprintMismatch.intent = {
    ...fingerprintMismatch.intent,
    issuanceIntentFingerprint: "f".repeat(64),
  };
  fingerprintMismatch.attempt = {
    ...fingerprintMismatch.attempt,
    issuanceIntentFingerprint: "f".repeat(64),
  };

  const hashMismatch = createDurableExecutionRecords(planB);
  hashMismatch.attempt = {
    ...hashMismatch.attempt,
    transactionHash: "e".repeat(64),
  };

  const ownerMismatch = createDurableExecutionRecords(planB);
  ownerMismatch.intent = {
    ...ownerMismatch.intent,
    ownerPublicKey: otherDestination,
  };

  const networkMismatch = createDurableExecutionRecords(planB);
  networkMismatch.intent = {
    ...networkMismatch.intent,
    networkPassphraseHash: "d".repeat(64),
  };

  const cases = [
    {
      name: "persisted intent A plus canonical plan B",
      records: createDurableExecutionRecords(fullPlanA),
    },
    {
      name: "persisted destination A plus plan destination B",
      records: createDurableExecutionRecords(destinationPlanA),
    },
    {
      name: "persisted amount A plus plan amount B",
      records: createDurableExecutionRecords(amountPlanA),
    },
    {
      name: "persisted issuer mismatch",
      records: createDurableExecutionRecords(issuerPlanA),
    },
    {
      name: "persisted asset-code mismatch",
      records: createDurableExecutionRecords(codePlanA),
    },
    {
      name: "persisted fingerprint mismatch",
      records: fingerprintMismatch,
    },
    {
      name: "persisted transaction-hash mismatch",
      records: hashMismatch,
    },
    {
      name: "persisted sequence mismatch",
      records: createDurableExecutionRecords(sequencePlanA),
    },
    {
      name: "persisted fee mismatch",
      records: createDurableExecutionRecords(feePlanA),
    },
    {
      name: "persisted timebound mismatch",
      records: createDurableExecutionRecords(timeboundPlanA),
    },
    {
      name: "persisted authenticated-owner mismatch",
      records: ownerMismatch,
    },
    {
      name: "persisted Testnet passphrase mismatch",
      records: networkMismatch,
    },
  ];

  const signed = TransactionBuilder.fromXDR(
    planB.unsignedEnvelopeXdr,
    Networks.TESTNET,
  );
  signed.sign(ISSUER_KEYPAIR, SIGNER_B_KEYPAIR);
  const signedEnvelopeXdr = signed.toXDR();

  for (const candidate of cases) {
    let signerCalls = 0;
    const counters = { digestWrites: 0 };
    let submissions = 0;
    const writer = createDurableExecutionWriter(candidate.records, counters);

    await assert.rejects(
      signPersistedSharedIssuerEnvelope({
        reader: writer,
        attemptId: candidate.records.attempt.attemptId,
        plan: planB,
        signer: {
          async signCanonicalEnvelope() {
            signerCalls += 1;
            return { signedEnvelopeXdr };
          },
        },
      }),
      (error: unknown) => errorCode(error) === "canonical_plan_mismatch",
      candidate.name,
    );

    await assert.rejects(
      persistAndSubmitSharedIssuerEnvelope({
        writer,
        attemptId: candidate.records.attempt.attemptId,
        plan: planB,
        signedEnvelopeXdr,
        authorization: SIGNER_AUTHORIZATION,
        submission: {
          async submitSignedEnvelope() {
            submissions += 1;
            return { hash: planB.transactionHash };
          },
        },
      }),
      (error: unknown) => errorCode(error) === "canonical_plan_mismatch",
      candidate.name,
    );

    assert.equal(signerCalls, 0, candidate.name);
    assert.equal(counters.digestWrites, 0, candidate.name);
    assert.equal(submissions, 0, candidate.name);
  }
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

test("signed-envelope digest is persisted immutably before submission", async () => {
  const plan = buildSharedIssuerIssuancePlan(REQUEST, PRECONDITIONS);
  const transaction = TransactionBuilder.fromXDR(
    plan.unsignedEnvelopeXdr,
    Networks.TESTNET,
  );
  transaction.sign(ISSUER_KEYPAIR, SIGNER_B_KEYPAIR);
  const signedEnvelopeXdr = transaction.toXDR();
  const attemptId = randomUUID();
  const counters = { digestWrites: 0 };
  let submissions = 0;
  const writer = createDurableExecutionWriter(
    createDurableExecutionRecords(plan, attemptId),
    counters,
  );

  const result = await persistAndSubmitSharedIssuerEnvelope({
    writer,
    attemptId,
    plan,
    signedEnvelopeXdr,
    authorization: SIGNER_AUTHORIZATION,
    submission: {
      async submitSignedEnvelope(value) {
        submissions += 1;
        assert.equal(value, signedEnvelopeXdr);
        assert.equal(counters.digestWrites, 1);
        return { hash: plan.transactionHash };
      },
    },
  });

  assert.equal(result.hash, plan.transactionHash);
  assert.equal(counters.digestWrites, 1);
  assert.equal(submissions, 1);
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
    () =>
      assertReplacementPreservesIssuanceIntent(original, changedDestination),
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
