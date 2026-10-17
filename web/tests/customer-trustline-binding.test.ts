import assert from "node:assert/strict";
import test from "node:test";
import {
  bindPersistedCustomerTrustline,
  type CustomerTrustlineHandoff,
} from "../lib/server/projects/customer-trustline-guard";

const prior: CustomerTrustlineHandoff = {
  handoffId: "handoff",
  projectId: "project",
  ownerPublicKey: "owner",
  assetCode: "TOKEN",
  issuerPublicKey: "issuer",
  destinationPublicKey: "owner",
  amount: "25.0000000",
  transactionHash: "a".repeat(64),
  unsignedXdr: "persisted-xdr",
  sourceSequence: "100",
  validUntil: 1800000300,
  resolution: null,
};
const request = {
  projectId: "project",
  ownerPublicKey: "owner",
  assetCode: "TOKEN",
  transactionHash: prior.transactionHash,
};
test("reconciliation binds persisted amount and XDR without requiring the browser's original amount", () => {
  const bound = bindPersistedCustomerTrustline(prior, request);
  assert.equal(bound.initialSupply, "25.0000000");
  assert.equal(bound.unsignedXdr, "persisted-xdr");
  assert.equal(bound.transactionHash, prior.transactionHash);
});
test("reconciliation still rejects a substituted project, owner, asset, hash or XDR", () => {
  for (const delta of [
    { projectId: "other" },
    { ownerPublicKey: "other" },
    { assetCode: "OTHER" },
    { transactionHash: "b".repeat(64) },
    { unsignedXdr: "other" },
  ]) {
    assert.throws(
      () => bindPersistedCustomerTrustline(prior, { ...request, ...delta }),
      /trustline_transaction_mismatch/,
    );
  }
  assert.throws(
    () => bindPersistedCustomerTrustline(null, request),
    /trustline_transaction_mismatch/,
  );
});
