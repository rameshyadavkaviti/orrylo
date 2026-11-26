import { Account, Asset, BASE_FEE, Networks, Operation, StrKey, TransactionBuilder } from '@stellar/stellar-sdk';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { APPROVED, DEFAULTS, netEstimate, request, scanOnce } from './network-hunter.mjs';
import { quotePaperCycles, readJournal } from './paper-trading.mjs';

const cfg = DEFAULTS;
const approved = new Set(APPROVED);
const scale = 10_000_000;
const validAccountId = value => typeof value === 'string' && StrKey.isValidEd25519PublicKey(value);
const validInteger = value => Number.isSafeInteger(value) && value >= 0;
const maxFee = cfg.maxFeeXlm * scale;

function stroops(amount) {
  const decimal = String(amount);
  if (!/^\d+(\.\d{1,7})?$/.test(decimal)) throw new Error('INVALID_XLM_AMOUNT');
  const [whole, fraction = ''] = decimal.split('.');
  return BigInt(whole) * BigInt(scale) + BigInt(fraction.padEnd(7, '0'));
}

function xlm(amount) {
  return (amount / BigInt(scale)) + '.' + (amount % BigInt(scale)).toString().padStart(7, '0');
}

export function buildArbitrageTransaction({ candidate, account, ledger, feeStroops, paperState, nowMs = Date.now() }) {
  if (!validInteger(feeStroops) || feeStroops < Number(BASE_FEE) || feeStroops > maxFee) {
    throw new Error('INVALID_FEE_LIMIT');
  }

  const sequence = ledger?.sequence;
  const closedAt = Date.parse(ledger?.closed_at);
  if (!validInteger(sequence) || sequence === 0 || !Number.isFinite(closedAt) ||
      closedAt > nowMs + 3000 || nowMs - closedAt > cfg.maxLedgerAgeMs ||
      !validInteger(candidate?.quoteLedger) || Math.abs(candidate.quoteLedger - sequence) > cfg.maxQuoteLagLedgers) {
    throw new Error('STALE_OPPORTUNITY');
  }

  const path = typeof candidate.path === 'string' ? candidate.path.split('>') : [];
  const intermediate = path.slice(1, -1);
  if (candidate.status !== 'PAPER_CANDIDATE' || path[0] !== 'native' || path.at(-1) !== 'native' ||
      intermediate.length < 1 || intermediate.length > 5 || new Set(intermediate).size !== intermediate.length ||
      intermediate.some(asset => asset === 'native' || !approved.has(asset))) {
    throw new Error('INVALID_ARBITRAGE_PATH');
  }
  if (!Number.isFinite(candidate.amountInXlm) || !Number.isFinite(candidate.quotedOutputXlm) ||
      candidate.amountInXlm < 1 || candidate.amountInXlm > cfg.maxTradeXlm ||
      !netEstimate(candidate.amountInXlm, candidate.quotedOutputXlm, cfg).eligible) {
    throw new Error('INELIGIBLE_ARBITRAGE_QUOTE');
  }
  const send = stroops(candidate.amountInXlm);
  const fee = BigInt(feeStroops);
  const edgeBps = (send * BigInt(cfg.minNetBps) + 9999n) / 10000n;
  const edgeXlm = stroops(cfg.minNetXlm);
  const destinationMin = send + fee + (edgeBps > edgeXlm ? edgeBps : edgeXlm);
  if (stroops(candidate.quotedOutputXlm) < destinationMin) throw new Error('QUOTE_BELOW_DESTINATION_MIN');

  if (paperState?.dateUtc !== new Date(nowMs).toISOString().slice(0, 10) ||
      !Number.isFinite(paperState.lossXlm) || !Number.isFinite(paperState.balanceXlm)) {
    throw new Error('INVALID_PAPER_STATE');
  }
  const loss = stroops(paperState.lossXlm);
  const lossCap = stroops(cfg.dailyLossCapXlm);
  if (loss >= lossCap || loss + fee > lossCap) throw new Error('PAPER_DAILY_LOSS_BUDGET');
  const paperReserve = stroops(cfg.reserveXlm);
  if (stroops(Math.min(cfg.capitalXlm, paperState.balanceXlm)) < paperReserve + fee + send) {
    throw new Error('PAPER_RESERVE_BUDGET');
  }

  const addr = account?.account_id;
  if (!validAccountId(addr) || typeof account.sequence !== 'string' || !/^\d+$/.test(account.sequence) ||
      BigInt(account.sequence) >= 9223372036854775807n ||
      ![account.subentry_count, account.num_sponsoring, account.num_sponsored, ledger.base_reserve_in_stroops]
        .every(validInteger) || ledger.base_reserve_in_stroops === 0) {
    throw new Error('INVALID_ACCOUNT_SNAPSHOT');
  }

  const nativeBalance = account.balances?.find(row => row.asset_type === 'native');
  const units = 2n + BigInt(account.subentry_count) + BigInt(account.num_sponsoring) - BigInt(account.num_sponsored);
  if (!nativeBalance || units < 0n) throw new Error('INVALID_ACCOUNT_SNAPSHOT');
  const protocolReserve = units * BigInt(ledger.base_reserve_in_stroops);
  const reserve = protocolReserve > paperReserve ? protocolReserve : paperReserve;
  if (stroops(nativeBalance.balance) - stroops(nativeBalance.selling_liabilities) < reserve + send + fee) {
    throw new Error('INSUFFICIENT_ACCOUNT_BUDGET');
  }

  const maxLedger = Math.min(sequence, candidate.quoteLedger) + cfg.maxQuoteLagLedgers + 1;
  const maxTime = Math.floor(nowMs / 1000) + 20;
  const tx = new TransactionBuilder(new Account(addr, account.sequence), {
    fee: String(feeStroops), networkPassphrase: Networks.PUBLIC
  })
    .setTimebounds(0, maxTime)
    .setLedgerbounds(sequence, maxLedger)
    .addOperation(Operation.pathPaymentStrictSend({
      sendAsset: Asset.native(), sendAmount: xlm(send), destination: addr,
      destAsset: Asset.native(), destMin: xlm(destinationMin),
      path: intermediate.map(asset => new Asset(...asset.split(':')))
    }))
    .build();

  return {
    status: 'UNSIGNED_ARBITRAGE_TRANSACTION',
    unsignedXdr: tx.toXDR(),
    transactionHash: tx.hash().toString('hex'),
    sendXlm: xlm(send),
    destinationMinXlm: xlm(destinationMin),
    feeStroops,
    expiresAt: new Date(maxTime * 1000).toISOString(),
    maxLedger
  };
}

