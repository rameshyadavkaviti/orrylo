import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { APPROVED } from './network-hunter.mjs';
import { runPaperCycle } from './paper-trading.mjs';

const now = Date.parse('2026-11-27T12:00:05Z');
const nowFn = () => now;
const closed_at = new Date(now - 5000).toISOString();
const [asset_code, asset_issuer] = [...APPROVED].find(key => key.startsWith('USDC:')).split(':');
const path = [{ asset_type: 'credit_alphanum4', asset_code, asset_issuer }];

async function journalFile(t) {
  const dir = await mkdtemp(join(tmpdir(), 'orrylo-paper-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return join(dir, 'journal.json');
}

function mockQuotes(ledger, confirmation, { hasOpportunity = true } = {}) {
  let quoteCount = 0;
  return async (url, options) => {
    assert.equal(options.method ?? 'GET', 'GET');
    const request = new URL(url);
    let records;
    if (request.pathname === '/ledgers') {
      records = [{ sequence: ledger, closed_at }];
    } else {
      assert.equal(request.pathname, '/paths/strict-send');
      const amount = Number(request.searchParams.get('source_amount'));
      assert.ok(amount <= 10.5);
      quoteCount++;
      const output = quoteCount <= 3 ? amount * 1.1 : confirmation(amount);
      records = hasOpportunity && output !== null ? [{
        source_asset_type: 'native',
        destination_asset_type: 'native',
        source_amount: String(amount),
        destination_amount: String(output),
        path
      }] : [];
    }
    return { ok: true, headers: { get: () => String(ledger) }, json: async () => ({ _embedded: { records } }) };
  };
}

test('paper cycle shows and persists simulated fills and skips a ledger already attempted', async t => {
  const journal = await journalFile(t);
  const result = await runPaperCycle(journal, { fetcher: mockQuotes(100, amount => amount + 1), nowFn });
  assert.equal(result.outcome.status, 'PAPER_FILL');
  assert.equal(result.outcome.inputXlm, 10.5);
  assert.ok(result.outcome.simulatedPnlXlm > 0);
  assert.equal(result.ordersPlaced, 0);
  assert.equal(result.balanceXlm, Number((700 + result.outcome.simulatedPnlXlm).toFixed(7)));
  const repeat = await runPaperCycle(journal, { fetcher: mockQuotes(100, () => assert.fail('unexpected requote')), nowFn });
  assert.equal(repeat.outcome, null);
  const saved = JSON.parse(await readFile(journal, 'utf8'));
  assert.deepEqual(saved.results, [result.outcome]);
  assert.equal(saved.balanceXlm, result.balanceXlm);
});

test('lost path records a simulated failure debit, and an empty book creates no trade', async t => {
  const journal = await journalFile(t);
  const lost = await runPaperCycle(journal, { fetcher: mockQuotes(100, () => null), nowFn });
  assert.equal(lost.outcome.status, 'PAPER_NO_FILL');
  assert.equal(lost.outcome.simulatedPnlXlm, -0.01);
  assert.equal(lost.lossXlm, 0.01);
  assert.equal(lost.balanceXlm, 699.99);
  const empty = await runPaperCycle(journal, {
    fetcher: mockQuotes(101, () => assert.fail('unexpected requote'), { hasOpportunity: false }), nowFn
  });
  assert.equal(empty.approvedCandidates, 0);
  assert.equal(empty.outcome, null);
  assert.equal(empty.balanceXlm, 699.99);
});

test('a restart preserves the loss stop and insufficient remaining headroom prevents a new attempt', async t => {
  const journal = await journalFile(t);
  const first = await runPaperCycle(journal, { fetcher: mockQuotes(100, () => null), nowFn });
  const saved = JSON.parse(await readFile(journal, 'utf8'));
  await writeFile(journal, JSON.stringify({ ...saved, lossXlm: 3.495 }));
  const nearCap = await runPaperCycle(journal, {
    fetcher: mockQuotes(101, () => assert.fail('unexpected requote')), nowFn
  });
  assert.equal(nearCap.outcome, null);
  assert.equal(nearCap.status, 'PAPER_DAILY_LOSS_HEADROOM');
  await writeFile(journal, JSON.stringify({ ...saved, lossXlm: 3.5 }));
  await assert.rejects(
    runPaperCycle(journal, { fetcher: () => assert.fail('unexpected network request'), nowFn }),
    /PAPER_DAILY_LOSS_CAP_REACHED/
  );
  assert.equal(first.ordersPlaced, 0);
});

test('identity-only Horizon response falls back to vetted triangular quotes', async t => {
  const journal = await journalFile(t);
  const issuers = new Map([...APPROVED].filter(key => key.includes(':')).map(key => key.split(':')));
  const asset = symbol => symbol === 'native'
    ? { asset_type: 'native' }
    : { asset_type: 'credit_alphanum4', asset_code: symbol, asset_issuer: issuers.get(symbol) };
  const side = (name, symbol) => Object.fromEntries(
    Object.entries(asset(symbol)).map(([key, value]) => [name + '_' + key, value])
  );
  let directQuotes = 0;
  const fetcher = async url => {
    const { pathname, searchParams } = new URL(url);
    const from = searchParams.get('source_asset_code') ?? 'native';
    const to = searchParams.get('destination_assets')?.split(':')[0];
    const amount = Number(searchParams.get('source_amount'));
    let records = [{ sequence: 100, closed_at }];
    if (pathname === '/paths/strict-send') {
      if (from !== 'native' || to !== 'native') directQuotes++;
      const output = from === 'VELO' && to === 'native' ? amount * 1.1 : amount;
      records = [{ ...side('source', from), ...side('destination', to),
        source_amount: String(amount), destination_amount: String(output), path: [] }];
    }
    return {
      ok: true,
      headers: { get: name => pathname !== '/ledgers' && name === 'latest-ledger' ? '100' : null },
      json: async () => ({ _embedded: { records } })
    };
  };
  const result = await runPaperCycle(journal, { fetcher, nowFn });
  assert.equal(directQuotes, 24);
  assert.equal(result.outcome.status, 'PAPER_FILL');
  assert.equal(result.outcome.inputXlm, 10.5);
  assert.match(result.outcome.path, /^native>USDC:[^>]+>VELO:[^>]+>native$/);
});

test('a second paper runner cannot write to a journal during a scan', async t => {
  const journal = await journalFile(t);
  let release;
  let started;
  const pending = new Promise(resolve => { release = resolve; });
  const ready = new Promise(resolve => { started = resolve; });
  const quotes = mockQuotes(100, () => null);
  const first = runPaperCycle(journal, {
    fetcher: async (...args) => {
      started();
      await pending;
      return quotes(...args);
    },
    nowFn
  });
  await ready;
  try {
    await assert.rejects(runPaperCycle(journal, {
      fetcher: () => assert.fail('unexpected additional runner'), nowFn
    }), { code: 'EEXIST' });
  } finally {
    release();
    await first;
  }
});
