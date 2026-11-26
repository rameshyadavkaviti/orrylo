/**
 * Stellar Classic Network Hunter v3 — strictly READ ONLY and paper only.
 * Uses Horizon native->native strict-send path discovery. A candidate is a quote,
 * never an executed transaction; no signing, wallet secrets, submit, or orders.
 * Self-routes depend on Horizon provider support and must be integration-tested.
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

export const HORIZON = 'https://horizon.stellar.org';
export const APPROVED = Object.freeze(new Set([
  'native',
  'USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
  'VELO:GDM4RQUQQUVSKQA7S6EM7XBZP3FCGH4Q7CL6TABQ7B2BEJ5ERARM2M5M'
]));
export const DEFAULTS = Object.freeze({
  capitalXlm: 700, reserveXlm: 595, sizesXlm: Object.freeze([2, 5, 10.5]),
  maxTradeXlm: 10.5, dailyLossCapXlm: 3.5, minNetXlm: 0.03, minNetBps: 70,
  executionHaircutBps: 100, maxFeeXlm: 0.03, failureReserveXlm: 0.01,
  maxQuoteLagLedgers: 2, maxLedgerAgeMs: 25000,
  maxQuoteWindowMs: 8000, maxHourSamplePages: 1,
  pollMs: 30000, allowUnknownResearch: true, requireDistinctAssets: true
});

const validNum = n => Number.isFinite(n) && n >= 0;
const finitePositive = n => Number.isFinite(Number(n)) && Number(n) > 0;
const fix7 = amount => Math.floor((Number(amount) + Number.EPSILON) * 1e7) / 1e7;
function amount7(x) {
  if (!finitePositive(x)) throw new Error('INVALID_AMOUNT');
  return fix7(x).toFixed(7);
}
export function assetKey(asset) {
  if (asset?.asset_type === 'native') return 'native';
  if (!['credit_alphanum4','credit_alphanum12'].includes(asset?.asset_type)) return null;
  if (!/^[A-Z0-9]{1,12}$/.test(asset.asset_code || '') || !/^G[A-Z2-7]{55}$/.test(asset.asset_issuer || '')) return null;
  return asset.asset_code + ':' + asset.asset_issuer;
}
function recordAssetKey(record, prefix) {
  return assetKey({asset_type: record?.[prefix+'_asset_type'],asset_code:record?.[prefix+'_asset_code'],asset_issuer:record?.[prefix+'_asset_issuer']});
}
export function riskConfig(config = DEFAULTS, balanceXlm = config.capitalXlm) {
  const vals = [config.capitalXlm,config.reserveXlm,config.maxTradeXlm,config.dailyLossCapXlm,config.minNetXlm,config.minNetBps,
    config.executionHaircutBps,config.maxFeeXlm,config.failureReserveXlm,config.maxLedgerAgeMs,config.maxQuoteWindowMs];
  if (!vals.every(validNum) || !validNum(balanceXlm)) throw new Error('INVALID_RISK_NUMBERS');
  if (config.capitalXlm < 1 || config.reserveXlm >= config.capitalXlm || config.maxTradeXlm <= 0 ||
      config.dailyLossCapXlm <= 0 || config.executionHaircutBps > 5000 || !Array.isArray(config.sizesXlm) || config.sizesXlm.length > 10) throw new Error('INVALID_RISK_CONFIG');
  const available = Math.min(config.capitalXlm, balanceXlm) - config.reserveXlm - config.maxFeeXlm;
  const ceiling = Math.min(config.maxTradeXlm, Number(available.toFixed(7)));
  const sizes = [...new Set(config.sizesXlm.map(Number))].filter(x=>Number.isFinite(x) && x >= 1 && x <= ceiling).sort((a,b)=>a-b);
  if (!sizes.length) throw new Error('INSUFFICIENT_PAPER_BUDGET');
  return sizes;
}
function checkPaperState(state, now, cfg) {
  if (!validNum(state?.balanceXlm) || !validNum(state?.lossXlm) ||
      state.dateUtc !== new Date(now).toISOString().slice(0, 10)) {
    throw new Error('INVALID_OR_STALE_PAPER_STATE');
  }
  if (state.lossXlm >= cfg.dailyLossCapXlm) throw new Error('PAPER_DAILY_LOSS_CAP_REACHED');
}

export function netEstimate(input, output, cfg = DEFAULTS) {
  if (!finitePositive(input) || !validNum(Number(output))) throw new Error('INVALID_NET_INPUT');
  const uncertainty = input * cfg.executionHaircutBps / 10000;
  const cost = uncertainty + cfg.maxFeeXlm + cfg.failureReserveXlm;
  const net = fix7(output - input - cost);
  const netBps = net / input * 10000;
  return { grossXlm: fix7(output - input), conservativeNetXlm: net, conservativeNetBps: netBps,
    assumedCostsXlm: cost, eligible: net >= cfg.minNetXlm && netBps >= cfg.minNetBps };
}
export async function request(path, fetcher = fetch, origin = HORIZON, requireLedger = true) {
  if (!path.startsWith('/')) throw new Error('INVALID_PATH');
  const response = await fetcher(origin + path, {headers:{Accept:'application/json'}, signal:AbortSignal.timeout(9000)});
  if (!response.ok) throw new Error('HORIZON_HTTP_'+response.status);
  const ledgerText = response.headers.get('latest-ledger') ?? response.headers.get('x-last-ledger');
  // Per official Horizon consistency docs, the canonical header is Latest-Ledger.
  const ledger = ledgerText !== null && /^\d+$/.test(ledgerText) ? Number(ledgerText) : null;
  if ((requireLedger || ledgerText !== null) && (!Number.isSafeInteger(ledger) || ledger <= 0)) {
    throw new Error('MISSING_LATEST_LEDGER');
  }
  return { body: await response.json(), ledger };
}
export async function networkLedger(fetcher=fetch, now=Date.now(),cfg=DEFAULTS) {
  const {body,ledger} = await request('/ledgers?limit=1&order=desc',fetcher,HORIZON,false);
  const last = body?._embedded?.records?.[0];
  const sequence = Number(last?.sequence), closed=Date.parse(last?.closed_at);
  if (!Number.isSafeInteger(sequence)||sequence <= 0 || !Number.isFinite(closed)) throw new Error('INVALID_LEDGER');
  if (ledger !== null && Math.abs(sequence-ledger)>cfg.maxQuoteLagLedgers) throw new Error('INCONSISTENT_HORIZON_LEDGER');
  if (now-closed > cfg.maxLedgerAgeMs || closed-now > 3000) throw new Error('STALE_LEDGER');
  return { sequence, closedAt: last.closed_at };
}
export function parseCycle(record, sendXlm, approved=APPROVED, cfg=DEFAULTS) {
  if (recordAssetKey(record,'source') !== 'native' || recordAssetKey(record,'destination') !== 'native') return null;
  if (Number(record.source_amount) !== Number(amount7(sendXlm))) return null;
  if (!Array.isArray(record.path) || record.path.length<1 || record.path.length>5) return null;
  const path = record.path.map(assetKey);
  if(path.some(x=>!x)) return null;
  if (cfg.requireDistinctAssets && new Set(['native',...path]).size !== path.length+1) return null;
  const output = Number(record.destination_amount);
  if (!finitePositive(output) || output>sendXlm*1000) return null;
  const approvedPath=path.every(k=>approved.has(k));
  return { path:['native',...path,'native'], approvedPath, amountInXlm:sendXlm,quotedOutputXlm:fix7(output), ...netEstimate(sendXlm,output,cfg) };
}
export async function quoteCycles(size, fetcher=fetch, approved=APPROVED, cfg=DEFAULTS, nowFn=Date.now) {
  const started=nowFn();
  const qs=new URLSearchParams({source_asset_type:'native',source_amount:amount7(size),destination_assets:'native'});
  const {body,ledger}=await request('/paths/strict-send?'+qs,fetcher);
  if(nowFn()-started>cfg.maxQuoteWindowMs) throw new Error('QUOTE_WINDOW_EXCEEDED');
  const records=body?._embedded?.records;
  if(!Array.isArray(records)) throw new Error('INVALID_PATH_RESPONSE');
  const parsed=records.map(r=>parseCycle(r,size,approved,cfg)).filter(Boolean);
  const identityOnly = records.length > 0 && records.every(record =>
    recordAssetKey(record, 'source') === 'native' && recordAssetKey(record, 'destination') === 'native' &&
    Array.isArray(record.path) && record.path.length === 0);
  return {ledger,size,paths:parsed,identityOnly};
}
export function settleCandidates(quoteSet, ledger, cfg=DEFAULTS, paperEnabled=false) {
  const dedup = new Map();
  for(const quote of quoteSet){
    if (Math.abs(quote.ledger-ledger.sequence)>cfg.maxQuoteLagLedgers ||
        Math.abs((quote.ledgerMin ?? quote.ledger)-ledger.sequence)>cfg.maxQuoteLagLedgers) {
      throw new Error('STALE_QUOTE_LEDGER');
    }
    for(const candidate of quote.paths){
      const path=candidate.path.join('>');
      const eligibleStatus = paperEnabled ? 'PAPER_CANDIDATE' : 'PAPER_RISK_UNAVAILABLE';
      const status = !candidate.approvedPath ? 'UNVETTED_RESEARCH_ONLY'
        : !candidate.eligible ? 'BELOW_THRESHOLD' : eligibleStatus;
      const key=path+'|'+candidate.amountInXlm;
      if(!dedup.has(key)||dedup.get(key).conservativeNetXlm<candidate.conservativeNetXlm)
        dedup.set(key,{...candidate,status,quoteLedger:quote.ledger,path});
    }
  }
  return [...dedup.values()].sort((a,b)=>b.conservativeNetXlm-a.conservativeNetXlm);
}
export function parseTradeSample(body,limit=100) {
  const records=body?._embedded?.records;
  if(!Array.isArray(records)) throw new Error('INVALID_TRADE_RESPONSE');
  const symbols=new Map(),pairs=new Map();
  for(const t of records){
    const a=recordAssetKey(t,'base'),b=recordAssetKey(t,'counter');
    if(!a||!b||a===b)continue;
    symbols.set(a,(symbols.get(a)||0)+1);symbols.set(b,(symbols.get(b)||0)+1);
    const p=[a,b].sort().join(' / ');pairs.set(p,(pairs.get(p)||0)+1);
  }
  return {sampledTrades:records.length,activeAssets:symbols.size,activePairs:pairs.size,
    pairs:[...pairs].sort((a,b)=>b[1]-a[1]).slice(0,limit).map(([pair,count])=>({pair,count}))};
}
export async function sampleNetwork(fetcher=fetch) {
  const {body,ledger}=await request('/trades?limit=200&order=desc',fetcher);
  return {ledger,coverage:'RECENT_200_TRADES_ONLY_NOT_ALL_NETWORK',...parseTradeSample(body,12)};
}
export function journalLog(kind,data={}) {
  const message={ts:new Date().toISOString(),component:'orrylo-network-hunter',mode:'PAPER_ONLY',kind,...data};
  console.log(JSON.stringify(message));
}
export async function scanOnce(fetcher=fetch,cfg=DEFAULTS,nowFn=Date.now,paperState=null,quoteForSize=quoteCycles) {
  const startedAt = nowFn();
  if (paperState !== null) checkPaperState(paperState, startedAt, cfg);
  const sizes = riskConfig(cfg, paperState?.balanceXlm);
  const before=await networkLedger(fetcher,startedAt,cfg);
  const quotes = await Promise.all(sizes.map(size => quoteForSize(size, fetcher, APPROVED, cfg, nowFn)));
  const after=await networkLedger(fetcher,nowFn(),cfg);
  if(after.sequence-before.sequence>cfg.maxQuoteLagLedgers) throw new Error('SCAN_SPANS_TOO_MANY_LEDGERS');
  if (paperState !== null) checkPaperState(paperState, nowFn(), cfg);
  const candidates=settleCandidates(quotes,after,cfg,paperState !== null);
  return {ledger:after.sequence,sizesXlm:sizes,pathsFound:candidates.length,
    approvedCandidates:candidates.filter(c=>c.status==='PAPER_CANDIDATE').length,
    candidates:candidates.slice(0,40),coverage:'HORIZON_PATH_SEARCH_NOT_EXHAUSTIVE',
    ordersPlaced:0,realizedPnlXlm:null};
}
export async function runOne(fetcher=fetch,cfg=DEFAULTS,nowFn=Date.now) {
  const result=await scanOnce(fetcher,cfg,nowFn);
  journalLog('market_scan',{ledger:result.ledger,pathsFound:result.pathsFound,approvedCandidates:result.approvedCandidates,coverage:result.coverage});
  for(const c of result.candidates){
    if(c.status==='PAPER_RISK_UNAVAILABLE') journalLog('research_candidate',c);
  }
  return result;
}
async function main(){
  journalLog('started',{safety:'NO_SIGNING_NO_ORDERS',config:DEFAULTS,approvedAssetKeys:[...APPROVED]});
  const once=process.argv.includes('--once');
  do{
    try{
      await runOne();
      try{const sample=await sampleNetwork();journalLog('network_activity_sample',sample)}catch(e){journalLog('discovery_warning',{reason:String(e.message)})}
    }catch(e){journalLog('fail_closed',{reason:String(e.message)});if(once)process.exitCode=1;}
    if(!once)await sleep(DEFAULTS.pollMs);
  }while(!once);
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{journalLog('fatal',{reason:String(e.message)});process.exitCode=1});
