import assert from "node:assert/strict";
import test from "node:test";
import { Account, Keypair } from "@stellar/stellar-sdk";

import { StellarTradeExecutor } from "../src/runtime/trade-execution.js";

const issuer = "GDG7SGYLJQBLSN55ASHD7VCXYBEPYDK4EUIUTW6XWTBUDUHXK6ORRYLO";

function server(wallet: Keypair, submitted: Array<{ operations: Array<Record<string, unknown>> }>) {
  return {
    loadAccount: async () => Object.assign(new Account(wallet.publicKey(), "1"), {
      balances: [
        { asset_type: "native", balance: "300.0000000", selling_liabilities: "0.0000000" },
        { asset_type: "credit_alphanum4", asset_code: "RYLO", asset_issuer: issuer, balance: "2.0000000", selling_liabilities: "0.0000000" },
      ],
      subentry_count: 1,
    }),
    fetchBaseFee: async () => 100,
    offers: () => ({ forAccount: () => ({ limit: () => ({ call: async () => ({ records: [] }) }) }) }),
    submitTransaction: async (transaction: unknown) => {
      submitted.push(transaction as { operations: Array<Record<string, unknown>> });
      return { hash: "c".repeat(64) };
    },
  };
}

test("buy execution creates a bounded non-crossing RYLO bid", async () => {
  const wallet = Keypair.random();
  const submitted: Array<{ operations: Array<Record<string, unknown>> }> = [];
  const executor = new StellarTradeExecutor({
    server: server(wallet, submitted), ryloCode: "RYLO", ryloIssuer: issuer,
    maxTradeXlm: 0.1, dailyCapXlm: 0.5, minFreeXlm: 2, maxBuyPriceXlm: 0.1, maxOpenOffers: 3,
  });
  const result = await executor.execute({
    action: "buy", publicKey: wallet.publicKey(), bestAskXlm: 0.1, bestBidXlm: null,
    referencePriceXlm: 0.1, confidence: 0.5, urgency: 0.2, dailyCommittedXlm: 0,
  }, wallet);
  assert.equal(result.status, "submitted");
  assert.equal(submitted[0]?.operations[0]?.type, "manageBuyOffer");
  assert.ok(Number(submitted[0]?.operations[0]?.price) < 0.1);
  assert.ok(Number(result.maxXlm) <= 0.1);
});

test("sell execution requires holdings and places an ask above the best bid", async () => {
  const wallet = Keypair.random();
  const submitted: Array<{ operations: Array<Record<string, unknown>> }> = [];
  const executor = new StellarTradeExecutor({
    server: server(wallet, submitted), ryloCode: "RYLO", ryloIssuer: issuer,
    maxTradeXlm: 0.1, dailyCapXlm: 0.5, minFreeXlm: 2, maxBuyPriceXlm: 0.1, maxOpenOffers: 3,
  });
  const result = await executor.execute({
    action: "sell", publicKey: wallet.publicKey(), bestAskXlm: 0.1, bestBidXlm: 0.09,
    referencePriceXlm: 0.1, confidence: 0.5, urgency: 0.2, dailyCommittedXlm: 0,
  }, wallet);
  assert.equal(result.status, "submitted");
  assert.equal(submitted[0]?.operations[0]?.type, "manageSellOffer");
  assert.ok(Number(submitted[0]?.operations[0]?.price) > 0.09);
  assert.ok(Number(submitted[0]?.operations[0]?.amount) <= 2);
});

test("daily cap blocks additional buy commitments", async () => {
  const wallet = Keypair.random();
  const submitted: Array<{ operations: Array<Record<string, unknown>> }> = [];
  const executor = new StellarTradeExecutor({
    server: server(wallet, submitted), ryloCode: "RYLO", ryloIssuer: issuer,
    maxTradeXlm: 0.1, dailyCapXlm: 0.5, minFreeXlm: 2, maxBuyPriceXlm: 0.1, maxOpenOffers: 3,
  });
  const result = await executor.execute({
    action: "buy", publicKey: wallet.publicKey(), bestAskXlm: 0.1, bestBidXlm: null,
    referencePriceXlm: 0.1, confidence: 0.5, urgency: 0.2, dailyCommittedXlm: 0.5,
  }, wallet);
  assert.deepEqual(result, { status: "blocked", reason: "DAILY_CAP" });
  assert.equal(submitted.length, 0);
});
