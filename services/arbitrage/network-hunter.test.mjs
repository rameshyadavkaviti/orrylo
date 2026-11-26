import test from 'node:test';
import assert from 'node:assert/strict';
import {
  APPROVED,DEFAULTS,assetKey,riskConfig,netEstimate,request,networkLedger,
  parseCycle,quoteCycles,settleCandidates,parseTradeSample,scanOnce
} from './network-hunter.mjs';
const STAMP = Date.parse('2026-11-27T12:00:05.000Z');
const closed = new Date(STAMP-5_000).toISOString();
const asset=(key)=>key==='native'?{asset_type:'native'}:(()=>{const [asset_code,asset_issuer]=key.split(':');return {asset_type:asset_code.length>4?'credit_alphanum12':'credit_alphanum4',asset_code,asset_issuer}})();
const rec=(path,size,output)=>({source_asset_type:'native',destination_asset_type:'native',source_amount:String(size),destination_amount:String(output),path:path.map(asset)});
const ok=(body,ledger=100)=>({ok:true,status:200,headers:{get:k=>k.toLowerCase()==='latest-ledger'?String(ledger):null},json:async()=>body});
const ledgerBody={_embedded:{records:[{sequence:100,closed_at:closed}]}};
const USDC=[...APPROVED].find(x=>x.startsWith('USDC:'));
const VELO=[...APPROVED].find(x=>x.startsWith('VELO:'));
const cfg={...DEFAULTS};

const paperState = { dateUtc: '2026-11-27', balanceXlm: 700, lossXlm: 0 };

test('risk budget applies the requested paper limits and filters oversized quotes', () => {
  assert.equal(DEFAULTS.capitalXlm, 700);
  assert.equal(DEFAULTS.reserveXlm, 595);
  assert.equal(DEFAULTS.maxTradeXlm, 10.5);
  assert.equal(DEFAULTS.dailyLossCapXlm, 3.5);
  assert.deepEqual(riskConfig({ ...cfg, sizesXlm: [2, 5, 10.5, 10.5000001] }), [2, 5, 10.5]);
  assert.throws(() => riskConfig({ ...cfg, reserveXlm: 701 }), /INVALID/);
  assert.throws(() => riskConfig({ ...cfg, dailyLossCapXlm: 0 }), /INVALID/);
});
test('net profit subtracts fee, failure reserve and haircut',()=>{
  assert.equal(netEstimate(10,10.1).eligible,false);
  assert.equal(netEstimate(10,10.35).eligible,true);
  assert.ok(netEstimate(5,5.15).conservativeNetXlm<.1);
});
test('same symbol but different issuer is excluded from approved execution set',()=>{
  const bad='USDC:GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  const item=parseCycle(rec([bad],5,6),5);
  assert.equal(item?.approvedPath,false); // exact issuer allowlist rejects lookalike assets
});
test('unknown but structurally valid issuer remains research only',()=>{
  const strange='G'+'A'.repeat(55);
  const item=parseCycle(rec(['ABC:'+strange],5,7),5);
  assert.equal(item?.approvedPath,false);
});
test('cyclical route needs intermediate asset and matching start/destination',()=>{
  assert.equal(parseCycle(rec([],5,100),5),null);
  assert.equal(parseCycle(rec([USDC],6,100),5),null);
  assert.equal(parseCycle({...rec([USDC],5,100),destination_asset_type:'credit_alphanum4'},5),null);
  assert.equal(parseCycle(rec([USDC,USDC],5,100),5),null);
});
test('canonical Horizon Latest-Ledger header is used',async()=>{
  const out=await request('/trades',async()=>ok({_embedded:{records:[]}},117));
  assert.equal(out.ledger,117);
});
test('missing ledger header rejects closed',async()=>{
  const f=async()=>({ok:true,headers:{get:()=>null},json:async()=>({})});
  await assert.rejects(()=>request('/trades',f),/MISSING_LATEST_LEDGER/);
});
test('latest ledger collection can use the validated record without a quote header', async () => {
  const noHeader = async () => ({ ...ok(ledgerBody), headers: { get: () => null } });
  assert.deepEqual(await networkLedger(noHeader, STAMP), { sequence: 100, closedAt: closed });
});

