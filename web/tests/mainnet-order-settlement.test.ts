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

type OrderFixture = Omit<typeof order, "payment_transaction_hash"> & {
  payment_transaction_hash: string | null;
};

function fakeDatabase(row: OrderFixture = order) {
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

test("a refunded order is never reported as already paid, even for its old hash", async () => {
  const fixture = fakeDatabase({ ...order, state: "refunded", payment_transaction_hash: hash });
  await assert.rejects(
    settleMainnetTokenOrder(fixture.sql, { orderId, ownerPublicKey: owner, transactionHash: hash }, confirmed),
    (error: unknown) => error instanceof MainnetOrderError && error.code === "order_already_consumed",
  );
  assert.equal(fixture.queries.some((query) => query.startsWith("UPDATE")), false);
});

test("concurrent claims for the same order yield one paid and one already_paid", async () => {
  let state: OrderFixture = { ...order };
  let firstReads = 0;
  let release!: () => void;
  const bothStarted = new Promise<void>((resolve) => { release = resolve; });
  let updates = 0;
  const sql = (async (strings: TemplateStringsArray) => {
    const query = strings.join("?").replace(/\s+/g, " ").trim();
    if (query.startsWith("SELECT")) {
      if (++firstReads <= 2) {
        if (firstReads === 2) release();
        await bothStarted;
        return [{ ...order }];
      }
      return [{ ...state }];
    }
    if (query.startsWith("UPDATE")) {
      assert.match(query, /AND state = 'pending' AND payment_transaction_hash IS NULL/);
      if (state.state !== "pending") return [];
      updates++;
      state = { ...state, state: "paid", payment_transaction_hash: hash };
      return [{ ...state }];
    }
    throw new Error(`Unexpected SQL: ${query}`);
  }) as unknown as DatabaseClient;
  const input = { orderId, ownerPublicKey: owner, transactionHash: hash };
  const results = await Promise.all([
    settleMainnetTokenOrder(sql, input, confirmed),
    settleMainnetTokenOrder(sql, input, confirmed),
  ]);
  assert.deepEqual(results.map((result) => result.status).sort(), ["already_paid", "paid"]);
  assert.equal(updates, 1);
});

test("a transaction not found on Horizon leaves the order untouched", async () => {
  const fixture = fakeDatabase();
  const result = await settleMainnetTokenOrder(
    fixture.sql, { orderId, ownerPublicKey: owner, transactionHash: hash },
    async () => ({ status: "not_found" }),
  );
  assert.equal(result.status, "not_found");
  assert.equal(fixture.queries.some((query) => query.startsWith("UPDATE")), false);
});

test("a payment hash already consumed by another order fails closed", async () => {
  const sql = (async (strings: TemplateStringsArray) => {
    const query = strings.join("?").replace(/\s+/g, " ").trim();
    if (query.startsWith("SELECT")) return [{ ...order }];
    if (query.startsWith("UPDATE")) throw Object.assign(new Error("duplicate payment"), { code: "23505" });
    throw new Error(`Unexpected SQL: ${query}`);
  }) as unknown as DatabaseClient;
  await assert.rejects(
    settleMainnetTokenOrder(sql, { orderId, ownerPublicKey: owner, transactionHash: hash }, confirmed),
    (error: unknown) => error instanceof MainnetOrderError && error.code === "payment_already_used",
  );
});
