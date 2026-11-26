import { randomUUID } from 'node:crypto';
import { open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { APPROVED, DEFAULTS, journalLog, netEstimate, networkLedger, quoteCycles, scanOnce } from './network-hunter.mjs';
import { ASSETS, ROUTES, quoteDirect } from './triangular.mjs';

const dateUtc = time => new Date(time).toISOString().slice(0, 10);
const roundXlm = amount => Number(amount.toFixed(7));
const validAmount = amount => Number.isFinite(amount) && amount >= 0;

async function readJournal(path, today) {
  let content;
  try {
    content = await readFile(path, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return {
      mode: 'PAPER_ONLY', dateUtc: today, balanceXlm: DEFAULTS.capitalXlm,
      lossXlm: 0, lastAttemptLedger: 0, results: []
    };
  }
  let state;
  try {
    state = JSON.parse(content);
  } catch {
    throw new Error('INVALID_PAPER_JOURNAL');
  }
  if (state?.mode !== 'PAPER_ONLY' || !Array.isArray(state.results) ||
      !validAmount(state.balanceXlm) || !validAmount(state.lossXlm) ||
      !Number.isSafeInteger(state.lastAttemptLedger) || state.lastAttemptLedger < 0 ||
      typeof state.dateUtc !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(state.dateUtc) ||
      state.dateUtc > today) {
    throw new Error('INVALID_PAPER_JOURNAL');
  }
  if (state.dateUtc < today) {
    state.dateUtc = today;
    state.lossXlm = 0;
  }
  return state;
}

async function saveJournal(path, state) {
  const pending = path + '.' + randomUUID() + '.tmp';
  try {
    await writeFile(pending, JSON.stringify(state, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    await rename(pending, path);
  } finally {
    await rm(pending, { force: true });
  }
}

async function quotePaperCycles(size, fetcher, approved, cfg, nowFn) {
  const started = nowFn();
  const native = await quoteCycles(size, fetcher, approved, cfg, nowFn);
  if (!native.identityOnly) return native;

  const ledgers = [native.ledger];
  const routes = await Promise.all(ROUTES.map(async route => {
    let output = size;
    for (let index = 1; index < route.length; index++) {
      const quote = await quoteDirect(route[index - 1], route[index], output, fetcher);
      ledgers.push(quote.ledger);
      if (nowFn() - started > cfg.maxQuoteWindowMs) throw new Error('QUOTE_WINDOW_EXCEEDED');
      if (quote.amount === null) return null;
      output = quote.amount;
    }
    const path = route.map(symbol => ASSETS[symbol].key);
    return {
      path, approvedPath: path.every(key => approved.has(key)),
      amountInXlm: size, quotedOutputXlm: output, ...netEstimate(size, output, cfg)
    };
  }));
  const ledger = Math.max(...ledgers);
  const ledgerMin = Math.min(...ledgers);
  if (ledger - ledgerMin > cfg.maxQuoteLagLedgers) throw new Error('QUOTE_LEDGER_DRIFT');
  return { size, ledger, ledgerMin, paths: routes.filter(Boolean) };
}

async function simulate(candidate, scanLedger, fetcher, nowFn) {
  const fresh = await quotePaperCycles(candidate.amountInXlm, fetcher, APPROVED, DEFAULTS, nowFn);
  const observed = await networkLedger(fetcher, nowFn(), DEFAULTS);
  if (fresh.ledger < scanLedger ||
      Math.abs(fresh.ledger - observed.sequence) > DEFAULTS.maxQuoteLagLedgers ||
      Math.abs((fresh.ledgerMin ?? fresh.ledger) - observed.sequence) > DEFAULTS.maxQuoteLagLedgers) {
    throw new Error('STALE_PAPER_CONFIRMATION');
  }

  const match = fresh.paths
    .filter(path => path.approvedPath && path.path.join('>') === candidate.path)
    .reduce((best, path) => !best || path.conservativeNetXlm > best.conservativeNetXlm ? path : best, null);
  const fill = match?.eligible === true;
  return {
    status: fill ? 'PAPER_FILL' : 'PAPER_NO_FILL',
    time: new Date(nowFn()).toISOString(),
    scanLedger,
    confirmationLedger: fresh.ledger,
    path: candidate.path,
    inputXlm: candidate.amountInXlm,
    quotedOutputXlm: match?.quotedOutputXlm ?? null,
    modeledCostsXlm: fill ? roundXlm(match.assumedCostsXlm) : DEFAULTS.failureReserveXlm,
    simulatedPnlXlm: fill ? match.conservativeNetXlm : -DEFAULTS.failureReserveXlm
  };
}

export async function runPaperCycle(path, { fetcher = fetch, nowFn = Date.now } = {}) {
  const lockPath = path + '.lock';
  const lock = await open(lockPath, 'wx', 0o600);
  try {
    const today = dateUtc(nowFn());
    const state = await readJournal(path, today);
    const scan = await scanOnce(fetcher, DEFAULTS, nowFn, state, quotePaperCycles);
    const candidate = scan.candidates.find(row => row.status === 'PAPER_CANDIDATE');
    let outcome = null;
    let status = 'NO_PAPER_CANDIDATE';
    if (candidate) {
      if (scan.ledger <= state.lastAttemptLedger) {
        status = 'PAPER_LEDGER_ALREADY_ATTEMPTED';
      } else if (roundXlm(state.lossXlm + DEFAULTS.failureReserveXlm) > DEFAULTS.dailyLossCapXlm) {
        status = 'PAPER_DAILY_LOSS_HEADROOM';
      } else {
        outcome = await simulate(candidate, scan.ledger, fetcher, nowFn);
        if (dateUtc(Date.parse(outcome.time)) !== today) throw new Error('PAPER_DAY_CHANGED');
        state.lastAttemptLedger = outcome.confirmationLedger;
        state.balanceXlm = roundXlm(state.balanceXlm + outcome.simulatedPnlXlm);
        state.lossXlm = roundXlm(state.lossXlm + Math.max(0, -outcome.simulatedPnlXlm));
        state.results.push(outcome);
        status = outcome.status;
      }
    }
    const result = { status, ledger: scan.ledger, approvedCandidates: scan.approvedCandidates,
      balanceXlm: state.balanceXlm, lossXlm: state.lossXlm, outcome, ordersPlaced: 0 };
    state.lastScan = result;
    await saveJournal(path, state);
    return result;
  } finally {
    await lock.close();
    await rm(lockPath);
  }
}

async function main() {
  const { values } = parseArgs({
    options: { once: { type: 'boolean' }, journal: { type: 'string' } }
  });
  if (!values.journal) throw new Error('PAPER_JOURNAL_PATH_REQUIRED');

  journalLog('paper_started', { safety: 'NO_SIGNING_NO_ORDERS' });
  do {
    try {
      journalLog('paper_scan', await runPaperCycle(values.journal));
    } catch (error) {
      journalLog('fail_closed', { reason: error.code ?? error.message });
      if (values.once) process.exitCode = 1;
    }
    if (!values.once) await sleep(DEFAULTS.pollMs);
  } while (!values.once);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    journalLog('fatal', { reason: error.message });
    process.exitCode = 1;
  });
}
