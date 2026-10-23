import assert from "node:assert/strict";
import { test } from "node:test";
import type { DatabaseClient } from "../lib/server/persistence/database";
import { MainnetOrderError, settleMainnetTokenOrder } from "../lib/server/projects/mainnet-token-orders";
import type { verifyMainnetPayment } from "../lib/stellar/mainnet-payment-verification";

const owner = "GCLZ6AXEQ2U2KAI62AWDLLDI4EIHOUGRVFTNAHTT44S2MX3GWQAGTCHR";
const treasury = "GAABHXPQQB3EBT6FZJKGR6C6DT7XJEUEBGVPK2G2AQDKBIVXCBKXDBR7";
const hash = "a".repeat(64);
const orderId = "018f8c8c-1234-7890-9abc-def012345678";
const now = new Date();
const order = {
  order_id: orderId, owner_public_key: owner, treasury_public_key: treasury,
  memo: "o" + "b".repeat(27), state: "pending", payment_transaction_hash: null,
  created_at: new Date(now.getTime() - 60_000),
  expires_at: new Date(now.getTime() + 60_000),
};

function fakeDatabase(row = order) {
  const queries: string[] = [];
  const sql = (async (strings: TemplateStringsArray) => {
    const query = strings.join("?").replace(/\s+/g, " ").trim();
    queries.push(query);
    if (query.startsWith("SELECT")) return [row];
    if (query.startsWith("UPDATE")) return [];
    throw new Error(`Unexpected SQL: ${query}`);
  }) as unknown as DatabaseClient;
  return { sql, queries };
}

const confirmed: typeof verifyMainnetPayment = async () => ({
  status: "confirmed", hash, ledger: 123, createdAt: now.toISOString(),
});

test("settlement rechecks order/payment timestamps and current expiry in the atomic update", async () => {
  const fixture = fakeDatabase();
  await assert.rejects(
    settleMainnetTokenOrder(fixture.sql, { orderId, ownerPublicKey: owner, transactionHash: hash }, confirmed),
    (error: unknown) => error instanceof MainnetOrderError && error.code === "order_expired_or_conflicted",
  );
  const update = fixture.queries.find((query) => query.startsWith("UPDATE"));
  assert.ok(update);
  assert.match(update, /expires_at > now\(\)/i);
  assert.match(update, /created_at <= .*timestamptz/i);
  assert.match(update, /expires_at > .*timestamptz/i);
});

test("settlement refuses a verifier result for a different hash", async () => {
  const fixture = fakeDatabase();
  await assert.rejects(
    settleMainnetTokenOrder(fixture.sql, { orderId, ownerPublicKey: owner, transactionHash: hash },
      async () => ({ status: "confirmed", hash: "c".repeat(64), ledger: 123, createdAt: now.toISOString() })),
    (error: unknown) => error instanceof MainnetOrderError && error.code === "payment_hash_mismatch",
  );
  assert.equal(fixture.queries.some((query) => query.startsWith("UPDATE")), false);
});
