import assert from "node:assert/strict";
import test from "node:test";
import { Account, Keypair } from "@stellar/stellar-sdk";

import { StellarTradeExecutor } from "../src/runtime/trade-execution.js";

const issuer = "GDG7SGYLJQBLSN55ASHD7VCXYBEPYDK4EUIUTW6XWTBUDUHXK6ORRYLO";

function server(
  wallet: Keypair,
  submitted: Array<{ operations: Array<Record<string, unknown>> }>,
  openOffers: unknown[] = [],
) {
  return {
    loadAccount: async () => Object.assign(new Account(wallet.publicKey(), "1"), {
      balances: [
        { asset_type: "native", balance: "300.0000000", selling_liabilities: "0.0000000" },
        { asset_type: "credit_alphanum4", asset_code: "RYLO", asset_issuer: issuer, balance: "2.0000000", selling_liabilities: "0.0000000" },
      ],
      subentry_count: 1,
    }),
    fetchBaseFee: async () => 100,
    offers: () => ({ forAccount: () => ({ limit: () => ({ call: async () => ({ records: openOffers }) }) }) }),
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

test("daily commitment history does not block a new buy request", async () => {
  const wallet = Keypair.random();
  const submitted: Array<{ operations: Array<Record<string, unknown>> }> = [];
  const executor = new StellarTradeExecutor({
    server: server(wallet, submitted), ryloCode: "RYLO", ryloIssuer: issuer,
    maxTradeXlm: 0.1, dailyCapXlm: 0.5, minFreeXlm: 2, maxBuyPriceXlm: 0.1, maxOpenOffers: 3,
  });
  const result = await executor.execute({
    action: "buy", publicKey: wallet.publicKey(), bestAskXlm: 0.1, bestBidXlm: null,
    referencePriceXlm: 0.1, confidence: 0.5, urgency: 0.2, dailyCommittedXlm: 999,
  }, wallet);
  assert.equal(result.status, "submitted");
  assert.equal(submitted.length, 1);
});

test("existing open offers do not block a new buy request", async () => {
  const wallet = Keypair.random();
  const submitted: Array<{ operations: Array<Record<string, unknown>> }> = [];
  const executor = new StellarTradeExecutor({
    server: server(wallet, submitted, [{ id: "1" }, { id: "2" }, { id: "3" }, { id: "4" }]),
    ryloCode: "RYLO", ryloIssuer: issuer,
    maxTradeXlm: 0.1, dailyCapXlm: 0.5, minFreeXlm: 2, maxBuyPriceXlm: 0.1, maxOpenOffers: 3,
  });
  const result = await executor.execute({
    action: "buy", publicKey: wallet.publicKey(), bestAskXlm: 0.1, bestBidXlm: null,
    referencePriceXlm: 0.1, confidence: 0.5, urgency: 0.2, dailyCommittedXlm: 0,
  }, wallet);
  assert.equal(result.status, "submitted");
  assert.equal(submitted.length, 1);
});


test("RYLO/XLM open-offer cap prevents unbounded new offers", async () => {
  const wallet = Keypair.random();
  const submitted: Array<{ operations: Array<Record<string, unknown>> }> = [];
  const buy = { asset_type: "credit_alphanum4", asset_code: "RYLO", asset_issuer: issuer };
  const native = { asset_type: "native" };
  const open = [1, 2, 3].map((id) => ({ id: String(id), selling: native, buying: buy, price: "1" }));
  const executor = new StellarTradeExecutor({
    server: server(wallet, submitted, open), ryloCode: "RYLO", ryloIssuer: issuer,
    maxTradeXlm: 0.1, dailyCapXlm: 0.5, minFreeXlm: 2, maxBuyPriceXlm: 0.1, maxOpenOffers: 3,
  });
  const result = await executor.execute({
    action: "buy", publicKey: wallet.publicKey(), bestAskXlm: 0.1, bestBidXlm: null,
    referencePriceXlm: 0.1, confidence: 0.5, urgency: 0.2, dailyCommittedXlm: 0,
  }, wallet);
  assert.deepEqual(result, { status: "blocked", reason: "OPEN_OFFER_CAP" });
  assert.equal(submitted.length, 0);
});

test("maintenance cancels only stale RYLO/XLM offers and never unrelated assets", async () => {
  const wallet = Keypair.random();
  const submitted: Array<{ operations: Array<Record<string, unknown>> }> = [];
  const native = { asset_type: "native" };
  const rylo = { asset_type: "credit_alphanum4", asset_code: "RYLO", asset_issuer: issuer };
  const old = "2026-11-22T08:00:00Z", fresh = "2026-11-24T08:59:00Z";
  const offers = [
    { id: "11", selling: native, buying: rylo, price: "1", last_modified_time: old },
    { id: "12", selling: rylo, buying: native, price: "1", last_modified_time: old },
    { id: "13", selling: native, buying: { ...rylo, asset_code: "USDC" }, price: "1", last_modified_time: old },
    { id: "14", selling: native, buying: rylo, price: "1", last_modified_time: fresh },
  ];
  const executor = new StellarTradeExecutor({
    server: server(wallet, submitted, offers), ryloCode: "RYLO", ryloIssuer: issuer,
    maxTradeXlm: 0.1, dailyCapXlm: 0.5, minFreeXlm: 2, maxBuyPriceXlm: 0.1, maxOpenOffers: 3,
  });
  const result = await executor.maintain(wallet.publicKey(), wallet, Date.parse("2026-11-24T09:00:00Z"));
  assert.equal(result.status, "submitted");
  assert.equal(result.removed, 2);
  assert.equal(submitted.length, 1);
  assert.deepEqual(submitted[0]!.operations.map(o => String(o.offerId)).sort(), ["11","12"]);
  assert.ok(submitted[0]!.operations.every(o => o.type === "manageSellOffer" && Number(o.amount) === 0));
});

test("maintenance leaves fresh and undated offers unchanged", async () => {
  const wallet = Keypair.random();
  const submitted: Array<{ operations: Array<Record<string, unknown>> }> = [];
  const rylo = { asset_type: "credit_alphanum4", asset_code: "RYLO", asset_issuer: issuer };
  const offers = [
    { id: "1", selling: { asset_type: "native" }, buying: rylo, price: "1", last_modified_time: "2026-11-24T08:59:00Z" },
    { id: "2", selling: { asset_type: "native" }, buying: rylo, price: "1" },
  ];
  const executor = new StellarTradeExecutor({
    server: server(wallet, submitted, offers), ryloCode: "RYLO", ryloIssuer: issuer,
    maxTradeXlm: 0.1, dailyCapXlm: 0.5, minFreeXlm: 2, maxBuyPriceXlm: 0.1, maxOpenOffers: 3,
  });
  const result = await executor.maintain(wallet.publicKey(), wallet, Date.parse("2026-11-24T09:00:00Z"));
  assert.deepEqual(result, { status: "noop", removed: 0 });
  assert.equal(submitted.length, 0);
});
