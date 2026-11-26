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


test("different learned valuation and risk tolerance produce different genuine sell asks", async () => {
  const wallet = Keypair.random();
  async function quote(learnedPriceAnchorXlm: number, riskTolerance: number, urgency: number) {
    const submitted: Array<{operations:Array<Record<string,unknown>>}> = [];
    const executor = new StellarTradeExecutor({
      server: server(wallet, submitted), ryloCode: "RYLO", ryloIssuer: issuer,
      maxTradeXlm: 0.1, dailyCapXlm: 0.5, minFreeXlm: 2, maxBuyPriceXlm: 0.1, maxOpenOffers: 8,
    });
    const result=await executor.execute({
      action:"sell",publicKey:wallet.publicKey(),bestAskXlm:0.1,bestBidXlm:0.09,
      referencePriceXlm:0.1,learnedPriceAnchorXlm,riskTolerance,
      confidence:0.6,urgency,dailyCommittedXlm:0,
    },wallet);
    assert.equal(result.status,"submitted");
    return result.status==="submitted" ? result.priceXlm : NaN;
  }
  const patientSeller=await quote(0.12,0.15,0.1);
  const liquiditySeller=await quote(0.09,0.95,1);
  assert.ok(patientSeller > 0.1, "Patient valuation supports an ask above the 0.1 reference");
  assert.ok(liquiditySeller < 0.1, "Liquidity pressure can justify accepting below reference");
  assert.ok(patientSeller > liquiditySeller, "No centrally imposed uniform sell level");
});

test("agent valuation can support bids above 0.1 only if authorized cap and non-crossing book permit", async () => {
  const wallet=Keypair.random();
  const submitted: Array<{operations:Array<Record<string,unknown>>}> = [];
  const executor=new StellarTradeExecutor({
    server:server(wallet,submitted),ryloCode:"RYLO",ryloIssuer:issuer,
    maxTradeXlm:2.25,minOrderXlm:2,dailyCapXlm:2.25,minFreeXlm:2,maxBuyPriceXlm:0.15,maxOpenOffers:8,
  });
  const result=await executor.execute({
    action:"buy",publicKey:wallet.publicKey(),bestAskXlm:0.14,bestBidXlm:0.1,
    referencePriceXlm:0.1,learnedPriceAnchorXlm:0.12,riskTolerance:0.9,
    confidence:0.85,urgency:0.5,dailyCommittedXlm:0,
  },wallet);
  assert.equal(result.status,"submitted");
  if(result.status==="submitted") {
    assert.ok(result.priceXlm>0.1 && result.priceXlm<0.14);
    assert.ok(result.maxXlm>=2 && result.maxXlm<=2.25);
  }
});

test("same aggressive valuation cannot evade 0.1 buy cap or cross a 0.1 ask", async () => {
  const wallet=Keypair.random();
  const submitted: Array<{operations:Array<Record<string,unknown>>}> = [];
  const executor=new StellarTradeExecutor({
    server:server(wallet,submitted),ryloCode:"RYLO",ryloIssuer:issuer,
    maxTradeXlm:2.25,minOrderXlm:2,dailyCapXlm:2.25,minFreeXlm:2,maxBuyPriceXlm:0.1,maxOpenOffers:8,
  });
  const result=await executor.execute({
    action:"buy",publicKey:wallet.publicKey(),bestAskXlm:0.1,bestBidXlm:0.09,
    referencePriceXlm:0.1,learnedPriceAnchorXlm:0.14,riskTolerance:1,
    confidence:1,urgency:1,dailyCommittedXlm:0,
  },wallet);
  assert.equal(result.status,"submitted");
  if(result.status==="submitted") assert.ok(result.priceXlm<0.1);
});


