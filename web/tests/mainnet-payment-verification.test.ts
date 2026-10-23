import assert from "node:assert/strict";
import { test } from "node:test";
import { verifyMainnetPayment } from "../lib/stellar/mainnet-payment-verification";

const sender = "GCLZ6AXEQ2U2KAI62AWDLLDI4EIHOUGRVFTNAHTT44S2MX3GWQAGTCHR";
const treasury = "GBR7SEZD4ITXQPAWEVBX2BULS76ERDRTRMIS3LUYKZ7DNLGZZ6ASSETS";
const hash = "a".repeat(64);
const intent = { transactionHash: hash, sender, treasury, memo: "order_123" };

function fakeFetch(transactionPatch: Record<string, unknown> = {}, operationPatch: Record<string, unknown> = {}): typeof fetch {
  return (async (url: string) => {
    const op = url.includes("/operations?");
    const body = op
      ? { _embedded: { records: [{
          type: "payment", source_account: sender, from: sender, to: treasury,
          asset_type: "native", amount: "10.0000000", ...operationPatch,
        }] } }
      : { hash, successful: true, source_account: sender, memo_type: "text",
          memo: "order_123", ledger: 123, operation_count: 1, ...transactionPatch };
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
}

test("confirms exactly ten XLM and order memo", async () => {
  assert.deepEqual(await verifyMainnetPayment(intent, fakeFetch()), {
    status: "confirmed", hash, ledger: 123,
  });
});

test("rejects a two-stroop transfer that prints as 0.0000002 XLM", async () => {
  assert.deepEqual(await verifyMainnetPayment(intent, fakeFetch({}, { amount: "0.0000002" })), {
    status: "rejected",
  });
});

test("rejects wrong memo, recipient, sender and extra operations", async () => {
  for (const fetchImpl of [
    fakeFetch({ memo: "other" }),
    fakeFetch({}, { to: sender }),
    fakeFetch({}, { source_account: treasury }),
    fakeFetch({ operation_count: 2 }),
  ]) {
    assert.deepEqual(await verifyMainnetPayment(intent, fetchImpl), { status: "rejected" });
  }
});

test("rejects alternate asset and fractional underpayment", async () => {
  for (const changes of [
    { asset_type: "credit_alphanum4" }, { amount: "9.9999999" },
    { amount: "100000000" },
  ]) {
    assert.deepEqual(await verifyMainnetPayment(intent, fakeFetch({}, changes)), { status: "rejected" });
  }
});

test("does not treat a missing transaction as paid", async () => {
  const missing = (async () => new Response("", { status: 404 })) as typeof fetch;
  assert.deepEqual(await verifyMainnetPayment(intent, missing), { status: "not_found" });
});
