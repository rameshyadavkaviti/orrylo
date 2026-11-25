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

test("keeps eight standing bids indefinitely, regardless of age", async () => {
  const wallet = Keypair.random();
  const submitted: Array<{ operations: Array<Record<string, unknown>> }> = [];
  const rylo = { asset_type: "credit_alphanum4", asset_code: "RYLO", asset_issuer: issuer };
  const offers = Array.from({length: 8}, (_, i) => ({
    id: String(i + 1), selling: { asset_type: "native" }, buying: rylo,
    price: "0.09", last_modified_time: "2026-01-01T00:00:00Z",
  }));
  const executor = new StellarTradeExecutor({
    server: server(wallet, submitted, offers), ryloCode: "RYLO", ryloIssuer: issuer,
    maxTradeXlm: 0.1, dailyCapXlm: 0.5, minFreeXlm: 2, maxBuyPriceXlm: 0.1, maxOpenOffers: 8,
  });
  const result = await executor.maintain(wallet.publicKey(), wallet, Date.parse("2026-11-25T00:00:00Z"));
  assert.deepEqual(result, { status: "noop", removed: 0 });
  assert.equal(submitted.length, 0);
});

test("only trims the two oldest excess orders from ten RYLO/XLM offers", async () => {
  const wallet = Keypair.random();
  const submitted: Array<{ operations: Array<Record<string, unknown>> }> = [];
  const native = { asset_type: "native" };
  const rylo = { asset_type: "credit_alphanum4", asset_code: "RYLO", asset_issuer: issuer };
  const offers = [
    ...Array.from({length: 10}, (_, i) => ({
      id: String(i + 1), selling: native, buying: rylo, price: "0.09",
      last_modified_time: new Date(Date.parse("2026-11-24T00:00:00Z") + i * 60_000).toISOString(),
    })),
    { id: "13", selling: native, buying: { ...rylo, asset_code: "USDC" },
      price: "1", last_modified_time: "2026-01-01T00:00:00Z" },
  ];
  const executor = new StellarTradeExecutor({
    server: server(wallet, submitted, offers), ryloCode: "RYLO", ryloIssuer: issuer,
    maxTradeXlm: 0.1, dailyCapXlm: 0.5, minFreeXlm: 2, maxBuyPriceXlm: 0.1, maxOpenOffers: 8,
  });
  const result = await executor.maintain(wallet.publicKey(), wallet, Date.parse("2026-11-25T00:00:00Z"));
  assert.equal(result.status, "submitted");
  assert.equal(result.removed, 2);
  assert.equal(submitted.length, 1);
  assert.deepEqual(submitted[0]!.operations.map(o => String(o.offerId)).sort(), ["1","2"]);
  assert.ok(submitted[0]!.operations.every(o => o.type === "manageSellOffer" && Number(o.amount) === 0));
});

test("excess offers with missing timestamps are trimmed by oldest offer ID", async () => {
  const wallet = Keypair.random();
  const submitted: Array<{ operations: Array<Record<string, unknown>> }> = [];
  const native = { asset_type: "native" };
  const rylo = { asset_type: "credit_alphanum4", asset_code: "RYLO", asset_issuer: issuer };
  const offers = Array.from({length: 9}, (_, i) => ({
    id: String(i + 10), selling: native, buying: rylo, price: "0.09",
  }));
  const executor = new StellarTradeExecutor({
    server: server(wallet, submitted, offers), ryloCode: "RYLO", ryloIssuer: issuer,
    maxTradeXlm: 0.1, dailyCapXlm: 0.5, minFreeXlm: 2, maxBuyPriceXlm: 0.1, maxOpenOffers: 8,
  });
  const result = await executor.maintain(wallet.publicKey(), wallet, Date.parse("2026-11-25T00:00:00Z"));
  assert.equal(result.status, "submitted");
  assert.equal(result.removed, 1);
  assert.equal(String(submitted[0]!.operations[0]!.offerId), "10");
});

