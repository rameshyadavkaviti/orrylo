import assert from "node:assert/strict";
import test from "node:test";
import {
  clearSettledMainnetPayment,
  readPendingMainnetPayment,
  withMainnetPaymentHandoff,
  type PendingMainnetPayment,
} from "../lib/projects/pending-mainnet-payment";

const orderId = "e739596b-4847-4e45-9df3-d9e8ba381b62";
const payment: PendingMainnetPayment = {
  version: 1,
  network: "public",
  orderId,
  source: "GCLZ6AXEQ2U2KAI62AWDLLDI4EIHOUGRVFTNAHTT44S2MX3GWQAGTCHR",
  transactionHash: "a".repeat(64),
  unsignedXdr: "AAAA",
};

function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

test("mainnet wallet handoff saves exact payment hash before opening wallet and blocks second submission", async () => {
  const store = storage();
  const locks = {request: async (_key: string, _options: unknown, action: (lock: object | null) => Promise<boolean>) => action({})};
  let walletCalls = 0;
  const handoff = async () => {
    walletCalls++;
    assert.deepEqual(readPendingMainnetPayment(store, orderId), {kind: "pending", value: payment});
    throw new Error("unknown wallet outcome");
  };
  await assert.rejects(withMainnetPaymentHandoff(store, payment, locks, handoff), /unknown wallet outcome/);
  assert.equal(await withMainnetPaymentHandoff(store, payment, locks, handoff), false);
  assert.equal(walletCalls, 1);
  assert.deepEqual(readPendingMainnetPayment(store, orderId), {kind: "pending", value: payment});
});

test("mainnet payment pending hash survives refresh and can only be cleared after exact settlement", () => {
  const store = storage();
  assert.equal(readPendingMainnetPayment(store, orderId).kind, "none");
  store.setItem(`orrylo:pending-mainnet-payment:v1:${orderId}`, JSON.stringify(payment));
  assert.equal(clearSettledMainnetPayment(store, orderId, "b".repeat(64)), false);
  assert.equal(readPendingMainnetPayment(store, orderId).kind, "pending");
  assert.equal(clearSettledMainnetPayment(store, orderId, payment.transactionHash), true);
  assert.equal(readPendingMainnetPayment(store, orderId).kind, "none");
});

test("unavailable locks and corrupt storage prevent opening payment wallet", async () => {
  const store = storage();
  let called = false;
  assert.equal(await withMainnetPaymentHandoff(store, payment, undefined, async () => {called = true;}), false);
  assert.equal(called, false);
  store.setItem(`orrylo:pending-mainnet-payment:v1:${orderId}`, "broken");
  assert.equal(readPendingMainnetPayment(store, orderId).kind, "blocked");
  assert.equal(await withMainnetPaymentHandoff(store, payment, {request: async (_key, _opt, cb) => cb({})}, async () => {called = true;}), false);
  assert.equal(called, false);
});
