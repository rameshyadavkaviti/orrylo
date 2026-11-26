import test from 'node:test';
import assert from 'node:assert/strict';
import { Keypair, Networks, TransactionBuilder, xdr } from '@stellar/stellar-sdk';
import { APPROVED } from './network-hunter.mjs';
import { buildArbitrageTransaction, prepareLatestArbitrage, signArbitrageTransaction } from './prepare-arbitrage.mjs';
import { reconcileArbitrageSettlement } from './arbitrage-settlement.mjs';

const signer = Keypair.random();
const publicKey = signer.publicKey();
const assets = [...APPROVED].filter(key => key !== 'native');
const nowMs = Date.parse('2026-11-27T12:00:05Z');
const input = {
  nowMs,
  account: {
    account_id: publicKey, sequence: '100', subentry_count: 0, num_sponsoring: 0, num_sponsored: 0,
    balances: [{ asset_type: 'native', balance: '700.0000000', selling_liabilities: '0.0000000' }]
  },
  candidate: {
    status: 'PAPER_CANDIDATE', path: ['native', ...assets, 'native'].join('>'),
    amountInXlm: 10.5, quotedOutputXlm: 10.9, quoteLedger: 100
  },
  ledger: { sequence: 100, closed_at: '2026-11-27T12:00:02Z', base_reserve_in_stroops: 5000000 },
  feeStroops: 1000,
  paperState: { dateUtc: '2026-11-27', balanceXlm: 700, lossXlm: 0 }
};

test('builds a bounded unsigned Stellar cycle returning XLM to its source account', () => {
  const result = buildArbitrageTransaction(input);
  const tx = TransactionBuilder.fromXDR(result.unsignedXdr, Networks.PUBLIC);
  assert.equal(tx.source, publicKey);
  assert.equal(tx.sequence, '101');
  assert.equal(tx.fee, '1000');
  assert.equal(tx.signatures.length, 0);
  assert.equal(tx.operations.length, 1);
  const [op] = tx.operations;
  assert.equal(op.type, 'pathPaymentStrictSend');
  assert.equal(op.destination, publicKey);
  assert.equal(op.sendAsset.isNative(), true);
  assert.equal(op.destAsset.isNative(), true);
  assert.equal(op.sendAmount, '10.5000000');
  assert.equal(op.destMin, '10.5736000');
  assert.deepEqual(op.path.map(asset => asset.getCode() + ':' + asset.getIssuer()), assets);
  assert.equal(Number(tx.timeBounds.maxTime), nowMs / 1000 + 20);
  assert.equal(tx.ledgerBounds.maxLedger, 103);
});

test('rejects stale, unapproved, oversized and uneconomic opportunities', () => {
  for (const candidate of [
    { quoteLedger: 95 },
    { path: 'native>native' },
    { path: ['native', assets[0], assets[0], 'native'].join('>') },
    { path: ['native', assets[0].split(':')[0] + ':' + publicKey, 'native'].join('>') },
    { amountInXlm: 10.5000001 },
    { quotedOutputXlm: 10.57 }
  ]) {
    assert.throws(() => buildArbitrageTransaction({ ...input, candidate: { ...input.candidate, ...candidate } }));
  }
  assert.throws(() => buildArbitrageTransaction({ ...input, nowMs: nowMs + 30000 }), /STALE/);
});

test('checks protected and Stellar reserves, liabilities and remaining fee headroom', () => {
  assert.throws(() => buildArbitrageTransaction({
    ...input, account: { ...input.account, balances: [{
      asset_type: 'native', balance: '606.0000000', selling_liabilities: '0.5000000'
    }] }
  }), /ACCOUNT_BUDGET/);
  assert.throws(() => buildArbitrageTransaction({
    ...input, account: { ...input.account, subentry_count: 1380 }
  }), /ACCOUNT_BUDGET/);
  assert.throws(() => buildArbitrageTransaction({
    ...input, paperState: { ...input.paperState, lossXlm: 3.49995 }
  }), /DAILY_LOSS/);
  assert.throws(() => buildArbitrageTransaction({ ...input, feeStroops: 300001 }), /FEE/);
});

