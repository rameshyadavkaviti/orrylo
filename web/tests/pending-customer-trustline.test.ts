import assert from "node:assert/strict";
import test from "node:test";

import {
  clearResolvedCustomerTrustline,
  pendingCustomerTrustlineKey,
  readPendingCustomerTrustline,
  storePendingCustomerTrustline,
  type PendingCustomerTrustline,
} from "../lib/projects/pending-customer-trustline";

const PROJECT = "cabb5cec-0140-4d7f-93a5-d37d7b7a5f13";
const DESTINATION =
  "GBJIM6BH2WYV3BLAFR4F6KW6Y7XZV36FBXZFICMWQ5Y7DVL4RGV2CYPB";
const ISSUER =
  "GBW4IKGPC5Q4YRKGRMNNXTVRZNQZ3DFWFHXSQUAMWLXES75MWTY3TWOV";
const HASH = "a".repeat(64);

const EVIDENCE: PendingCustomerTrustline = {
  version: 1,
  network: "testnet",
  projectId: PROJECT,
  assetCode: "TESTNEW",
  destinationPublicKey: DESTINATION,
  issuerPublicKey: ISSUER,
  amount: "250",
  transactionHash: HASH,
  unsignedXdr: "AAAAAgAAA...",
  validUntil: 1792140000,
};

function fakeStorage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
    removeItem(key: string) {
      values.delete(key);
    },
  };
}

test("unknown Albedo submission keeps exact hash, unsigned XDR and guard over refresh and reload", () => {
  const storage = fakeStorage();
  assert.equal(storePendingCustomerTrustline(storage, EVIDENCE), true);
  assert.equal(
    readPendingCustomerTrustline(storage, PROJECT).kind,
    "pending",
  );
  // A refreshed not-ready trustline must not touch the pending record.
  const refreshed = { status: "signature_required" };
  assert.equal(refreshed.status, "signature_required");
  assert.equal(
    readPendingCustomerTrustline(storage, PROJECT).kind,
    "pending",
  );
  // Simulate a new page/component loading the same persistent browser store.
  const afterReload = readPendingCustomerTrustline(storage, PROJECT);
  assert.deepEqual(afterReload, { kind: "pending", value: EVIDENCE });
  assert.equal(
    storePendingCustomerTrustline(storage, {
      ...EVIDENCE,
      transactionHash: "b".repeat(64),
    }),
    false,
  );
  assert.equal(
    storePendingCustomerTrustline(storage, EVIDENCE),
    false,
  );
  assert.equal(
    storage.values.get(pendingCustomerTrustlineKey(PROJECT)),
    JSON.stringify(EVIDENCE),
  );
});

test("only exact-hash resolution can clear browser signing interlock", () => {
  const storage = fakeStorage();
  assert.equal(storePendingCustomerTrustline(storage, EVIDENCE), true);
  assert.equal(
    clearResolvedCustomerTrustline(storage, PROJECT, "b".repeat(64)),
    false,
  );
  assert.equal(readPendingCustomerTrustline(storage, PROJECT).kind, "pending");
  assert.equal(clearResolvedCustomerTrustline(storage, PROJECT, HASH), true);
  assert.equal(readPendingCustomerTrustline(storage, PROJECT).kind, "none");
  assert.equal(storePendingCustomerTrustline(storage, EVIDENCE), true);
});

test("corrupt or inaccessible browser storage fails closed before Albedo", () => {
  const storage = fakeStorage();
  storage.setItem(pendingCustomerTrustlineKey(PROJECT), "{not-json");
  assert.equal(readPendingCustomerTrustline(storage, PROJECT).kind, "blocked");
  assert.equal(storePendingCustomerTrustline(storage, EVIDENCE), false);

  const unavailable = {
    getItem(_key: string): string | null {
      throw new Error("storage blocked");
    },
    setItem(_key: string, _value: string) {
      throw new Error("storage blocked");
    },
    removeItem(_key: string) {
      throw new Error("storage blocked");
    },
  };
  assert.equal(readPendingCustomerTrustline(unavailable, PROJECT).kind, "blocked");
  assert.equal(storePendingCustomerTrustline(unavailable, EVIDENCE), false);
  assert.equal(clearResolvedCustomerTrustline(unavailable, PROJECT, HASH), false);
});

test("different reviewed amounts on the same project cannot bypass pending signing state", () => {
  const storage = fakeStorage();
  assert.equal(storePendingCustomerTrustline(storage, EVIDENCE), true);
  assert.equal(
    storePendingCustomerTrustline(storage, {
      ...EVIDENCE,
      amount: "500",
      transactionHash: "f".repeat(64),
    }),
    false,
  );
  assert.equal(readPendingCustomerTrustline(storage, PROJECT).kind, "pending");
});
