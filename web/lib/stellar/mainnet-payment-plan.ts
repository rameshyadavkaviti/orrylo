/**
 * Build (never sign or submit) an exact single-operation Mainnet order payment.
 * Caller must fetch a fresh Horizon source sequence and authorize access to
 * this immutable order. The returned XDR is NOT payment evidence.
 */
import {
  Account,
  Asset,
  Memo,
  Networks,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";

const STELLAR_ACCOUNT = /^G[A-Z2-7]{55}$/;
const ORDER_MEMO = /^o[0-9a-f]{27}$/;
const SERVICE_AMOUNT = "10.0000000";
const FEE_STROOPS = "100";

export interface MainnetUnsignedPayment {
  xdr: string;
  expectedHash: string;
  source: string;
  destination: string;
  memo: string;
  amount: string;
  network: "public";
}

export function buildUnsignedMainnetOrderPayment(input: {
  source: string;
  sourceSequence: string;
  destination: string;
  memo: string;
}): MainnetUnsignedPayment {
  if (!STELLAR_ACCOUNT.test(input.source) ||
      !STELLAR_ACCOUNT.test(input.destination) ||
      input.source === input.destination ||
      !ORDER_MEMO.test(input.memo) ||
      !/^(0|[1-9][0-9]*)$/.test(input.sourceSequence)) {
    throw new Error("invalid_mainnet_payment_plan");
  }

  const transaction = new TransactionBuilder(
    new Account(input.source, input.sourceSequence),
    { fee: FEE_STROOPS, networkPassphrase: Networks.PUBLIC },
  )
    .addOperation(Operation.payment({
      destination: input.destination,
      asset: Asset.native(),
      amount: SERVICE_AMOUNT,
      source: input.source,
    }))
    .addMemo(Memo.text(input.memo))
    .setTimeout(120)
    .build();

  return {
    xdr: transaction.toXDR(),
    expectedHash: Buffer.from(transaction.hash()).toString("hex"),
    source: input.source,
    destination: input.destination,
    memo: input.memo,
    amount: SERVICE_AMOUNT,
    network: "public",
  };
}