test("independent conviction and patience generate distinct bids inside the same live spread",async()=>{
  const wallet=Keypair.random();
  async function bid(optimism:number,patience:number,riskTolerance:number,trend:number) {
    const submitted:Array<{operations:Array<Record<string,unknown>>}>=[];
    const executor=new StellarTradeExecutor({
      server:server(wallet,submitted),ryloCode:"RYLO",ryloIssuer:issuer,
      maxTradeXlm:2.25,minOrderXlm:2,dailyCapXlm:2.25,
      minFreeXlm:2,maxBuyPriceXlm:0.1,maxOpenOffers:8,
    });
    const result=await executor.execute({
      action:"buy",publicKey:wallet.publicKey(),bestBidXlm:0.09,bestAskXlm:0.1,
      referencePriceXlm:0.1,learnedPriceAnchorXlm:0.1,
      riskTolerance,optimism,patience,scarcityExpectation:0.7,marketPriceChange:trend,
      confidence:0.8,urgency:0.5,dailyCommittedXlm:0,
    },wallet);
    assert.equal(result.status,"submitted");
    assert.equal(submitted.length,1);
    if(result.status!=="submitted")return NaN;
    assert.ok(result.maxXlm>=2 && result.maxXlm<=2.25);
    assert.ok(result.priceXlm<0.1,"No matching against an ask at 0.1");
    return result.priceXlm;
  }
  const optimistic=await bid(0.9,0.1,0.85,0.08);
  const cautious=await bid(0.1,0.95,0.1,-0.1);
  assert.ok(optimistic>0.09,"Bullish buy can outbid the existing best bid");
  assert.ok(optimistic>cautious+0.001,"Preferences should yield a material quote difference, not a one-tick cluster");
  assert.ok(cautious>0,"A cautious bid remains possible");
});

test("strong conviction permits a higher bid when the market ask is higher, without taking related liquidity",async()=>{
  const wallet=Keypair.random();
  const submitted:Array<{operations:Array<Record<string,unknown>>}>=[];
  const executor=new StellarTradeExecutor({
    server:server(wallet,submitted),ryloCode:"RYLO",ryloIssuer:issuer,
    maxTradeXlm:2.25,minOrderXlm:2,dailyCapXlm:2.25,
    minFreeXlm:2,maxBuyPriceXlm:0.15,maxOpenOffers:8,
  });
  const result=await executor.execute({
    action:"buy",publicKey:wallet.publicKey(),bestBidXlm:0.1,bestAskXlm:0.15,
    referencePriceXlm:0.1,learnedPriceAnchorXlm:0.14,
    riskTolerance:0.9,optimism:0.95,patience:0.1,scarcityExpectation:0.95,
    marketPriceChange:0.1,confidence:0.95,urgency:0.8,dailyCommittedXlm:0,
  },wallet);
  assert.equal(result.status,"submitted");
  if(result.status!=="submitted")return;
  assert.ok(result.priceXlm>0.11,"Personal valuation may justify quoting above the former market bid");
  assert.ok(result.priceXlm<0.15,"Automatic controlled-account matches remain prohibited");
  assert.ok(result.maxXlm<=2.25,"Strong conviction never overrides authorized capital limits");
});


test("without the 2-XLM floor, distinct agent budgets are derived from decisions and capital",async()=>{
  const wallet=Keypair.random();
  async function quote(input:{confidence:number;riskTolerance:number;optimism:number;patience:number;urgency:number}){
    const submitted:Array<{operations:Array<Record<string,unknown>>}>=[];
    const executor=new StellarTradeExecutor({
      server:server(wallet,submitted),ryloCode:"RYLO",ryloIssuer:issuer,
      maxTradeXlm:2.25,minOrderXlm:0,dailyCapXlm:2.25,
      minFreeXlm:2,maxBuyPriceXlm:0.1,maxOpenOffers:8,
    });
    const result=await executor.execute({
      action:"buy",publicKey:wallet.publicKey(),
      bestBidXlm:0.09,bestAskXlm:0.1,referencePriceXlm:0.1,
      learnedPriceAnchorXlm:0.1,marketPriceChange:0,
      scarcityExpectation:0.6,dailyCommittedXlm:0,...input,
    },wallet);
    assert.equal(result.status,"submitted");
    assert.equal(submitted.length,1);
    return result.status==="submitted"?result.maxXlm:NaN;
  }
  const cautious=await quote({confidence:0.2,riskTolerance:0.1,optimism:0.2,patience:0.95,urgency:0.1});
  const confident=await quote({confidence:0.9,riskTolerance:0.95,optimism:0.9,patience:0.1,urgency:0.8});
  assert.ok(cautious>0 && cautious<2, "Smaller economically meaningful funded bids are allowed");
  assert.ok(confident>cautious+0.5,"Independent conviction and risk lead to materially different allocations");
  assert.ok(confident<=2.25,"Hard per-order maximum still applies");
});

