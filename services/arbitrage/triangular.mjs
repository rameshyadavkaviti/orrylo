import { setTimeout as sleep } from 'node:timers/promises';

const HORIZON = 'https://horizon.stellar.org';
export const ASSETS = Object.freeze({
  XLM: { type: 'native', key: 'native' },
  USDC: { type: 'credit_alphanum4', code: 'USDC', issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN', key: 'USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN' },
  VELO: { type: 'credit_alphanum4', code: 'VELO', issuer: 'GDM4RQUQQUVSKQA7S6EM7XBZP3FCGH4Q7CL6TABQ7B2BEJ5ERARM2M5M', key: 'VELO:GDM4RQUQQUVSKQA7S6EM7XBZP3FCGH4Q7CL6TABQ7B2BEJ5ERARM2M5M' }
});
export const ROUTES = [ ['XLM', 'USDC', 'VELO', 'XLM'], ['XLM', 'VELO', 'USDC', 'XLM'] ];
export const DEFAULTS = Object.freeze({ capital: 700, emergencyReserve: 500, trade: 10, frictionBps: 60, minNetBps: 50, feesXlm: 0.003, maxLedgerAgeMs: 30000, maxRoundTripMs: 16000, maxLedgerDrift: 2, intervalMs: 30000 });

const positive = x => Number.isFinite(Number(x)) && Number(x) > 0;
const down7 = x => Math.floor((x + Number.EPSILON) * 1e7) / 1e7;
function asAmount(x) { if (!positive(x)) throw Error('INVALID_AMOUNT'); return down7(Number(x)).toFixed(7); }
function validAsset(record, symbol, side) {
  const a = ASSETS[symbol];
  if (record[side + '_asset_type'] !== a.type) return false;
  return a.type === 'native' || (record[side + '_asset_code'] === a.code && record[side + '_asset_issuer'] === a.issuer);
}
export function evaluateRoundTrip(startXlm, endXlm, cfg = DEFAULTS) {
  if (!positive(startXlm) || !Number.isFinite(endXlm) || endXlm < 0) throw Error('INVALID_QUOTE');
  const cost = startXlm * cfg.frictionBps / 10000 + cfg.feesXlm;
  const estimatedPnlXlm = endXlm - startXlm - cost;
  const conservativeNetBps = estimatedPnlXlm / startXlm * 10000;
  return { estimatedPnlXlm, conservativeNetBps, costEstimateXlm: cost,
    eligible: conservativeNetBps >= cfg.minNetBps,
    confidence: 'INDICATIVE_ONLY_NOT_AN_EXECUTION_OR_PROFIT' };
}
export function paperBudget(cfg = DEFAULTS) {
  if (!(positive(cfg.capital) && cfg.emergencyReserve >= 0 && positive(cfg.trade) && cfg.capital >= cfg.emergencyReserve)) throw Error('INVALID_RISK_CONFIG');
  const maxNotional = Math.min(cfg.trade, cfg.capital - cfg.emergencyReserve);
  if (!(maxNotional >= 1)) throw Error('INSUFFICIENT_PAPER_BUDGET');
  return maxNotional;
}
export async function fetchHorizon(path, fetcher = fetch, base = HORIZON) {
  const response = await fetcher(base + path, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(9000) });
  if (!response.ok) throw Error('HORIZON_HTTP_' + response.status);
  const json = await response.json();
  const ledger = Number(response.headers.get('latest-ledger') ?? response.headers.get('x-last-ledger'));
  return { json, ledger: Number.isSafeInteger(ledger) && ledger > 0 ? ledger : null };
}
export async function latestLedger(fetcher = fetch, now = Date.now(), cfg = DEFAULTS) {
  const {json} = await fetchHorizon('/ledgers?limit=1&order=desc', fetcher);
  const record = json?._embedded?.records?.[0];
  const closed = Date.parse(record?.closed_at);
  if (!Number.isSafeInteger(Number(record?.sequence)) || !Number.isFinite(closed) || now - closed > cfg.maxLedgerAgeMs || closed - now > 3000) throw Error('STALE_LEDGER');
  return Number(record.sequence);
}
export async function quoteDirect(source, destination, amount, fetcher = fetch) {
  const from = ASSETS[source], to = ASSETS[destination];
  if (!from || !to || from === to) throw Error('INVALID_PAIR');
  const params = new URLSearchParams({ source_asset_type: from.type, source_amount: asAmount(amount), destination_assets: to.key });
  if (from.type !== 'native') { params.set('source_asset_code', from.code); params.set('source_asset_issuer', from.issuer); }
  const { json, ledger } = await fetchHorizon('/paths/strict-send?' + params, fetcher);
  if (!ledger) throw Error('QUOTE_MISSING_LEDGER_HEADER');
  const candidates = (json?._embedded?.records || []).filter(x => Array.isArray(x.path) && x.path.length === 0 && validAsset(x, source, 'source') && validAsset(x, destination, 'destination') && positive(x.destination_amount));
  if (!candidates.length) return { amount: null, ledger };
  const amountOut = Math.max(...candidates.map(x => Number(x.destination_amount)));
  return { amount: down7(amountOut), ledger };
}
export async function inspectRoute(route, startXlm, fetcher = fetch, cfg = DEFAULTS, nowFn = Date.now) {
  const startedAt = nowFn();
  let amount = startXlm; const ledgers = [];
  for (let i = 0; i < route.length - 1; i++) {
    const q = await quoteDirect(route[i], route[i+1], amount, fetcher);
    if (!positive(q.amount)) return { route: route.join('>'), status: 'NO_LIQUIDITY' };
    amount = q.amount; ledgers.push(q.ledger);
    if (nowFn() - startedAt > cfg.maxRoundTripMs) throw Error('QUOTE_WINDOW_EXCEEDED');
  }
  const drift = Math.max(...ledgers) - Math.min(...ledgers);
  if (drift > cfg.maxLedgerDrift) throw Error('QUOTE_LEDGER_DRIFT');
  const result = evaluateRoundTrip(startXlm, amount, cfg);
  return { route: route.join('>'), status: result.eligible ? 'PAPER_CANDIDATE' : 'NO_TRADE', inputXlm: startXlm, outputXlm: amount, quoteLedgerMin: Math.min(...ledgers), quoteLedgerMax: Math.max(...ledgers), ...result };
}