export async function prepareLatestArbitrage({ accountId, paperState, feeStroops }, fetcher = fetch, nowFn = Date.now) {
  if (!validAccountId(accountId)) throw new Error('INVALID_PUBLIC_ACCOUNT');
  const scan = await scanOnce(fetcher, cfg, nowFn, paperState, quotePaperCycles);
  const candidate = scan.candidates.find(row => row.status === 'PAPER_CANDIDATE');
  if (!candidate) return { status: 'NO_PAPER_CANDIDATE', ledger: scan.ledger };

  const [{ body: account, ledger: accountLedger }, { body: ledger }] = await Promise.all([
    request('/accounts/' + accountId, fetcher),
    request('/ledgers/' + scan.ledger, fetcher, undefined, false)
  ]);
  if (account.account_id !== accountId || ledger.sequence !== scan.ledger ||
      Math.abs(accountLedger - scan.ledger) > cfg.maxQuoteLagLedgers) {
    throw new Error('INCONSISTENT_ACCOUNT_OR_LEDGER');
  }
  return buildArbitrageTransaction({ candidate, account, ledger, feeStroops, paperState, nowMs: nowFn() });
}

async function main() {
  const { values } = parseArgs({
    options: { account: { type: 'string' }, journal: { type: 'string' }, 'fee-stroops': { type: 'string' } }
  });
  if (!values.journal || !/^\d+$/.test(values['fee-stroops'] ?? '')) {
    throw new Error('PAPER_JOURNAL_AND_FEE_REQUIRED');
  }
  const paperState = await readJournal(values.journal, new Date().toISOString().slice(0, 10));
  const result = await prepareLatestArbitrage({
    accountId: values.account, paperState, feeStroops: Number(values['fee-stroops'])
  });
  console.log(JSON.stringify(result));
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch(error => {
    console.error(JSON.stringify({ status: 'TRANSACTION_NOT_PREPARED', reason: error.message }));
    process.exitCode = 1;
  });
}
