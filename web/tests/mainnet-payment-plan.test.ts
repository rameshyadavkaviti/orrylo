import assert from "node:assert/strict";
import { test } from "node:test";
import {
  Asset,
  Networks,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { buildUnsignedMainnetOrderPayment } from "../lib/stellar/mainnet-payment-plan";

const source = "GCLZ6AXEQ2U2KAI62AWDLLDI4EIHOUGRVFTNAHTT44S2MX3GWQAGTCHR";
const treasury = "GAABHXPQQB3EBT6FZJKGR6C6DT7XJEUEBGVPK2G2AQDKBIVXCBKXDBR7";
const memo = "o" + "a".repeat(27);
const valid = { source, sourceSequence: "1000000", destination: treasury, memo };

test("unsigned XDR binds public network, exact single native 10 XLM operation and memo", () => {
  const plan = buildUnsignedMainnetOrderPayment(valid);
  assert.equal(plan.network, "public");
  assert.equal(plan.amount, "10.0000000");
  const transaction = TransactionBuilder.fromXDR(plan.xdr, Networks.PUBLIC);
  assert.equal(transaction.operations.length, 1);
  const payment = transaction.operations[0];
  assert.equal(payment.type, "payment");
  if (payment.type !== "payment") return;
  assert.equal(payment.destination, treasury);
  assert.equal(payment.source, source);
  assert.equal(payment.amount, "10.0000000");
  assert.equal(payment.asset.equals(Asset.native()), true);
  assert.equal(transaction.memo.type, "text");
  assert.equal(transaction.memo.value, memo);
  assert.equal(transaction.signatures.length, 0);
  assert.equal(transaction.hash().toString("hex"), plan.expectedHash);
});

test("invalid source, destination, memo or sequence never creates XDR", () => {
  for (const change of [
    { source: treasury, destination: treasury },
    { source: "bad" },
    { destination: "bad" },
    { memo: "other" },
    { memo: "o" + "z".repeat(27) },
    { sourceSequence: "-1" },
    { sourceSequence: "1.5" },
  ]) {
    assert.throws(() => buildUnsignedMainnetOrderPayment({ ...valid, ...change }),
      /invalid_mainnet_payment_plan/);
  }
});