function emit(kind, data = {}) { console.log(JSON.stringify({ time: new Date().toISOString(), service: 'orrylo-arbitrage', mode: 'PAPER_ONLY', kind, ...data })); }
export async function scanOnce(fetcher = fetch, cfg = DEFAULTS, nowFn = Date.now) {
  const amount = paperBudget(cfg);
  const ledger = await latestLedger(fetcher, nowFn(), cfg);
  const results = [];
  for (const route of ROUTES) {
    try { results.push(await inspectRoute(route, amount, fetcher, cfg, nowFn)); }
    catch (e) { results.push({ route: route.join('>'), status: 'REJECTED', reason: String(e.message).slice(0,120) }); }
  }
  return { ledger, results };
}
async function main() {
  emit('started', { markets: ['XLM/USDC', 'XLM/VELO', 'USDC/VELO'], risk: DEFAULTS, signingCode: false });
  let lastLedger = 0;
  for (;;) {
    try {
      const out = await scanOnce();
      if (out.ledger !== lastLedger) {
        lastLedger = out.ledger;
        for (const row of out.results) emit('route_scan', { ledger: out.ledger, ...row });
      }
    } catch (e) { emit('fail_closed', { error: String(e.message).slice(0,150) }); }
    await sleep(DEFAULTS.intervalMs);
  }
}
if (process.argv[1] && import.meta.url === new URL('file://' + process.argv[1]).href) {
  main().catch(e => { emit('fatal', { error: String(e.message) }); process.exitCode = 1; });
}