test("buy execution is permitted below eight RYLO offers but blocked at eight", async () => {
  const wallet = Keypair.random();
  const native = { asset_type: "native" };
  const rylo = { asset_type: "credit_alphanum4", asset_code: "RYLO", asset_issuer: issuer };
  for (const count of [7,8]) {
    const submitted: Array<{ operations: Array<Record<string, unknown>> }> = [];
    const offers = Array.from({length:count}, (_, i) => ({id:String(i+1), selling:native, buying:rylo}));
    const executor = new StellarTradeExecutor({
      server:server(wallet, submitted, offers), ryloCode:"RYLO", ryloIssuer:issuer,
      maxTradeXlm:0.1, dailyCapXlm:0.5, minFreeXlm:2, maxBuyPriceXlm:0.1, maxOpenOffers:8,
    });
    const result = await executor.execute({
      action:"buy", publicKey:wallet.publicKey(), bestAskXlm:0.1,bestBidXlm:null,
      referencePriceXlm:0.1,confidence:0.5,urgency:0.2,dailyCommittedXlm:0,
    },wallet);
    assert.equal(result.status,count===7?"submitted":"blocked");
    assert.equal(submitted.length,count===7?1:0);
  }
});


test("live minimum order creates a genuinely funded bid worth at least 2 XLM", async () => {
  const wallet = Keypair.random();
  const submitted: Array<{ operations: Array<Record<string, unknown>> }> = [];
  const executor = new StellarTradeExecutor({
    server: server(wallet,submitted),ryloCode:"RYLO",ryloIssuer:issuer,
    maxTradeXlm:2.25,minOrderXlm:2,dailyCapXlm:2.25,minFreeXlm:2,maxBuyPriceXlm:0.1,maxOpenOffers:8,
  });
  const result=await executor.execute({
    action:"buy",publicKey:wallet.publicKey(),bestAskXlm:0.1,bestBidXlm:null,
    referencePriceXlm:0.1,confidence:0.5,urgency:0.2,dailyCommittedXlm:0,
  },wallet);
  assert.equal(result.status,"submitted");
  if (result.status !== "submitted") return;
  assert.ok(result.maxXlm >= 2);
  assert.ok(result.maxXlm <= 2.25);
  assert.equal(submitted.length,1);
});

test("insufficient free XLM blocks sub-2-XLM offer instead of sending a tiny bid",async()=>{
  const wallet=Keypair.random();
  const submitted: Array<{ operations:Array<Record<string,unknown>> }>=[];
  const executor=new StellarTradeExecutor({
    server:server(wallet,submitted),ryloCode:"RYLO",ryloIssuer:issuer,
    maxTradeXlm:1.99,minOrderXlm:2,dailyCapXlm:2.25,minFreeXlm:2,maxBuyPriceXlm:0.1,maxOpenOffers:8,
  });
  const result=await executor.execute({
    action:"buy",publicKey:wallet.publicKey(),bestAskXlm:0.1,bestBidXlm:null,
    referencePriceXlm:0.1,confidence:0.5,urgency:0.2,dailyCommittedXlm:0,
  },wallet);
  assert.deepEqual(result,{status:"blocked",reason:"MIN_ORDER_NOTIONAL"});
  assert.equal(submitted.length,0);
});

test("sell cannot submit a below-minimum notional when RYLO holdings are small",async()=>{
  const wallet=Keypair.random();
  const submitted: Array<{ operations:Array<Record<string,unknown>> }>=[];
  const executor=new StellarTradeExecutor({
    server:server(wallet,submitted),ryloCode:"RYLO",ryloIssuer:issuer,
    maxTradeXlm:2.25,minOrderXlm:2,dailyCapXlm:2.25,minFreeXlm:2,maxBuyPriceXlm:0.1,maxOpenOffers:8,
  });
  const result=await executor.execute({
    action:"sell",publicKey:wallet.publicKey(),bestAskXlm:0.1,bestBidXlm:0.09,
    referencePriceXlm:0.1,confidence:0.5,urgency:0.2,dailyCommittedXlm:0,
  },wallet);
  assert.deepEqual(result,{status:"blocked",reason:"MIN_ORDER_NOTIONAL"});
  assert.equal(submitted.length,0);
});
