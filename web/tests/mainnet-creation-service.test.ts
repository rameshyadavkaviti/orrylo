import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { Keypair } from "@stellar/stellar-sdk";

import {
  MainnetCreationService,
  type MainnetCreationServiceStore,
} from "../lib/server/projects/mainnet-creation-service";
import type { MainnetOrderRecord } from "../lib/server/projects/mainnet-creation-store";
import {
  MAINNET_SHARED_ISSUER_PUBLIC_KEY,
  MAINNET_TREASURY_PUBLIC_KEY,
  buildMainnetIssuance,
} from "../lib/stellar/mainnet-creation";

const owner = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 42)).publicKey();
const projectId = "10000000-0000-4000-8000-000000000011";
const transaction = buildMainnetIssuance({
  issuerSequence: "70",
  destinationPublicKey: owner,
  assetCode: "ACME",
  amount: "25",
  feeStroops: "100",
  maxFeeStroops: "1000",
  ledgerClosedAt: "2026-10-23T10:00:00Z",
});

class MemoryStore implements MainnetCreationServiceStore {
  order: MainnetOrderRecord = {
    orderId: "10000000-0000-4000-8000-000000000012",
    projectId,
    ownerPublicKey: owner,
    issuerPublicKey: MAINNET_SHARED_ISSUER_PUBLIC_KEY,
    treasuryPublicKey: MAINNET_TREASURY_PUBLIC_KEY,
    destinationPublicKey: owner,
    assetCode: "ACME",
    amount: "25",
    priceStroops: "100000000",
    paymentMemo: "ORRYLO_AAAAAAAAAAAAAAAAAAAAA",
    status: "trustline_confirmed",
    publicationStatus: "pending",
    publicationErrorCode: null,
    paymentTransactionHash: "b".repeat(64),
    trustlineTransactionHash: "c".repeat(64),
    issuanceTransactionHash: null,
  };
  attempt: Awaited<ReturnType<MainnetCreationServiceStore["getIssuanceAttempt"]>> = null;
  claims = 0;
  confirmations = 0;

  async getOwned() { return this.order; }
  async getTrustlineAttempt() { return null; }
  async reserveTrustline() { return this.order; }
  async markExistingTrustline() { return this.order; }
  async confirmTrustline() { return this.order; }
  async getIssuanceAttempt() { return this.attempt; }
  async reserveIssuance(input: Parameters<MainnetCreationServiceStore["reserveIssuance"]>[0]) {
    this.attempt = {
      attemptId: input.attemptId,
      transactionHash: input.transaction.transactionHash,
      unsignedXdr: input.transaction.unsignedXdr,
      signedEnvelopeXdrSha256: null,
      status: "prepared",
    };
    this.order = { ...this.order, status: "issuance_pending", issuanceTransactionHash: input.transaction.transactionHash };
    return this.order;
  }
  async claimIssuanceForSigning() {
    if (!this.attempt || this.attempt.status !== "prepared") return false;
    this.claims += 1;
    this.attempt.status = "signing";
    this.order = { ...this.order, status: "issuance_reconciliation_required" };
    return true;
  }
  async markIssuanceSubmitted(input: Parameters<MainnetCreationServiceStore["markIssuanceSubmitted"]>[0]) {
    assert.ok(this.attempt);
    this.attempt.status = "submitted";
    this.attempt.signedEnvelopeXdrSha256 = input.signedEnvelopeXdrSha256;
  }
  async confirmIssuance() {
    this.confirmations += 1;
    this.order = { ...this.order, status: "issued" };
    if (this.attempt) this.attempt.status = "confirmed";
    return this.order;
  }
}

function fixture(options: { signerUncertain?: boolean; signerUnavailable?: boolean; initiallyNotFound?: boolean } = {}) {
  const store = new MemoryStore();
  let signerCalls = 0;
  let verifies = 0;
  let publications = 0;
  const service = new MainnetCreationService({
    store,
    now: () => Date.parse("2026-10-23T10:00:10Z"),
    createId: () => "10000000-0000-4000-8000-000000000013",
    prepareIssuance: async () => transaction,
    signer: {
      async checkReady() {
        if (options.signerUnavailable) throw new Error("signer_unavailable");
      },
      async signAndSubmit() {
        signerCalls += 1;
        if (options.signerUncertain) throw new Error("signer_transport_uncertain");
        return {
          transactionHash: transaction.transactionHash,
          signedEnvelopeXdrSha256: createHash("sha256").update("signed").digest("hex"),
        };
      },
    },
    verifyIssuance: async () => {
      verifies += 1;
      if (options.initiallyNotFound && verifies === 1) return { status: "not_found" as const };
      return {
        status: "confirmed" as const,
        transactionHash: transaction.transactionHash,
        ledgerSequence: 99,
        ledgerClosedAt: "2026-10-23T10:00:05.000Z",
        sourceSequence: transaction.sourceSequence,
        envelopeXdrSha256: createHash("sha256").update("envelope").digest("hex"),
        resultXdrSha256: createHash("sha256").update("result").digest("hex"),
      };
    },
    publish: async () => { publications += 1; },
  });
  return { service, store, counts: () => ({ signerCalls, verifies, publications }) };
}

test("confirmed issuance signs once, verifies exact hash, and publishes after confirmation", async () => {
  const { service, store, counts } = fixture();
  const result = await service.issueOrReconcile(projectId, owner);
  assert.equal(result.status, "issued");
  assert.deepEqual(counts(), { signerCalls: 1, verifies: 1, publications: 1 });
  assert.equal(store.claims, 1);
  assert.equal(store.confirmations, 1);

  const replay = await service.issueOrReconcile(projectId, owner);
  assert.equal(replay.status, "issued");
  assert.deepEqual(counts(), { signerCalls: 1, verifies: 1, publications: 2 });
});

test("uncertain signer outcome is reconciled without a second signer call", async () => {
  const { service, store, counts } = fixture({ signerUncertain: true });
  const first = await service.issueOrReconcile(projectId, owner);
  assert.equal(first.status, "issuance_reconciliation_required");
  assert.equal(counts().signerCalls, 1);
  assert.equal(store.order.status, "issuance_reconciliation_required");

  await service.issueOrReconcile(projectId, owner);
  assert.equal(counts().signerCalls, 1);
});

test("signer outage before claim leaves the one issuance attempt safely retryable", async () => {
  const { service, store, counts } = fixture({ signerUnavailable: true });
  await assert.rejects(
    service.issueOrReconcile(projectId, owner),
    /signer_unavailable/,
  );
  assert.equal(store.order.status, "issuance_pending");
  assert.equal(store.attempt?.status, "prepared");
  assert.equal(store.claims, 0);
  assert.equal(counts().signerCalls, 0);
});