test('prepares an envelope from a live-scan-shaped response using read-only endpoints', async () => {
  const paths = [];
  const fetcher = async (url, init) => {
    const { pathname, searchParams } = new URL(url);
    paths.push(pathname);
    assert.equal(init.method ?? 'GET', 'GET');
    let body;
    if (pathname === '/ledgers') {
      body = { _embedded: { records: [input.ledger] } };
    } else if (pathname === '/ledgers/100') {
      body = input.ledger;
    } else if (pathname === '/accounts/' + publicKey) {
      body = input.account;
    } else {
      assert.equal(pathname, '/paths/strict-send');
      const size = Number(searchParams.get('source_amount'));
      body = { _embedded: { records: [{
        source_asset_type: 'native', destination_asset_type: 'native',
        source_amount: String(size), destination_amount: String(size * 1.1),
        path: assets.map(key => {
          const [asset_code, asset_issuer] = key.split(':');
          return { asset_type: 'credit_alphanum4', asset_code, asset_issuer };
        })
      }] } };
    }
    return {
      ok: true, json: async () => body,
      headers: { get: name => name === 'latest-ledger' && pathname !== '/ledgers' ? '100' : null }
    };
  };
  const out = await prepareLatestArbitrage({
    accountId: publicKey, paperState: input.paperState, feeStroops: input.feeStroops
  }, fetcher, () => nowMs);
  assert.equal(out.status, 'UNSIGNED_ARBITRAGE_TRANSACTION');
  assert.equal(out.sendXlm, '10.5000000');
  assert.ok(paths.includes('/accounts/' + publicKey));
  assert.equal(paths.filter(path => path === '/paths/strict-send').length, 3);
});

test('signs only a freshly rebuilt envelope with the matching account key', () => {
  const out = signArbitrageTransaction(input, signer);
  const unsigned = buildArbitrageTransaction(input);
  const tx = TransactionBuilder.fromXDR(out.signedXdr, Networks.PUBLIC);
  assert.equal(out.transactionHash, unsigned.transactionHash);
  assert.equal(tx.signatures.length, 1);
  assert.ok(signer.verify(tx.hash(), tx.signatures[0].signature));
  assert.throws(() => signArbitrageTransaction(input, Keypair.random()), /SIGNER_ACCOUNT_MISMATCH/);
  assert.throws(() => signArbitrageTransaction(input, Keypair.fromPublicKey(publicKey)), /SIGNER_CANNOT_SIGN/);
  assert.throws(() => signArbitrageTransaction({ ...input, nowMs: nowMs + 30000 }, signer), /STALE_OPPORTUNITY/);
});

function receiptFor(prepared, { successful = true, fee = 900n } = {}) {
  const tx = TransactionBuilder.fromXDR(prepared.signedXdr, Networks.PUBLIC);
  const payment = new xdr.SimplePaymentResult({
    destination: signer.xdrPublicKey(), asset: xdr.Asset.assetTypeNative(), amount: 109_000_000n
  });
  const success = new xdr.PathPaymentStrictSendResultSuccess({ offers: [], last: payment });
  const result = successful ? xdr.TransactionResultResult.txSuccess([
    xdr.OperationResult.opInner(xdr.OperationResultTr.pathPaymentStrictSend(
      xdr.PathPaymentStrictSendResult.pathPaymentStrictSendSuccess(success)
    ))
  ]) : xdr.TransactionResultResult.txFailed([
    xdr.OperationResult.opInner(xdr.OperationResultTr.pathPaymentStrictSend(
      xdr.PathPaymentStrictSendResult.pathPaymentStrictSendUnderDestmin()
    ))
  ]);
  return {
    hash: prepared.transactionHash, source_account: publicKey, source_account_sequence: tx.sequence,
    ledger: 101, created_at: '2026-11-27T12:00:10Z', successful, fee_charged: String(fee),
    result_xdr: new xdr.TransactionResult({ feeCharged: fee, result, ext: xdr.TransactionResultExt.v0() }).toXDR('base64')
  };
}

test('reconciles exact settled return and charges the ledger fee on failed cycles', () => {
  const prepared = signArbitrageTransaction(input, signer);
  const fill = receiptFor(prepared);
  assert.equal(reconcileArbitrageSettlement(prepared, fill).netPnlStroops, 3_999_100);
  const failed = receiptFor(prepared, { successful: false });
  assert.equal(reconcileArbitrageSettlement(prepared, failed).netPnlStroops, -900);
  assert.throws(() => reconcileArbitrageSettlement(prepared, { ...fill, hash: '0'.repeat(64) }), /MISMATCHED/);
  assert.throws(() => reconcileArbitrageSettlement(prepared, { ...fill, fee_charged: '1' }), /FEE/);
  assert.throws(() => reconcileArbitrageSettlement(prepared, { ...fill, successful: false }), /STATUS/);
});
