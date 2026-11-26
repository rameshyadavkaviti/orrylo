import { setTimeout as delay } from "node:timers/promises";

const HORIZON = "https://horizon.stellar.org";
const WATCH = [
  { code: "USDC", issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN" },
  { code: "VELO", issuer: "GDM4RQUQQUVSKQA7S6EM7XBZP3FCGH4Q7CL6TABQ7B2BEJ5ERARM2M5M" }
];
const PUBLIC_KEY = process.env.TREASURY_PUBLIC_KEY || "";
const MODE = "paper";
const INTERVAL_MS = 30_000;
const MAX_TRADE_XLM = 10;
const MIN_EDGE_BPS = 50; // 0.5% including uncertainty allowance
const COST_BUFFER_BPS = 60; // conservative execution/friction estimate
const MAX_QUOTE_AGE_MS = 20_000;

function log(kind, data = {}) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), component: "orrylo-arbitrage", mode: MODE, kind, ...data }));
}

async function getJSON(path) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);
  try {
    const response = await fetch(HORIZON + path, { signal: controller.signal, headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error("Horizon HTTP " + response.status);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function num(x) {
  const value = Number(x);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function bookDecision(book, quoteTime = Date.now()) {
  if (Date.now() - quoteTime > MAX_QUOTE_AGE_MS) return { status: "STALE" };
  const bid = book.bids?.[0], ask = book.asks?.[0];
  const bidPrice = num(bid?.price), askPrice = num(ask?.price);
  const bidQty = num(bid?.amount), askQty = num(ask?.amount);
  if (!bidPrice || !askPrice || !bidQty || !askQty) return { status: "NO_DEPTH" };
  // Base = token, counter = XLM. Buy base at ask then sell base at bid.
  const roundTripToken = Math.min(bidQty, askQty, MAX_TRADE_XLM / askPrice);
  const notionalXlm = roundTripToken * askPrice;
  const grossBps = (bidPrice / askPrice - 1) * 10000;
  const netBps = grossBps - COST_BUFFER_BPS;
  return {
    status: netBps >= MIN_EDGE_BPS && roundTripToken > 0 ? "PAPER_CANDIDATE" : "NO_TRADE",
    bidXlm: bidPrice, askXlm: askPrice, baseQuantity: roundTripToken,
    notionalXlm, grossBps, conservativeNetBps: netBps,
    maxTradeXlm: MAX_TRADE_XLM,
    note: "Best-level indicative depth only. No fills simulated and no profit claimed."
  };
}

async function scan(asset) {
  const p = new URLSearchParams({
    selling_asset_type: "credit_alphanum4",
    selling_asset_code: asset.code,
    selling_asset_issuer: asset.issuer,
    buying_asset_type: "native",
    limit: "20"
  });
  const time = Date.now();
  const data = await getJSON("/order_book?" + p);
  const decision = bookDecision(data, time);
  log("market_scan", { market: asset.code + "/XLM", issuer: asset.issuer, ...decision });
}

async function main() {
  // No signing keys are accessed or imported; never place this service in live trading mode.
  log("started", { markets: WATCH.map(x => x.code + "/XLM"), paperOnly: true, treasuryPublicConfigured: /^G[A-Z2-7]{55}$/.test(PUBLIC_KEY) });
  if (!/^G[A-Z2-7]{55}$/.test(PUBLIC_KEY)) {
    log("configuration_error", { message: "TREASURY_PUBLIC_KEY is missing or malformed" });
  }
  for (;;) {
    for (const asset of WATCH) {
      try { await scan(asset); }
      catch (err) { log("scan_error", { market: asset.code + "/XLM", error: String(err.message).slice(0, 180) }); }
    }
    await delay(INTERVAL_MS);
  }
}
if (process.env.NODE_ENV === "test") {
  exportPlaceholder();
} else {
  main().catch(err => { log("fatal", { error: String(err.message) }); process.exitCode = 1; });
}
function exportPlaceholder() {}
