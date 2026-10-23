import assert from "node:assert/strict";
import test from "node:test";
import type { DatabaseClient } from "../lib/server/persistence/database";
import { MainnetOrderError, prepareMainnetOrderPayment } from "../lib/server/projects/mainnet-token-orders";
import { MAINNET_ISSUER, MAINNET_TREASURY } from "../lib/server/projects/mainnet-token-orders";

const owner = "GCLZ6AXEQ2U2KAI62AWDLLDI4EIHOUGRVFTNAHTT44S2MX3GWQAGTCHR";
const orderId = "8f3d1eae-f7fb-4708-80e4-011a15a5ad4c";
const record = {
  order_id: orderId, owner_public_key: owner, issuer_public_key: MAINNET_ISSUER,
  treasury_public_key: MAINNET_TREASURY, destination_public_key: owner,
  memo: "o" + "a".repeat(27), state: "pending", payment_transaction_hash: null,
  expires_at: new Date(Date.now() + 30 * 60_000),
  payment_plan_hash: null as string | null,
  payment_plan_xdr: null as string | null,
  payment_plan_prepared_at: null as Date | null,
};

test("a Mainnet order reserves one payment XDR and reuses it on subsequent preparations", async () => {
  const state = {...record};
  const statements: string[] = [];
  const sql = Object.assign(async () => [], {
    begin: async (action: (tx: unknown) => Promise<unknown>) => action(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const query = strings.join("?").replace(/\s+/g, " ").trim();
      statements.push(query);
      if (query.startsWith("SELECT")) return [{...state}];
      if (query.startsWith("UPDATE")) {
        state.payment_plan_hash = values[0] as string;
        state.payment_plan_xdr = values[1] as string;
        state.payment_plan_prepared_at = new Date();
        return [{...state}];
      }
      throw Error(query);
    }),
  }) as unknown as DatabaseClient;
  let fetchCalls = 0;
  const fetchMock = (async () => {
    fetchCalls++;
    return Response.json({account_id: owner, sequence: "12000000"});
  }) as typeof fetch;
  const input = {orderId, ownerPublicKey: owner};
  const first = await prepareMainnetOrderPayment(sql, input, fetchMock);
  const second = await prepareMainnetOrderPayment(sql, input, fetchMock);
  assert.equal(first.xdr, second.xdr);
  assert.equal(first.expectedHash, second.expectedHash);
  assert.equal(fetchCalls, 1);
  assert.equal(statements.filter(s => s.startsWith("UPDATE")).length, 1);
  assert.match(statements[0]!, /FOR UPDATE/);
});

test("a previously reserved attempt never generates a replacement after its safe handoff window", async () => {
  const state = {...record, payment_plan_hash: "f".repeat(64), payment_plan_xdr: "unsigned", payment_plan_prepared_at: new Date(Date.now() - 5 * 60_000)};
  const sql = Object.assign(async () => [], {
    begin: async (action: (tx: unknown) => Promise<unknown>) => action(async (strings: TemplateStringsArray) => {
      assert.match(strings.join("?"), /FOR UPDATE/);
      return [state];
    }),
  }) as unknown as DatabaseClient;
  await assert.rejects(prepareMainnetOrderPayment(sql, {orderId, ownerPublicKey: owner}, (async () => {
    throw Error("must not refetch source sequence");
  }) as typeof fetch), (error: unknown) => error instanceof MainnetOrderError && error.code === "payment_attempt_requires_reconciliation");
});