test("zero minimum also permits smaller RYLO sell offers without forcing two XLM",async()=>{
  const wallet=Keypair.random();
  const submitted:Array<{operations:Array<Record<string,unknown>>}>=[];
  const executor=new StellarTradeExecutor({
    server:server(wallet,submitted),ryloCode:"RYLO",ryloIssuer:issuer,
    maxTradeXlm:2.25,minOrderXlm:0,dailyCapXlm:2.25,minFreeXlm:2,
    maxBuyPriceXlm:0.1,maxOpenOffers:8,
  });
  const result=await executor.execute({
    action:"sell",publicKey:wallet.publicKey(),bestBidXlm:0.09,bestAskXlm:0.1,
    referencePriceXlm:0.1,confidence:0.5,urgency:0.3,
    riskTolerance:0.5,optimism:0.5,patience:0.5,dailyCommittedXlm:0,
  },wallet);
  assert.equal(result.status,"submitted");
  if(result.status==="submitted")assert.ok(result.maxXlm>0 && result.maxXlm<2);
});

test("small remaining capital never bypasses the zero-free-reserve guard",async()=>{
  const wallet=Keypair.random();
  const submitted:Array<{operations:Array<Record<string,unknown>>}>=[];
  const executor=new StellarTradeExecutor({
    server:server(wallet,submitted),ryloCode:"RYLO",ryloIssuer:issuer,
    maxTradeXlm:0.00001,minOrderXlm:0,dailyCapXlm:0.5,
    minFreeXlm:2,maxBuyPriceXlm:0.1,maxOpenOffers:8,
  });
  const result=await executor.execute({
    action:"buy",publicKey:wallet.publicKey(),bestBidXlm:0.09,bestAskXlm:0.1,
    referencePriceXlm:0.1,confidence:0.5,urgency:0.2,dailyCommittedXlm:0,
  },wallet);
  assert.deepEqual(result,{status:"blocked",reason:"DUST_ORDER"});
  assert.equal(submitted.length,0);
});


test("sell execution uses RYLO holdings even if discretionary free XLM is below 2", async () => {
  const wallet = Keypair.random();
  const submitted: Array<{ operations: Array<Record<string, unknown>> }> = [];
  const fixture = server(wallet, submitted);
  const serverWithSmallNativeBalance = {
    ...fixture,
    loadAccount: async () => {
      const account = await fixture.loadAccount();
      account.balances[0]!.balance = "2.1000000";
      return account;
    },
  };
  const executor = new StellarTradeExecutor({
    server: serverWithSmallNativeBalance,
    ryloCode: "RYLO", ryloIssuer: issuer, maxTradeXlm: 2.25,
    minOrderXlm: 0, dailyCapXlm: 2.25, minFreeXlm: 2,
    maxBuyPriceXlm: 0.1, maxOpenOffers: 8,
  });
  const intent = {
    publicKey: wallet.publicKey(), bestBidXlm: 0.0054, bestAskXlm: 0.0055,
    referencePriceXlm: 0.1, learnedPriceAnchorXlm: 0.1,
    confidence: 0.6, urgency: 0.3, riskTolerance: 0.5,
    optimism: 0.5, patience: 0.6, dailyCommittedXlm: 0,
  };
  const result = await executor.execute({ ...intent, action: "sell" }, wallet);
  assert.equal(result.status, "submitted");
  if (result.status === "submitted") {
    assert.ok(result.priceXlm < 0.02, "Outdated 0.1 reference should not blindly dominate the current market");
    assert.ok(result.amountRylo > 0 && result.amountRylo <= 2);
  }
  assert.equal(submitted.length, 1);
  const buyer = await executor.execute({ ...intent, action: "buy" }, wallet);
  assert.deepEqual(buyer, { status: "blocked", reason: "FREE_RESERVE" });
});

test("sell cannot create an offer if network subentry reserve and fee are unavailable", async () => {
  const wallet = Keypair.random();
  const submitted: Array<{ operations: Array<Record<string, unknown>> }> = [];
  const fixture = server(wallet, submitted);
  const low = {
    ...fixture,
    loadAccount: async () => {
      const account = await fixture.loadAccount();
      account.balances[0]!.balance = "1.6000000";
      return account;
    },
  };
  const executor = new StellarTradeExecutor({
    server: low, ryloCode: "RYLO", ryloIssuer: issuer,
    maxTradeXlm: 2.25, minOrderXlm: 0, dailyCapXlm: 2.25,
    minFreeXlm: 2, maxBuyPriceXlm: 0.1, maxOpenOffers: 8,
  });
  const result = await executor.execute({
    action: "sell", publicKey: wallet.publicKey(),
    bestBidXlm: 0.0054, bestAskXlm: 0.0055,
    referencePriceXlm: 0.1, confidence: 0.6, urgency: 0.3,
    dailyCommittedXlm: 0,
  }, wallet);
  assert.deepEqual(result, { status: "blocked", reason: "FEE_RESERVE" });
  assert.equal(submitted.length, 0);
});

