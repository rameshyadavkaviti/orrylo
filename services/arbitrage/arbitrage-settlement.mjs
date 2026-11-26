import { Networks, StrKey, Transaction, TransactionBuilder, xdr } from '@stellar/stellar-sdk';

/**
 * Reconcile a signed envelope against its known Ledger receipt. The caller
 * supplies the trusted receipt fetched by hash and persists it once per hash.
 */
export function reconcileArbitrageSettlement(prepared, receipt) {
  const tx = TransactionBuilder.fromXDR(prepared.signedXdr, Networks.PUBLIC);
  const hash = tx.hash().toString('hex');
  const settledAt = Date.parse(receipt?.created_at);
  if (!(tx instanceof Transaction) || !tx.signatures.length || hash !== prepared.transactionHash ||
      hash !== receipt?.hash || tx.source !== receipt.source_account ||
      tx.sequence !== String(receipt.source_account_sequence) ||
      !Number.isSafeInteger(receipt.ledger) || receipt.ledger <= 0 ||
      !Number.isFinite(settledAt)) {
    throw new Error('MISMATCHED_ARBITRAGE_RECEIPT');
  }

  const [operation] = tx.operations;
  if (tx.operations.length !== 1 || operation.type !== 'pathPaymentStrictSend' ||
      (operation.source && operation.source !== tx.source) || operation.destination !== tx.source ||
      !operation.sendAsset.isNative() || !operation.destAsset.isNative()) {
    throw new Error('INVALID_ARBITRAGE_ENVELOPE');
  }

  const { feeCharged, result } = xdr.TransactionResult.fromXDR(receipt.result_xdr, 'base64');
  if (!/^\d+$/.test(String(receipt.fee_charged)) || feeCharged < 0n ||
      feeCharged !== BigInt(receipt.fee_charged) || feeCharged > BigInt(tx.fee)) {
    throw new Error('MISMATCHED_SETTLEMENT_FEE');
  }

  const success = result.type === 'txSuccess';
  if ((!success && result.type !== 'txFailed') || receipt.successful !== success) {
    throw new Error('MISMATCHED_SETTLEMENT_STATUS');
  }

  let pnl = -feeCharged;
  if (success) {
    const [opResult] = result.results;
    const payment = opResult?.tr?.pathPaymentStrictSendResult;
    const credit = payment?.success?.last;
    const sendAmount = BigInt(operation.sendAmount.replace('.', ''));
    const destinationMin = BigInt(operation.destMin.replace('.', ''));
    if (result.results.length !== 1 || payment?.type !== 'pathPaymentStrictSendSuccess' ||
        credit?.asset.type !== 'assetTypeNative' ||
        StrKey.encodeEd25519PublicKey(credit.destination.ed25519.toBytes()) !== tx.source ||
        credit.amount < destinationMin) {
      throw new Error('MISMATCHED_SETTLEMENT_PAYMENT');
    }
    pnl += credit.amount - sendAmount;
  }

  if (!Number.isSafeInteger(Number(pnl))) throw new Error('INVALID_SETTLEMENT_AMOUNT');
  return {
    transactionHash: hash,
    ledger: receipt.ledger,
    dateUtc: new Date(settledAt).toISOString().slice(0, 10),
    successful: success,
    feeStroops: Number(feeCharged),
    netPnlStroops: Number(pnl)
  };
}
