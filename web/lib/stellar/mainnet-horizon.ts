import {
  Asset,
  Keypair,
  Networks,
  Transaction,
  TransactionBuilder,
} from "@stellar/stellar-sdk";

import { validateInitialSupply } from "../validation/initial-supply";
import {
  MAINNET_SHARED_ISSUER_PUBLIC_KEY,
  MAINNET_CREATION_PRICE_STROOPS,
  OFFICIAL_STELLAR_MAINNET_HORIZON_URL,
  buildMainnetIssuance,
  buildMainnetPayment,
  buildMainnetTrustline,
  type BuiltMainnetTransaction,
  MainnetCreationError,
} from "./mainnet-creation";

const INTEGER = /^(0|[1-9][0-9]*)$/;

interface HorizonBalance {
  asset_type: string;
  asset_code?: string;
  asset_issuer?: string;
  balance: string;
  limit?: string;
  buying_liabilities?: string;
  selling_liabilities?: string;
  is_authorized?: boolean;
}

interface HorizonAccount {
  account_id: string;
  sequence: string;
  subentry_count: number;
  num_sponsoring: number;
  num_sponsored: number;
  thresholds?: {
    low_threshold: number;
    med_threshold: number;
    high_threshold: number;
  };
  signers?: Array<{ key: string; weight: number; type: string }>;
  balances: HorizonBalance[];
}

interface HorizonLedger {
  sequence: number;
  closed_at: string;
  base_fee_in_stroops: number;
  base_reserve_in_stroops: number;
}

function fail(code: string): never {
  throw new Error(code);
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new MainnetCreationError("invalid_horizon_response");
  }
  return value as Record<string, unknown>;
}