test("confirmed market regime change retires aged far-off BUY offers, not patient high SELL asks", async () => {
  const wallet = Keypair.random();
  const submitted: Array<{ operations: Array<Record<string, unknown>> }> = [];
  const native = { asset_type: "native" };
  const rylo = { asset_type: "credit_alphanum4", asset_code: "RYLO", asset_issuer: issuer };
  const old = "2026-11-25T08:00:00Z";
  const fresh = "2026-11-26T12:59:00Z";
  const offers = [
    { id: "11", selling: native, buying: rylo, price: "11.1111111", last_modified_time: old },
    { id: "12", selling: rylo, buying: native, price: "0.0900000", last_modified_time: old },
    { id: "13", selling: native, buying: rylo, price: "184.5000000", last_modified_time: old },
    { id: "14", selling: native, buying: rylo, price: "11.1111111", last_modified_time: fresh },
    { id: "15", selling: native,
      buying: { ...rylo, asset_code: "USDC" }, price: "11.1111111", last_modified_time: old },
  ];
  const executor = new StellarTradeExecutor({
    server: server(wallet, submitted, offers), ryloCode: "RYLO", ryloIssuer: issuer,
    maxTradeXlm: 0.1, minOrderXlm: 0, dailyCapXlm: 0.1,
    minFreeXlm: 2, maxBuyPriceXlm: 0.1, maxOpenOffers: 8,
  });
  const result = await executor.maintain(wallet.publicKey(), wallet,
    Date.parse("2026-11-26T13:00:00Z"),
    { bestBidXlm: 0.0054, bestAskXlm: 0.0055 });
  assert.equal(result.status, "submitted");
  assert.equal(result.removed, 1);
  assert.deepEqual(submitted[0]!.operations.map((op) => String(op.offerId)), ["11"]);
  assert.equal(Number(submitted[0]!.operations[0]!.amount), 0);
});

test("unconfirmed market change does not automatically expire standing offers below cap", async () => {
  const wallet = Keypair.random();
  const submitted: Array<{ operations: Array<Record<string, unknown>> }> = [];
  const offers = [{
    id: "11", selling: { asset_type: "native" },
    buying: { asset_type: "credit_alphanum4", asset_code: "RYLO", asset_issuer: issuer },
    price: "11.1111111", last_modified_time: "2026-11-25T08:00:00Z",
  }];
  const executor = new StellarTradeExecutor({
    server: server(wallet, submitted, offers), ryloCode: "RYLO", ryloIssuer: issuer,
    maxTradeXlm: 0.1, minOrderXlm: 0, dailyCapXlm: 0.1,
    minFreeXlm: 2, maxBuyPriceXlm: 0.1, maxOpenOffers: 8,
  });
  assert.deepEqual(await executor.maintain(wallet.publicKey(), wallet,
    Date.parse("2026-11-26T13:00:00Z")), { status: "noop", removed: 0 });
  assert.equal(submitted.length, 0);
});


test("wide spreads do not freeze removal of aged, obsolete RYLO BUY liabilities", async () => {
  const wallet = Keypair.random();
  const submitted: Array<{ operations: Array<Record<string, unknown>> }> = [];
  const offers = [
    { id: "91", selling: { asset_type: "native" },
      buying: { asset_type: "credit_alphanum4", asset_code: "RYLO", asset_issuer: issuer },
      price: "11.1111111", last_modified_time: "2026-11-25T08:00:00Z" },
    { id: "92", selling: { asset_type: "credit_alphanum4", asset_code: "RYLO", asset_issuer: issuer },
      buying: { asset_type: "native" },
      price: "0.0900000", last_modified_time: "2026-11-25T08:00:00Z" },
  ];
  const executor = new StellarTradeExecutor({
    server: server(wallet, submitted, offers), ryloCode: "RYLO", ryloIssuer: issuer,
    maxTradeXlm: 0.1, minOrderXlm: 0, dailyCapXlm: 0.1,
    minFreeXlm: 2, maxBuyPriceXlm: 0.1, maxOpenOffers: 8,
  });
  const result = await executor.maintain(wallet.publicKey(), wallet,
    Date.parse("2026-11-26T13:00:00Z"),
    { bestBidXlm: 0.00542, bestAskXlm: 0.0864503 });
  assert.equal(result.status, "submitted");
  assert.equal(result.removed, 1);
  assert.deepEqual(submitted[0]!.operations.map((op) => String(op.offerId)), ["91"]);
});
