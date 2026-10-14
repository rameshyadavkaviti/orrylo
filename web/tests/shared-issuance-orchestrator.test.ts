import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  Keypair,
  Networks,
  Transaction,
  TransactionBuilder,
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
  hashSharedIssuerIssuanceIntent,
} from "../lib/stellar/shared-issuer-issuance";

const ISSUER_KEYPAIR = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 121));
const ISSUER = ISSUER_KEYPAIR.publicKey();
const OWNER = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 122)).publicKey();
const OTHER_OWNER = Keypair.fromRawEd25519Seed(
  Buffer.alloc(32, 123),
).publicKey();
const PROJECT_ID = "10000000-0000-4000-8000-000000000001";
const REQUEST_ID = "10000000-0000-4000-8000-000000000002";
const ATTEMPT_ID = "10000000-0000-4000-8000-000000000003";
const NOW = 1_800_000_000_000;

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
  status = "awaiting_issuer_integration" as const;
  failureCode: string | null = null;
  transitions: string[] = [];

  async getIntent(requestId: string) {
    return this.intents.get(requestId) ?? null;
  }
  async listAttempts(requestId: string) {
    return this.attempts.filter((item) => item.issuanceRequestId === requestId);
  }
  async appendAttempt(attempt: ImmutableSharedIssuanceTransactionAttempt) {
    if (this.attempts.length) throw new Error("attempt 2 rejected");
    this.attempts.push(attempt);
    return attempt;
  }
  async getAttempt(attemptId: string) {
    return this.attempts.find((item) => item.attemptId === attemptId) ?? null;
  }
  async recordSignedEnvelope(input: {
    attemptId: string;
    transactionHash: string;
    signedEnvelopeXdrSha256: string;
  }) {
    const existing = await this.getAttempt(input.attemptId);
    assert.ok(existing);
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
    status: typeof this.status,
    failureCode: string | null = null,
  ) {
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
  } = {},
) {
  const store = new MemoryStore();
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
