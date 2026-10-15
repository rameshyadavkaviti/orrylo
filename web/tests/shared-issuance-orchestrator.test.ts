import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  Account,
  Asset,
  Keypair,
  Networks,
  Operation,
  Transaction,
  TransactionBuilder,
  xdr,
} from "@stellar/stellar-sdk";

import type {
  ImmutableSharedIssuanceIntent,
  ImmutableSharedIssuanceLedgerConfirmation,
  ImmutableSharedIssuanceTransactionAttempt,
} from "../lib/server/projects/shared-issuance-persistence";
import {
  SharedIssuanceOrchestrator,
  type SharedIssuanceOrchestrationStore,
} from "../lib/server/projects/shared-issuance-orchestrator";
import { PrivateRailwaySharedIssuerSigningPrimitive } from "../lib/stellar/private-railway-signer";
import type { SharedIssuerSigningPrimitive } from "../lib/stellar/shared-issuer-signing-policy";
import {
  createPrivateTestnetSignerRuntime,
  handlePrivateTestnetSignerRequest,
} from "../signer-service/private-testnet-signer";
import {
  SHARED_ISSUANCE_POLICY_VERSION,
  SHARED_ISSUER_TESTNET_PASSPHRASE,
  buildSharedIssuerIssuancePlan,
  hashSharedIssuerIssuanceIntent,
} from "../lib/stellar/shared-issuer-issuance";

const ISSUER_KEYPAIR = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 121));
const ISSUER = ISSUER_KEYPAIR.publicKey();
const OTHER_ISSUER_KEYPAIR = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 124));
const WRONG_SIGNER_KEYPAIR = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 125));
const OWNER = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 122)).publicKey();
const OTHER_OWNER = Keypair.fromRawEd25519Seed(
  Buffer.alloc(32, 123),
).publicKey();
const PROJECT_ID = "10000000-0000-4000-8000-000000000001";
const REQUEST_ID = "10000000-0000-4000-8000-000000000002";
const ATTEMPT_ID = "10000000-0000-4000-8000-000000000003";
const NOW = 1_800_000_000_000;
type DurableStatus =
  | "awaiting_issuer_integration"
  | "pending_execution"
  | "submitted"
  | "confirmed"
  | "failed"
  | "reconciliation_required";

function intent(): ImmutableSharedIssuanceIntent {
  const issuanceIntentFingerprint = hashSharedIssuerIssuanceIntent({
    policyVersion: SHARED_ISSUANCE_POLICY_VERSION,
    projectId: PROJECT_ID,
    network: "testnet",
    assetCode: "NOVA",
    issuerPublicKey: ISSUER,
    destinationPublicKey: OWNER,
    amount: "25.0000000",
  });
  return {
    issuanceRequestId: REQUEST_ID,
    issuanceIntentFingerprint,
    reservationFingerprint: "b".repeat(64),
    projectId: PROJECT_ID,
    ownerPublicKey: OWNER,
    network: "testnet",
    networkPassphraseHash: createHash("sha256")
      .update(Networks.TESTNET)
      .digest("hex"),
    assetCode: "NOVA",
    issuerPublicKey: ISSUER,
    destinationPublicKey: OWNER,
    amount: "25.0000000",
    policyVersion: SHARED_ISSUANCE_POLICY_VERSION,
    createdAt: new Date(NOW - 1_000).toISOString(),
  };
}

class MemoryStore implements SharedIssuanceOrchestrationStore {
  readonly intents = new Map([[REQUEST_ID, intent()]]);
  readonly attempts: ImmutableSharedIssuanceTransactionAttempt[] = [];
  confirmation: ImmutableSharedIssuanceLedgerConfirmation | null = null;
  status: DurableStatus = "awaiting_issuer_integration";
  failureCode: string | null = null;
  transitions: DurableStatus[] = [];
  appendFailuresRemaining = 0;