test('network stale ledger triggers stop',async()=>{
  const stale=async()=>ok({_embedded:{records:[{sequence:100,closed_at:'2020-01-01T00:00:00Z'}]}});
  await assert.rejects(()=>networkLedger(stale,STAMP),/STALE_LEDGER/);
});
test('strict-send returns authorized paper candidate without signing',async()=>{
  const mock=async url=>{assert.ok(url.includes('/paths/strict-send?'));return ok({_embedded:{records:[rec([USDC,VELO],5,5.27)]}})};
  const result=await quoteCycles(5,mock,APPROVED,cfg,()=>STAMP);
  assert.equal(result.paths.length,1);
  assert.equal(result.paths[0].approvedPath,true);
  assert.equal(result.paths[0].eligible,true);
  assert.equal(result.paths[0].path.join('>'),'native>'+USDC+'>'+VELO+'>native');
});
test('ledger drift must reject',()=>{
  assert.throws(()=>settleCandidates([{ledger:94,paths:[parseCycle(rec([USDC],5,5.9),5)]}],{sequence:100}),/STALE_QUOTE_LEDGER/);
});
test('dedupes routes and keeps best quote at same notional',()=>{
  const a=parseCycle(rec([USDC],5,5.2),5),b=parseCycle(rec([USDC],5,5.3),5);
  const rows=settleCandidates([{ledger:100,paths:[a,b]}],{sequence:100});
  assert.equal(rows.length,1);assert.ok(rows[0].grossXlm>.29);
});
test('two-phase ledger guard rejects scan spanning too many ledgers',async()=>{
  let ledgers=0;
  const f=async url=>{
    if(url.includes('/ledgers?')){ledgers++;return ok({_embedded:{records:[{sequence:ledgers===1?100:104,closed_at:closed}]}},ledgers===1?100:104)}
    return ok({_embedded:{records:[]}},102)
  };
  await assert.rejects(()=>scanOnce(f,cfg,()=>STAMP),/SCAN_SPANS_TOO_MANY_LEDGERS/);
});
test('normal empty scan has no trades, no profits and no candidates',async()=>{
  const f=async url=>url.includes('/ledgers?')?ok(ledgerBody):ok({_embedded:{records:[]}});
  const scan=await scanOnce(f,cfg,()=>STAMP);
  assert.equal(scan.ordersPlaced,0);assert.equal(scan.realizedPnlXlm,null);
  assert.equal(scan.pathsFound,0);assert.equal(scan.approvedCandidates,0);
});
test('network trade sample counts active asset pairs',()=>{
  const trade={base_asset_type:'native',counter_asset_type:'credit_alphanum4',counter_asset_code:'USDC',counter_asset_issuer:USDC.split(':')[1]};
  const out=parseTradeSample({_embedded:{records:[trade,trade]}});
  assert.equal(out.activePairs,1);assert.equal(out.activeAssets,2);assert.equal(out.pairs[0].count,2);
});

function candidateQuotes(sizes) {
  return async url => {
    const requestUrl = new URL(url);
    if (requestUrl.pathname === '/ledgers') return ok(ledgerBody);
    assert.equal(requestUrl.pathname, '/paths/strict-send');
    const size = Number(requestUrl.searchParams.get('source_amount'));
    sizes.push(size);
    return ok({ _embedded: { records: [rec([USDC, VELO], size, size + 1)] } });
  };
}

test('eligible paper scan quotes up to exactly 10.5 XLM below the daily stop', async () => {
  const sizes = [];
  const scan = await scanOnce(candidateQuotes(sizes), cfg, () => STAMP, {
    ...paperState, lossXlm: 3.4999999
  });
  assert.deepEqual(sizes, [2, 5, 10.5]);
  assert.equal(scan.approvedCandidates, 3);
  assert.equal(scan.ordersPlaced, 0);
  assert.equal(scan.realizedPnlXlm, null);
});

test('paper balance must cover quote notional and fee while leaving the reserve intact', async () => {
  const sizes = [];
  await scanOnce(candidateQuotes(sizes), cfg, () => STAMP, { ...paperState, balanceXlm: 605.5299999 });
  assert.deepEqual(sizes, [2, 5]);
  sizes.length = 0;
  await scanOnce(candidateQuotes(sizes), cfg, () => STAMP, { ...paperState, balanceXlm: 605.53 });
  assert.deepEqual(sizes, [2, 5, 10.5]);
  await assert.rejects(
    scanOnce(() => assert.fail('unexpected request'), cfg, () => STAMP, { ...paperState, balanceXlm: 595 }),
    /INSUFFICIENT_PAPER_BUDGET/
  );
});

test('daily paper loss stops the scan at the cap and above it before any request', async () => {
  for (const lossXlm of [3.5, 3.5000001]) {
    await assert.rejects(
      scanOnce(() => assert.fail('unexpected request'), cfg, () => STAMP, { ...paperState, lossXlm }),
      /PAPER_DAILY_LOSS_CAP_REACHED/
    );
  }
});

test('missing state leaves quotes research-only and invalid state fails closed', async () => {
  const result = await scanOnce(candidateQuotes([]), cfg, () => STAMP);
  assert.equal(result.approvedCandidates, 0);
  assert.ok(result.candidates.length);
  assert.ok(result.candidates.every(candidate => candidate.status === 'PAPER_RISK_UNAVAILABLE'));
  for (const state of [
    { ...paperState, lossXlm: -1 },
    { ...paperState, lossXlm: '0' },
    { ...paperState, balanceXlm: Infinity },
    { ...paperState, dateUtc: '2026-11-26' }
  ]) {
    await assert.rejects(
      scanOnce(() => assert.fail('unexpected request'), cfg, () => STAMP, state),
      /INVALID_OR_STALE_PAPER_STATE/
    );
  }
});

test('a paper scan crossing midnight UTC must wait for fresh daily state', async () => {
  const midnight = Date.parse('2026-11-28T00:00:00Z');
  let now = midnight - 1;
  const fetcher = candidateQuotes([]);
  await assert.rejects(
    scanOnce(async url => {
      if (url.includes('/ledgers?')) {
        return ok({ _embedded: { records: [{ sequence: 100, closed_at: new Date(midnight - 5000).toISOString() }] } });
      }
      if (url.includes('source_amount=10.5000000')) now = midnight;
      return fetcher(url);
    }, cfg, () => now, paperState),
    /INVALID_OR_STALE_PAPER_STATE/
  );
});