async function read(
  fetchImpl: typeof fetch,
  path: string,
): Promise<unknown | null> {
  let response: Response;
  try {
    response = await fetchImpl(`${OFFICIAL_STELLAR_MAINNET_HORIZON_URL}${path}`, {
      method: "GET",
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new MainnetCreationError("horizon_unavailable");
  }
  if (response.status === 404) return null;
  if (!response.ok) throw new MainnetCreationError("horizon_unavailable");
  try {
    return await response.json();
  } catch {
    throw new MainnetCreationError("invalid_horizon_response");
  }
}

async function latestLedger(fetchImpl: typeof fetch): Promise<HorizonLedger> {
  const data = record(await read(fetchImpl, "/ledgers?order=desc&limit=1"));
  const embedded = record(data._embedded);
  if (!Array.isArray(embedded.records) || embedded.records.length !== 1) {
    throw new MainnetCreationError("invalid_horizon_response");
  }
  const ledger = record(embedded.records[0]) as unknown as HorizonLedger;
  if (
    !Number.isSafeInteger(ledger.sequence) ||
    ledger.sequence < 1 ||
    !Number.isSafeInteger(ledger.base_fee_in_stroops) ||
    ledger.base_fee_in_stroops < 1 ||
    !Number.isSafeInteger(ledger.base_reserve_in_stroops) ||
    ledger.base_reserve_in_stroops < 1 ||
    typeof ledger.closed_at !== "string" ||
    !Number.isFinite(Date.parse(ledger.closed_at))
  ) {
    throw new MainnetCreationError("invalid_horizon_response");
  }
  return ledger;
}

async function account(
  fetchImpl: typeof fetch,
  publicKey: string,
): Promise<HorizonAccount> {
  const value = await read(fetchImpl, `/accounts/${publicKey}`);
  if (value === null) fail("account_not_found");
  const result = record(value) as unknown as HorizonAccount;
  if (
    result.account_id !== publicKey ||
    !INTEGER.test(result.sequence) ||
    !Number.isSafeInteger(result.subentry_count) ||
    !Number.isSafeInteger(result.num_sponsoring) ||
    !Number.isSafeInteger(result.num_sponsored) ||
    !Array.isArray(result.balances)
  ) {
    throw new MainnetCreationError("invalid_horizon_response");
  }
  return result;
}

async function snapshot(fetchImpl: typeof fetch, owner: string) {
  const before = await latestLedger(fetchImpl);
  const [issuer, destination] = await Promise.all([
    account(fetchImpl, MAINNET_SHARED_ISSUER_PUBLIC_KEY),
    account(fetchImpl, owner),
  ]);
  const after = await latestLedger(fetchImpl);
  if (
    after.sequence !== before.sequence ||
    after.closed_at !== before.closed_at ||
    after.base_fee_in_stroops !== before.base_fee_in_stroops ||
    after.base_reserve_in_stroops !== before.base_reserve_in_stroops
  ) {
    fail("unstable_horizon_snapshot");
  }
  return { ledger: after, issuer, destination };
}

function amountStroops(value: string | undefined): bigint {
  const match = /^(0|[1-9][0-9]*)\.([0-9]{7})$/.exec(value ?? "");
  if (!match) throw new MainnetCreationError("invalid_horizon_response");
  return BigInt(match[1]) * 10_000_000n + BigInt(match[2]);
}

function trustlineCapacity(
  destination: HorizonAccount,
  assetCode: string,
  amount: bigint,
): boolean {
  const trustline = destination.balances.find(
    (balance) =>
      balance.asset_type !== "native" &&
      balance.asset_code === assetCode &&
      balance.asset_issuer === MAINNET_SHARED_ISSUER_PUBLIC_KEY,
  );
  if (!trustline) return false;
  if (trustline.is_authorized !== true) fail("trustline_unauthorized");
  return (
    amountStroops(trustline.limit) -
      amountStroops(trustline.balance) -
      amountStroops(trustline.buying_liabilities ?? "0.0000000") >=
    amount
  );
}

function assertFee(fee: number | string, cap: string): string {
  if (!INTEGER.test(String(fee)) || !INTEGER.test(cap) || BigInt(fee) > BigInt(cap)) {
    fail("fee_cap_exceeded");
  }
  return String(fee);
}

function assertCustomerFunding(
  destination: HorizonAccount,
  ledger: HorizonLedger,
  fee: bigint,
  requiresNewTrustline: boolean,
): void {
  const native = destination.balances.find((item) => item.asset_type === "native");
  if (!native) fail("customer_native_balance_missing");
  const reserveUnits =
    2n + BigInt(destination.subentry_count) + BigInt(destination.num_sponsoring) - BigInt(destination.num_sponsored);
  const spendable =
    amountStroops(native.balance) -
    amountStroops(native.selling_liabilities ?? "0.0000000") -
    reserveUnits * BigInt(ledger.base_reserve_in_stroops);
  const required = fee + (requiresNewTrustline ? BigInt(ledger.base_reserve_in_stroops) : 0n);
  if (spendable < required) fail("insufficient_customer_xlm");
}

export async function prepareMainnetTrustline(
  input: {
    ownerPublicKey: string;
    assetCode: string;
    amount: string;
    maxFeeStroops: string;
  },
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<
  | { status: "ready"; ledgerSequence: number }
  | { status: "signature_required"; ledgerSequence: number; transaction: BuiltMainnetTransaction }
> {
  const amount = validateInitialSupply(input.amount);
  if (!amount.valid) throw new MainnetCreationError("invalid_request");
  try {
    Keypair.fromPublicKey(input.ownerPublicKey);
  } catch {
    throw new MainnetCreationError("invalid_request");
  }
  const current = await snapshot(fetchImpl, input.ownerPublicKey);
  if (trustlineCapacity(current.destination, input.assetCode, amount.stroops)) {
    return { status: "ready", ledgerSequence: current.ledger.sequence };
  }
  const fee = assertFee(current.ledger.base_fee_in_stroops, input.maxFeeStroops);
  assertCustomerFunding(current.destination, current.ledger, BigInt(fee), true);
  return {
    status: "signature_required",
    ledgerSequence: current.ledger.sequence,
    transaction: buildMainnetTrustline({
      ownerPublicKey: input.ownerPublicKey,
      ownerSequence: current.destination.sequence,
      assetCode: input.assetCode,
      amount: input.amount,
      feeStroops: fee,
      maxFeeStroops: input.maxFeeStroops,
      ledgerClosedAt: current.ledger.closed_at,
    }),
  };
}

export async function prepareMainnetPayment(
  input: {
    ownerPublicKey: string;
    treasuryPublicKey: string;
    memo: string;
    maxFeeStroops: string;
  },
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<BuiltMainnetTransaction> {
  const current = await snapshot(fetchImpl, input.ownerPublicKey);
  const fee = assertFee(current.ledger.base_fee_in_stroops, input.maxFeeStroops);
  assertCustomerFunding(
    current.destination,
    current.ledger,
    BigInt(fee) + BigInt(MAINNET_CREATION_PRICE_STROOPS),
    false,
  );
  return buildMainnetPayment({
    ownerPublicKey: input.ownerPublicKey,
    ownerSequence: current.destination.sequence,
    treasuryPublicKey: input.treasuryPublicKey,
    memo: input.memo,
    feeStroops: fee,
    maxFeeStroops: input.maxFeeStroops,
    ledgerClosedAt: current.ledger.closed_at,
  });
}

export async function confirmMainnetTrustline(
  input: {
    transactionHash: string;
    ownerPublicKey: string;
    assetCode: string;
    amount: string;
    maxFeeStroops: string;
  },
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<{ transactionHash: string; ledgerSequence: number }> {
  const value = await read(fetchImpl, `/transactions/${input.transactionHash}`);
  if (value === null) fail("trustline_pending");
  const result = record(value);
  if (
    result.hash !== input.transactionHash ||
    result.successful !== true ||
    !Number.isSafeInteger(result.ledger) ||
    typeof result.envelope_xdr !== "string"
  ) {
    fail("trustline_transaction_mismatch");
  }
  let transaction: Transaction;
  try {
    const parsed = TransactionBuilder.fromXDR(result.envelope_xdr, Networks.PUBLIC);
    if (!(parsed instanceof Transaction)) fail("trustline_transaction_mismatch");
    transaction = parsed;
  } catch {
    fail("trustline_transaction_mismatch");
  }
  const operation = transaction.operations[0];
  const requestedAmount = validateInitialSupply(input.amount);
  if (!requestedAmount.valid) throw new MainnetCreationError("invalid_request");
  const publicKey = Keypair.fromPublicKey(input.ownerPublicKey);
  const signature = transaction.signatures[0];
  if (
    Buffer.from(transaction.hash()).toString("hex") !== input.transactionHash ||
    transaction.source !== input.ownerPublicKey ||
    transaction.operations.length !== 1 ||
    operation?.type !== "changeTrust" ||
    (operation.source && operation.source !== input.ownerPublicKey) ||
    !(operation.line instanceof Asset) ||
    operation.line.getCode() !== input.assetCode ||
    operation.line.getIssuer() !== MAINNET_SHARED_ISSUER_PUBLIC_KEY ||
    amountStroops(operation.limit) < requestedAmount.stroops ||
    BigInt(transaction.fee) > BigInt(input.maxFeeStroops) ||
    transaction.signatures.length !== 1 ||
    !signature ||
    !publicKey.verify(transaction.hash(), signature.signature)
  ) {
    fail("trustline_transaction_mismatch");
  }
  const readiness = await prepareMainnetTrustline(input, fetchImpl);
  if (readiness.status !== "ready") fail("trustline_pending");
  return {
    transactionHash: input.transactionHash,
    ledgerSequence: result.ledger as number,
  };
}

function assertIssuerPolicy(issuer: HorizonAccount): void {
  if (
    issuer.account_id !== MAINNET_SHARED_ISSUER_PUBLIC_KEY ||
    issuer.thresholds?.low_threshold !== 1 ||
    issuer.thresholds.med_threshold !== 1 ||
    issuer.thresholds.high_threshold !== 1 ||
    !Array.isArray(issuer.signers) ||
    issuer.signers.length !== 1 ||
    issuer.signers[0]?.key !== MAINNET_SHARED_ISSUER_PUBLIC_KEY ||
    issuer.signers[0].weight !== 1
  ) {
    fail("issuer_policy_mismatch");
  }
}

export async function prepareMainnetIssuance(
  input: {
    destinationPublicKey: string;
    assetCode: string;
    amount: string;
    feeStroops: string;
    maxFeeStroops: string;
  },
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<BuiltMainnetTransaction> {
  const amount = validateInitialSupply(input.amount);
  if (!amount.valid) throw new MainnetCreationError("invalid_request");
  const current = await snapshot(fetchImpl, input.destinationPublicKey);
  assertIssuerPolicy(current.issuer);
  const fee = assertFee(input.feeStroops, input.maxFeeStroops);
  if (BigInt(fee) < BigInt(current.ledger.base_fee_in_stroops)) fail("fee_below_network_minimum");
  if (!trustlineCapacity(current.destination, input.assetCode, amount.stroops)) {
    fail("trustline_not_ready");
  }
  const native = current.issuer.balances.find((item) => item.asset_type === "native");
  if (!native) fail("issuer_native_balance_missing");
  const reserveUnits =
    2n + BigInt(current.issuer.subentry_count) + BigInt(current.issuer.num_sponsoring) - BigInt(current.issuer.num_sponsored);
  const spendable =
    amountStroops(native.balance) -
    amountStroops(native.selling_liabilities ?? "0.0000000") -
    reserveUnits * BigInt(current.ledger.base_reserve_in_stroops);
  if (spendable < BigInt(fee)) fail("insufficient_issuer_xlm");
  return buildMainnetIssuance({
    issuerSequence: current.issuer.sequence,
    destinationPublicKey: input.destinationPublicKey,
    assetCode: input.assetCode,
    amount: input.amount,
    feeStroops: fee,
    maxFeeStroops: input.maxFeeStroops,
    ledgerClosedAt: current.ledger.closed_at,
  });
}