  async getIntent(requestId: string) {
    return this.intents.get(requestId) ?? null;
  }
  async listAttempts(requestId: string) {
    return this.attempts.filter((item) => item.issuanceRequestId === requestId);
  }
  async appendAttempt(attempt: ImmutableSharedIssuanceTransactionAttempt) {
    if (this.appendFailuresRemaining > 0) {
      this.appendFailuresRemaining -= 1;
      throw new Error("append attempt failed");
    }
    if (this.attempts.length) throw new Error("attempt 2 rejected");
    this.attempts.push(attempt);
    return attempt;
  }
  async getAttempt(attemptId: string) {
    return this.attempts.find((item) => item.attemptId === attemptId) ?? null;
  }
  async claimSigningMode(input: {
    attemptId: string;
    transactionHash: string;
    signingMode: "private" | "manual";
  }) {
    const existing = await this.getAttempt(input.attemptId);
    assert.ok(existing);
    assert.equal(existing.transactionHash, input.transactionHash);
    if (existing.signingMode || existing.signedEnvelopeXdrSha256) {
      return null;
    }
    existing.signingMode = input.signingMode;
    return existing;
  }
  async recordSignedEnvelope(input: {
    attemptId: string;
    transactionHash: string;
    signedEnvelopeXdrSha256: string;
  }) {
    const existing = await this.getAttempt(input.attemptId);
    assert.ok(existing);
    assert.equal(existing.transactionHash, input.transactionHash);
    assert.ok(existing.signingMode);
    if (existing.signedEnvelopeXdrSha256) {
      throw new Error("signed envelope already claimed");
    }
    Object.assign(existing, {
      signedEnvelopeXdrSha256: input.signedEnvelopeXdrSha256,
    });
    return existing;
  }
  async getConfirmation() {
    return this.confirmation;
  }
  async getLifecycle() {
    return { status: this.status, failureCode: this.failureCode };
  }
  async transition(
    issuanceRequestId: string,
    status: DurableStatus,
    failureCode: string | null = null,
  ) {
    assert.equal(issuanceRequestId, REQUEST_ID);
    if (this.status === status) return false;
    this.transitions.push(status);
    this.status = status;
    this.failureCode = failureCode;
    return true;
  }
}

function fixture(
  options: {
    trustline?: boolean;
    signerFails?: boolean;
    submissionUncertain?: boolean;
    confirmationMismatch?: boolean;
    primitive?: SharedIssuerSigningPrimitive;
    appendFailures?: number;
  } = {},
) {
  const store = new MemoryStore();
  store.appendFailuresRemaining = options.appendFailures ?? 0;
  const calls: string[] = [];
  let submissions = 0;
  const primitive: SharedIssuerSigningPrimitive = options.primitive ?? {
    async signCanonicalEnvelope(input) {
      calls.push("sign");
      if (options.signerFails) throw new Error("signer unavailable");
      const transaction = TransactionBuilder.fromXDR(
        input.unsignedEnvelopeXdr,
        Networks.TESTNET,
      );
      assert.ok(transaction instanceof Transaction);
      transaction.sign(ISSUER_KEYPAIR);
      return { signedEnvelopeXdr: transaction.toXDR() };
    },
  };
  const orchestrator = new SharedIssuanceOrchestrator({
    store,
    preflight: {
      async readIssuancePreconditions() {
        calls.push("preflight");
        return {
          network: "testnet" as const,
          networkPassphrase: SHARED_ISSUER_TESTNET_PASSPHRASE,
          observedLedger: 100,
          observedLedgerClosedAt: new Date(NOW - 2_000).toISOString(),
          baseFeeStroops: "100",
          baseReserveStroops: "5000000",
          preconditions: {
            assetCodeReservedForProject: true,
            issuerSequence: "123",
            issuerSpendableNativeStroops: "1000000",
            feeStroops: "100",
            destinationTrustline: {
              network: "testnet" as const,
              networkPassphrase: SHARED_ISSUER_TESTNET_PASSPHRASE,
              destinationPublicKey: OWNER,
              assetCode: "NOVA",
              issuerPublicKey: ISSUER,
              observedLedger: 100,
              exists: options.trustline !== false,
              authorized: options.trustline !== false,
              balance: "0.0000000",
              limit: options.trustline === false ? "0.0000000" : "1000.0000000",
              buyingLiabilities: "0.0000000",
            },
          },
        };
      },
    },
    primitive,
    submission: {
      async submitSignedEnvelope(signedEnvelopeXdr) {
        calls.push("submit");
        submissions++;
        assert.ok(store.attempts[0]?.signedEnvelopeXdrSha256);
        const transaction = TransactionBuilder.fromXDR(
          signedEnvelopeXdr,
          Networks.TESTNET,
        );
        assert.ok(transaction instanceof Transaction);
        const hash = Buffer.from(transaction.hash()).toString("hex");
        if (options.submissionUncertain) {
          const error = new Error("uncertain") as Error & { code: string };
          error.code = "submission_reconciliation_required";
          throw error;
        }
        return { hash };
      },
    },
    authorization: {
      network: "testnet",
      networkPassphrase: Networks.TESTNET,
      issuerPublicKey: ISSUER,
      requiredWeight: 1,
      signers: [{ publicKey: ISSUER, weight: 1 }],
    },
    confirmationValidator: {
      async validate(input) {
        calls.push("confirm");
        if (options.confirmationMismatch) throw new Error("wrong transaction");
        return {
          record: { transactionHash: input.attempt.transactionHash },
        } as never;
      },
    },
    confirmationWriter: {
      async appendConfirmation(value) {
        calls.push("persist_confirmation");
        const record = (
          value as never as {
            record: ImmutableSharedIssuanceLedgerConfirmation;
          }
        ).record;
        store.confirmation = {
          ...record,
          transactionHash: store.attempts[0]!.transactionHash,
          ledgerSequence: 501,
        };
        return store.confirmation;
      },
    },
    now: () => NOW,
    randomUuid: () => ATTEMPT_ID,
    feeStroops: "100",
    validitySeconds: 300,
  });
  return { orchestrator, store, calls, submissions: () => submissions };
}

