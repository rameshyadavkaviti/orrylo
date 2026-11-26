import { BASE_FEE, Keypair } from '@stellar/stellar-sdk';
import { mkdir, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as sleep } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { reconcileArbitrageSettlement } from './arbitrage-settlement.mjs';
import { DEFAULTS, HORIZON, networkLedger, request } from './network-hunter.mjs';
import { findArbitrageInput, signArbitrageTransaction } from './prepare-arbitrage.mjs';

const stroopsPerXlm = 10_000_000;
const day = time => new Date(time).toISOString().slice(0, 10);

export function openLiveJournal(path, accountId) {
  const db = new DatabaseSync(path);
  try {
    db.exec(`
      PRAGMA busy_timeout = 5000;
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      CREATE TABLE IF NOT EXISTS identity (id INTEGER PRIMARY KEY CHECK (id = 1), account TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS pending (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        hash TEXT NOT NULL,
        envelope TEXT NOT NULL,
        expected_sequence TEXT NOT NULL,
        max_ledger INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS settled (
        hash TEXT PRIMARY KEY,
        date_utc TEXT NOT NULL,
        pnl_stroops INTEGER NOT NULL,
        receipt TEXT NOT NULL
      );
    `);
    db.prepare('INSERT OR IGNORE INTO identity VALUES (1, ?)').run(accountId);
    const identity = db.prepare('SELECT account FROM identity WHERE id = 1').get();
    if (identity.account !== accountId) throw new Error('JOURNAL_ACCOUNT_MISMATCH');
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

function finishPending(db, pending, settlement) {
  db.exec('BEGIN IMMEDIATE');
  try {
    if (settlement) {
      db.prepare('INSERT OR IGNORE INTO settled VALUES (?, ?, ?, ?)').run(
        settlement.transactionHash, settlement.dateUtc, settlement.netPnlStroops, JSON.stringify(settlement)
      );
    }
    db.prepare('DELETE FROM pending WHERE id = 1 AND hash = ?').run(pending.hash);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

async function resolvePending(db, pending, accountId, fetcher, nowFn) {
  const response = await fetcher(HORIZON + '/transactions/' + pending.hash, {
    headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(9000), redirect: 'error'
  });
  if (response.ok) {
    const settlement = reconcileArbitrageSettlement({
      signedXdr: pending.envelope, transactionHash: pending.hash
    }, await response.json());
    finishPending(db, pending, settlement);
    return { status: 'SETTLED', ...settlement };
  }
  if (response.status !== 404) throw new Error('SETTLEMENT_LOOKUP_FAILED');
  const ledger = await networkLedger(fetcher, nowFn());
  if (ledger.sequence <= pending.max_ledger) return { status: 'AWAITING_SETTLEMENT', hash: pending.hash };

  const { body: account, ledger: accountLedger } = await request('/accounts/' + accountId, fetcher);
  if (account.account_id !== accountId || accountLedger < ledger.sequence ||
      typeof account.sequence !== 'string' || !/^\d+$/.test(account.sequence) ||
      BigInt(account.sequence) >= BigInt(pending.expected_sequence)) {
    return { status: 'SETTLEMENT_UNRESOLVED', hash: pending.hash };
  }
  // The ledger bounds have passed and the source sequence was never consumed.
  finishPending(db, pending, null);
  return { status: 'EXPIRED_UNINCLUDED', hash: pending.hash };
}

function assertDedicatedAccount(account, accountId) {
  const signer = account.signers?.find(row => row.key === accountId && row.type === 'ed25519_public_key');
  if (!Number.isInteger(signer?.weight) || signer.weight <= 0 ||
      !Number.isInteger(account.thresholds?.med_threshold) || signer.weight < account.thresholds.med_threshold) {
    throw new Error('TREASURY_SIGNER_THRESHOLD');
  }
  if (!Array.isArray(account.balances) || account.balances.some(row =>
    row.asset_type === 'liquidity_pool_shares' || Number(row.selling_liabilities) !== 0 ||
    Number(row.buying_liabilities) !== 0)) {
    throw new Error('TREASURY_HAS_OFFERS_OR_POOL_SHARES');
  }
}

export async function runLiveCycle({ db, accountId, signer, fetcher = fetch, nowFn = Date.now }) {
  if (signer.publicKey() !== accountId || !signer.canSign()) throw new Error('TREASURY_SIGNER_MISMATCH');
  const pending = db.prepare('SELECT * FROM pending WHERE id = 1').get();
  if (pending) return resolvePending(db, pending, accountId, fetcher, nowFn);

  const dateUtc = day(nowFn());
  const daily = db.prepare('SELECT COALESCE(-SUM(pnl_stroops), 0) AS loss FROM settled WHERE date_utc = ? AND pnl_stroops < 0')
    .get(dateUtc);
  if (daily.loss >= DEFAULTS.dailyLossCapXlm * stroopsPerXlm) {
    return { status: 'DAILY_LOSS_STOP', lossStroops: daily.loss };
  }
  const { body: feeStats } = await request('/fee_stats', fetcher, undefined, false);
  const feeQuote = feeStats.fee_charged?.p90;
  if (!/^\d+$/.test(String(feeQuote))) throw new Error('INVALID_FEE_QUOTE');
  const feeStroops = Math.max(Number(BASE_FEE), Number(feeQuote));
  if (!Number.isSafeInteger(feeStroops) || feeStroops > DEFAULTS.maxFeeXlm * stroopsPerXlm ||
      daily.loss + feeStroops > DEFAULTS.dailyLossCapXlm * stroopsPerXlm) {
    return { status: 'FEE_BUDGET_STOP', lossStroops: daily.loss };
  }

  const { body: account } = await request('/accounts/' + accountId, fetcher);
  if (account.account_id !== accountId) throw new Error('TREASURY_ACCOUNT_MISMATCH');
  assertDedicatedAccount(account, accountId);
  const balanceXlm = Number(account.balances.find(row => row.asset_type === 'native')?.balance);
  if (!Number.isFinite(balanceXlm) || balanceXlm < DEFAULTS.reserveXlm) {
    return { status: 'INSUFFICIENT_TREASURY_BALANCE' };
  }
  const state = { dateUtc, balanceXlm, lossXlm: daily.loss / stroopsPerXlm };
  const input = await findArbitrageInput({ accountId, paperState: state, feeStroops }, fetcher, nowFn);
  if (!input.candidate) return { status: 'NO_LIVE_CANDIDATE', ledger: input.ledger };
  assertDedicatedAccount(input.account, accountId);

  const signed = signArbitrageTransaction(input, signer);
  const reservation = db.prepare(`
    INSERT OR IGNORE INTO pending (id, hash, envelope, expected_sequence, max_ledger)
    SELECT 1, ?, ?, ?, ?
    WHERE COALESCE((SELECT -SUM(pnl_stroops) FROM settled WHERE date_utc = ? AND pnl_stroops < 0), 0) + ? <= ?
      AND NOT EXISTS (SELECT 1 FROM settled WHERE hash = ?)
  `).run(signed.transactionHash, signed.signedXdr, (BigInt(input.account.sequence) + 1n).toString(),
    signed.maxLedger, dateUtc, feeStroops, DEFAULTS.dailyLossCapXlm * stroopsPerXlm, signed.transactionHash);
  if (!reservation.changes) return { status: 'SUBMISSION_NOT_RESERVED' };

  // Even an HTTP error is resolved by hash. Never submit a second envelope in this cycle.
  const response = await fetcher(HORIZON + '/transactions', {
    method: 'POST', body: new URLSearchParams({ tx: signed.signedXdr }),
    signal: AbortSignal.timeout(9000), redirect: 'error'
  });
  return { status: 'SUBMITTED_AWAITING_SETTLEMENT', hash: signed.transactionHash, httpStatus: response.status };
}

async function main() {
  if (process.env.ORRYLO_LIVE_ARBITRAGE !== 'true') throw new Error('LIVE_ARBITRAGE_DISABLED');
  const accountId = process.env.TREASURY_PUBLIC_KEY;
  let signer;
  try {
    signer = Keypair.fromSecret(process.env.TREASURY_SECRET_KEY);
    if (signer.publicKey() !== accountId) throw new Error();
  } catch {
    throw new Error('TREASURY_SIGNER_MISMATCH');
  }
  const mount = resolve(process.env.RAILWAY_VOLUME_MOUNT_PATH ?? '/');
  if (mount === '/' || (await stat(mount)).dev === (await stat(dirname(mount))).dev) {
    throw new Error('DURABLE_VOLUME_REQUIRED');
  }
  const directory = join(mount, 'orrylo-arbitrage');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const db = openLiveJournal(join(directory, 'live.sqlite'), accountId);
  console.log(JSON.stringify({ mode: 'MAINNET', status: 'LIVE_ARBITRAGE_STARTED' }));
  for (;;) {
    try {
      console.log(JSON.stringify({ mode: 'MAINNET', ...await runLiveCycle({ db, accountId, signer }) }));
    } catch (error) {
      console.error(JSON.stringify({ mode: 'MAINNET', status: 'FAIL_CLOSED', reason: error.message }));
    }
    await sleep(DEFAULTS.pollMs);
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch(error => {
    console.error(JSON.stringify({ status: 'LIVE_ARBITRAGE_NOT_STARTED', reason: error.message }));
    process.exitCode = 1;
  });
}