const input = {
  requestId: REQUEST_ID,
  projectId: PROJECT_ID,
  ownerPublicKey: OWNER,
};

function buildVariantPlan(
  overrides: Partial<{
    assetCode: string;
    issuerPublicKey: string;
    destinationPublicKey: string;
    amount: string;
    validFrom: number;
    validUntil: number;
  }> = {},
) {
  const assetCode = overrides.assetCode ?? "NOVA";
  const issuerPublicKey = overrides.issuerPublicKey ?? ISSUER;
  const destinationPublicKey = overrides.destinationPublicKey ?? OWNER;
  const validFrom = overrides.validFrom ?? Math.floor(NOW / 1_000);
  const validUntil = overrides.validUntil ?? validFrom + 300;
  return buildSharedIssuerIssuancePlan(
    {
      projectId: PROJECT_ID,
      assetCode,
      issuerPublicKey,
      destinationPublicKey,
      amount: overrides.amount ?? "25.0000000",
      network: "testnet",
      networkPassphrase: Networks.TESTNET,
      validFrom,
      validUntil,
    },
    {
      assetCodeReservedForProject: true,
      issuerSequence: "123",
      issuerSpendableNativeStroops: "1000000",
      feeStroops: "100",
      destinationTrustline: {
        network: "testnet",
        networkPassphrase: Networks.TESTNET,
        destinationPublicKey,
        assetCode,
        issuerPublicKey,
        observedLedger: 100,
        exists: true,
        authorized: true,
        balance: "0.0000000",
        limit: "1000.0000000",
        buyingLiabilities: "0.0000000",
      },
    },
  );
}

function signPlan(
  plan: ReturnType<typeof buildVariantPlan>,
  signer = ISSUER_KEYPAIR,
  networkPassphrase = Networks.TESTNET,
) {
  const transaction = TransactionBuilder.fromXDR(
    plan.unsignedEnvelopeXdr,
    networkPassphrase,
  );
  assert.ok(transaction instanceof Transaction);
  transaction.sign(signer);
  return transaction.toXDR();
}

function extraOperationSignedEnvelope() {
  const account = new Account(ISSUER, "123");
  const asset = new Asset("NOVA", ISSUER);
  const transaction = new TransactionBuilder(account, {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      Operation.payment({
        destination: OWNER,
        asset,
        amount: "25.0000000",
      }),
    )
    .addOperation(
      Operation.payment({
        destination: OWNER,
        asset,
        amount: "1.0000000",
      }),
    )
    .setTimebounds(Math.floor(NOW / 1_000), Math.floor(NOW / 1_000) + 300)
    .build();
  transaction.sign(ISSUER_KEYPAIR);
  return transaction.toXDR();
}

function singlePaymentVariantSignedEnvelope(
  options: {
    accountSequence?: string;
    assetIssuerPublicKey?: string;
    duplicateIssuerSignature?: boolean;
  } = {},
) {
  const account = new Account(ISSUER, options.accountSequence ?? "123");
  const asset = new Asset("NOVA", options.assetIssuerPublicKey ?? ISSUER);
  const transaction = new TransactionBuilder(account, {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      Operation.payment({
        destination: OWNER,
        asset,
        amount: "25.0000000",
      }),
    )
    .setTimebounds(Math.floor(NOW / 1_000), Math.floor(NOW / 1_000) + 300)
    .build();
  transaction.sign(ISSUER_KEYPAIR);
  if (options.duplicateIssuerSignature) {
    transaction.sign(ISSUER_KEYPAIR);
  }
  return transaction.toXDR();
}

function errorCode(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error
    ? String(error.code)
    : undefined;
}

test("successful mocked path preserves the required order and returns durable confirmation", async () => {
  const fx = fixture();
  const result = await fx.orchestrator.startOrResume(input);
  assert.equal(result.status, "confirmed");
  assert.deepEqual(fx.calls, [
    "preflight",
    "sign",
    "submit",
    "confirm",
    "persist_confirmation",
  ]);
  assert.equal(fx.store.attempts.length, 1);
  assert.equal(fx.store.attempts[0]!.attemptNumber, 1);
  assert.equal(fx.store.attempts[0]!.signingMode, "private");
  assert.equal(
    fx.store.confirmation?.transactionHash,
    fx.store.attempts[0]!.transactionHash,
  );
});

test("private Railway primitive reaches the existing one-shot issuance path", async () => {
  const requestAuthSecret = "d".repeat(48);
  const signerRuntime = createPrivateTestnetSignerRuntime({
    issuerPublicKey: ISSUER,
    requestAuthSecret,
    signer: ISSUER_KEYPAIR,
  });
  const primitive = new PrivateRailwaySharedIssuerSigningPrimitive(
    {
      privateBaseUrl: "http://orrylo-testnet-signer.railway.internal:8080",
      requestAuthSecret,
      issuerPublicKey: ISSUER,
    },
    (async (input, init) => {
      const request = new Request(input, init);
      const result = await handlePrivateTestnetSignerRequest(
        {
          method: request.method,
          path: new URL(request.url).pathname,
          authorization: request.headers.get("authorization"),
          readBody: () => request.text(),
        },
        signerRuntime,
      );
      return Response.json(result.body, { status: result.status });
    }) as typeof fetch,
  );

  const fx = fixture({ primitive });
  const result = await fx.orchestrator.startOrResume(input);

  assert.equal(result.status, "confirmed");
  assert.equal(fx.submissions(), 1);
  assert.equal(fx.store.attempts.length, 1);
  assert.equal(fx.store.attempts[0]!.attemptNumber, 1);
  assert.equal(fx.store.attempts[0]!.signingMode, "private");
});

test("private Railway signer failure causes zero submissions", async () => {
  let signerCalls = 0;
  const primitive = new PrivateRailwaySharedIssuerSigningPrimitive(
    {
      privateBaseUrl: "http://orrylo-testnet-signer.railway.internal:8080",
      requestAuthSecret: "e".repeat(48),
      issuerPublicKey: ISSUER,
    },
    (async () => {
      signerCalls += 1;
      return new Response(null, { status: 503 });
    }) as typeof fetch,
  );

  const fx = fixture({ primitive });
  const result = await fx.orchestrator.startOrResume(input);

  assert.equal(result.status, "failed_before_submission");
  assert.equal(signerCalls, 1);
  assert.equal(fx.submissions(), 0);
  assert.equal(fx.store.attempts.length, 1);
});

test("wrong owner fails before preflight and signing", async () => {
  const fx = fixture();
  await assert.rejects(() =>
    fx.orchestrator.startOrResume({ ...input, ownerPublicKey: OTHER_OWNER }),
  );
  assert.deepEqual(fx.calls, []);
  assert.equal(fx.store.attempts.length, 0);
});

test("missing trustline fails before attempt persistence and signing", async () => {
  const fx = fixture({ trustline: false });
  const result = await fx.orchestrator.startOrResume(input);
  assert.equal(result.status, "failed_before_submission");
  assert.deepEqual(fx.calls, ["preflight"]);
  assert.equal(fx.store.attempts.length, 0);
});

test("signer failure persists attempt 1 but causes no submission", async () => {
  const fx = fixture({ signerFails: true });
  const result = await fx.orchestrator.startOrResume(input);
  assert.equal(result.status, "failed_before_submission");
  assert.deepEqual(fx.calls, ["preflight", "sign"]);
  assert.equal(fx.submissions(), 0);
  assert.equal(fx.store.attempts.length, 1);
});

test("submission uncertainty is reconciliation-required and never retried", async () => {
  const fx = fixture({ submissionUncertain: true });
  const first = await fx.orchestrator.startOrResume(input);
  const second = await fx.orchestrator.startOrResume(input);
  assert.equal(first.status, "reconciliation_required");
  assert.equal(second.status, "confirmed");
  assert.equal(fx.submissions(), 1);
  assert.equal(fx.store.attempts.length, 1);
});

test("confirmation mismatch never produces success", async () => {
  const fx = fixture({ confirmationMismatch: true });
  const result = await fx.orchestrator.startOrResume(input);
  assert.equal(result.status, "reconciliation_required");
  assert.equal(fx.store.confirmation, null);
});

test("reload replay reconciles attempt 1 and never creates attempt 2 or resubmits", async () => {
  const fx = fixture({ confirmationMismatch: true });
  await fx.orchestrator.startOrResume(input);
  await fx.orchestrator.startOrResume(input);
  assert.equal(fx.store.attempts.length, 1);
  assert.equal(fx.submissions(), 1);
  assert.equal(fx.calls.filter((call) => call === "confirm").length, 2);
});

test("concurrent replay has one execution claimant and cannot create attempt 2", async () => {
  const fx = fixture();
  const results = await Promise.all([
    fx.orchestrator.startOrResume(input),
    fx.orchestrator.startOrResume(input),
  ]);
  assert.equal(fx.store.attempts.length, 1);
  assert.equal(fx.submissions(), 1);
  assert.ok(results.some((result) => result.status === "confirmed"));
  assert.ok(results.some((result) => result.status === "preparing_issuance"));
});

test("manual handoff persists attempt 1 and exposes exact unsigned XDR without signer or submission", async () => {
  const fx = fixture();
  const handoff = await fx.orchestrator.prepareManualSigningHandoff(input);

  assert.equal(handoff.status, "awaiting_manual_signature");
  assert.equal(handoff.attemptId, ATTEMPT_ID);
  assert.equal(handoff.issuerPublicKey, ISSUER);
  assert.equal(handoff.destinationPublicKey, OWNER);
  assert.equal(handoff.assetCode, "NOVA");
  assert.equal(handoff.amount, "25.0000000");
  assert.equal(handoff.transactionHash, buildVariantPlan().transactionHash);
  assert.equal(
    createHash("sha256").update(handoff.unsignedEnvelopeXdr).digest("hex"),
    handoff.unsignedEnvelopeXdrSha256,
  );
  assert.deepEqual(fx.calls, ["preflight"]);
  assert.equal(fx.submissions(), 0);
  assert.equal(fx.store.attempts.length, 1);
  assert.equal(fx.store.attempts[0]!.attemptNumber, 1);
  assert.equal(fx.store.attempts[0]!.signingMode, "manual");
  assert.equal(fx.store.attempts[0]!.signedEnvelopeXdrSha256, undefined);
});

test("private signing mode claimed first rejects manual export before a second signer can begin", async () => {
  let releaseSigner!: () => void;
  let signerEntered!: () => void;
  const entered = new Promise<void>((resolve) => {
    signerEntered = resolve;
  });
  const release = new Promise<void>((resolve) => {
    releaseSigner = resolve;
  });
  let signerCalls = 0;

  const fx = fixture({
    primitive: {
      async signCanonicalEnvelope(request) {
        signerCalls += 1;
        signerEntered();
        await release;
        const transaction = TransactionBuilder.fromXDR(
          request.unsignedEnvelopeXdr,
          Networks.TESTNET,
        );
        assert.ok(transaction instanceof Transaction);
        transaction.sign(ISSUER_KEYPAIR);
        return { signedEnvelopeXdr: transaction.toXDR() };
      },
    },
  });

  const privateRun = fx.orchestrator.startOrResume(input);
  await entered;

  assert.equal(fx.store.attempts[0]!.signingMode, "private");
  await assert.rejects(
    () => fx.orchestrator.prepareManualSigningHandoff(input),
    (error: unknown) => errorCode(error) === "manual_signing_already_consumed",
  );
  assert.equal(signerCalls, 1);

  releaseSigner();
  const result = await privateRun;
  assert.equal(result.status, "confirmed");
  assert.equal(signerCalls, 1);
  assert.equal(fx.submissions(), 1);
  assert.equal(fx.store.attempts.length, 1);
});

test("manual signing mode claimed first prevents private signer invocation and second export", async () => {
  let signerCalls = 0;
  const fx = fixture({
    primitive: {
      async signCanonicalEnvelope() {
        signerCalls += 1;
        throw new Error("private signer must not be reached");
      },
    },
  });

  const first = await fx.orchestrator.prepareManualSigningHandoff(input);
  assert.equal(first.status, "awaiting_manual_signature");
  assert.equal(fx.store.attempts[0]!.signingMode, "manual");

  const privateResult = await fx.orchestrator.startOrResume(input);
  assert.equal(privateResult.status, "preparing_issuance");
  assert.equal(signerCalls, 0);
  assert.equal(fx.submissions(), 0);

  await assert.rejects(
    () => fx.orchestrator.prepareManualSigningHandoff(input),
    (error: unknown) => errorCode(error) === "manual_signing_already_consumed",
  );
  assert.equal(fx.store.attempts.length, 1);
  assert.equal(fx.store.attempts[0]!.attemptNumber, 1);
});

test("simultaneous private and manual signing-mode claims have exactly one winner", async () => {
  let signerCalls = 0;
  const fx = fixture({
    primitive: {
      async signCanonicalEnvelope(request) {
        signerCalls += 1;
        const transaction = TransactionBuilder.fromXDR(
          request.unsignedEnvelopeXdr,
          Networks.TESTNET,
        );
        assert.ok(transaction instanceof Transaction);
        transaction.sign(ISSUER_KEYPAIR);
        return { signedEnvelopeXdr: transaction.toXDR() };
      },
    },
  });

  const results = await Promise.allSettled([
    fx.orchestrator.startOrResume(input),
    fx.orchestrator.prepareManualSigningHandoff(input),
  ]);

  assert.equal(fx.store.attempts.length, 1);
  assert.equal(fx.store.attempts[0]!.attemptNumber, 1);
  assert.ok(
    fx.store.attempts[0]!.signingMode === "private" ||
      fx.store.attempts[0]!.signingMode === "manual",
  );

  const manualWins = results.filter(
    (result) =>
      result.status === "fulfilled" &&
      "status" in result.value &&
      result.value.status === "awaiting_manual_signature",
  ).length;

  if (fx.store.attempts[0]!.signingMode === "manual") {
    assert.equal(manualWins, 1);
    assert.equal(signerCalls, 0);
    assert.equal(fx.submissions(), 0);
  } else {
    assert.equal(manualWins, 0);
    assert.equal(signerCalls, 1);
    assert.equal(fx.submissions(), 1);
  }
});

test("private signer mode claim is never retried after signer failure", async () => {
  let signerCalls = 0;
  const fx = fixture({
    primitive: {
      async signCanonicalEnvelope() {
        signerCalls += 1;
        throw new Error("signer unavailable");
      },
    },
  });

  const first = await fx.orchestrator.startOrResume(input);
  assert.equal(first.status, "failed_before_submission");
  assert.equal(fx.store.attempts[0]!.signingMode, "private");

  const second = await fx.orchestrator.startOrResume(input);
  assert.equal(second.status, "failed_before_submission");
  assert.equal(signerCalls, 1);
  assert.equal(fx.submissions(), 0);
  assert.equal(fx.store.attempts.length, 1);
});

test("legacy pending execution without an attempt remains recoverable after append failure", async () => {
  const fx = fixture({ appendFailures: 1 });
  fx.store.status = "pending_execution";

  const first = await fx.orchestrator.startOrResume(input);
  assert.equal(first.status, "preparing_issuance");
  assert.equal(fx.store.status, "pending_execution");
  assert.equal(fx.store.attempts.length, 0);
  assert.equal(fx.calls.filter((call) => call === "sign").length, 0);

  const second = await fx.orchestrator.startOrResume(input);
  assert.equal(second.status, "confirmed");
  assert.equal(fx.store.attempts.length, 1);
  assert.equal(fx.store.attempts[0]!.attemptNumber, 1);
  assert.equal(fx.store.attempts[0]!.signingMode, "private");
  assert.equal(fx.submissions(), 1);
});

test("manual signed-envelope bridge accepts only the exact persisted Testnet transaction", async () => {
  const fx = fixture();
  const handoff = await fx.orchestrator.prepareManualSigningHandoff(input);
  const canonicalPlan = buildVariantPlan();

  const wrongNetwork = TransactionBuilder.fromXDR(
    handoff.unsignedEnvelopeXdr,
    Networks.PUBLIC,
  );
  assert.ok(wrongNetwork instanceof Transaction);
  wrongNetwork.sign(ISSUER_KEYPAIR);

  const malformed = TransactionBuilder.fromXDR(
    handoff.unsignedEnvelopeXdr,
    Networks.TESTNET,
  );
  const wrongSignature = TransactionBuilder.fromXDR(
    handoff.unsignedEnvelopeXdr,
    Networks.TESTNET,
  );
  assert.ok(malformed instanceof Transaction);
  assert.ok(wrongSignature instanceof Transaction);
  malformed.sign(ISSUER_KEYPAIR);
  wrongSignature.sign(WRONG_SIGNER_KEYPAIR);
  malformed.signatures[0] = new xdr.DecoratedSignature({
    hint: malformed.signatures[0]!.hint,
    signature: wrongSignature.signatures[0]!.signature,
  });

  const cases = [
    {
      name: "wrong transaction hash and amount",
      xdr: signPlan(buildVariantPlan({ amount: "26.0000000" })),
    },
    {
      name: "wrong issuer and transaction source",
      xdr: signPlan(
        buildVariantPlan({
          issuerPublicKey: OTHER_ISSUER_KEYPAIR.publicKey(),
        }),
        OTHER_ISSUER_KEYPAIR,
      ),
    },
    {
      name: "wrong destination",
      xdr: signPlan(buildVariantPlan({ destinationPublicKey: OTHER_OWNER })),
    },
    {
      name: "wrong asset",
      xdr: signPlan(buildVariantPlan({ assetCode: "OTHER" })),
    },
    {
      name: "changed time bounds",
      xdr: signPlan(
        buildVariantPlan({
          validFrom: canonicalPlan.validFrom + 1,
          validUntil: canonicalPlan.validUntil + 1,
        }),
      ),
    },
    {
      name: "changed source sequence",
      xdr: singlePaymentVariantSignedEnvelope({ accountSequence: "124" }),
    },
    {
      name: "wrong issuer on asset",
      xdr: singlePaymentVariantSignedEnvelope({
        assetIssuerPublicKey: OTHER_ISSUER_KEYPAIR.publicKey(),
      }),
    },
    {
      name: "extra operation",
      xdr: extraOperationSignedEnvelope(),
    },
    {
      name: "extra issuer signature",
      xdr: singlePaymentVariantSignedEnvelope({
        duplicateIssuerSignature: true,
      }),
    },
    {
      name: "wrong network signature",
      xdr: wrongNetwork.toXDR(),
    },
    {
      name: "wrong signer",
      xdr: signPlan(canonicalPlan, WRONG_SIGNER_KEYPAIR),
    },
    {
      name: "malformed signature",
      xdr: malformed.toXDR(),
    },
  ];

  for (const candidate of cases) {
    await assert.rejects(
      () =>
        fx.orchestrator.submitManualSignedEnvelope({
          ...input,
          signedEnvelopeXdr: candidate.xdr,
        }),
      (error: unknown) => error instanceof Error,
      candidate.name,
    );
    assert.equal(
      fx.store.attempts[0]!.signedEnvelopeXdrSha256,
      undefined,
      candidate.name,
    );
    assert.equal(fx.submissions(), 0, candidate.name);
  }

  const signedEnvelopeXdr = signPlan(canonicalPlan);
  const result = await fx.orchestrator.submitManualSignedEnvelope({
    ...input,
    signedEnvelopeXdr,
  });

  assert.equal(result.status, "confirmed");
  assert.equal(fx.submissions(), 1);
  assert.ok(fx.store.attempts[0]!.signedEnvelopeXdrSha256);
  assert.equal(fx.store.attempts.length, 1);
});

test("manual bridge persists signed digest before one submission and rejects every second-sign path", async () => {
  const fx = fixture({ submissionUncertain: true });
  const handoff = await fx.orchestrator.prepareManualSigningHandoff(input);
  const signedEnvelopeXdr = signPlan(buildVariantPlan());

  const first = await fx.orchestrator.submitManualSignedEnvelope({
    ...input,
    signedEnvelopeXdr,
  });
  assert.equal(first.status, "reconciliation_required");
  assert.equal(fx.submissions(), 1);
  assert.ok(fx.store.attempts[0]!.signedEnvelopeXdrSha256);

  await assert.rejects(
    () =>
      fx.orchestrator.submitManualSignedEnvelope({
        ...input,
        signedEnvelopeXdr,
      }),
    (error: unknown) => errorCode(error) === "manual_signing_already_consumed",
  );
  assert.equal(fx.submissions(), 1);
  assert.equal(fx.store.attempts.length, 1);

  const reconciled = await fx.orchestrator.reconcileManualAttempt(input);
  assert.equal(reconciled.status, "confirmed");
  assert.equal(fx.submissions(), 1);
  assert.equal(fx.store.attempts.length, 1);
});

test("concurrent manual signed-envelope submissions have exactly one Horizon claimant", async () => {
  const fx = fixture({ submissionUncertain: true });
  await fx.orchestrator.prepareManualSigningHandoff(input);
  const signedEnvelopeXdr = signPlan(buildVariantPlan());

  const results = await Promise.all([
    fx.orchestrator.submitManualSignedEnvelope({
      ...input,
      signedEnvelopeXdr,
    }),
    fx.orchestrator.submitManualSignedEnvelope({
      ...input,
      signedEnvelopeXdr,
    }),
  ]);

  assert.equal(fx.submissions(), 1);
  assert.equal(fx.store.attempts.length, 1);
  assert.ok(fx.store.attempts[0]!.signedEnvelopeXdrSha256);
  assert.ok(
    results.every((result) => result.status === "reconciliation_required"),
  );
});

test("manual handoff cannot be rebound to a different configured issuer", async () => {
  const fx = fixture();
  fx.store.intents.set(REQUEST_ID, {
    ...intent(),
    issuerPublicKey: OTHER_ISSUER_KEYPAIR.publicKey(),
  });

  await assert.rejects(
    () => fx.orchestrator.prepareManualSigningHandoff(input),
    (error: unknown) => errorCode(error) === "manual_issuer_mismatch",
  );
  assert.equal(fx.store.attempts.length, 0);
  assert.equal(fx.submissions(), 0);
});
