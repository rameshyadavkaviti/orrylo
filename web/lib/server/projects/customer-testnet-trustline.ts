import {
  Account,
  Asset,
  Keypair,
  Networks,
  Operation,
  Transaction,
  TransactionBuilder,
} from "@stellar/stellar-sdk";

import {
  validateInitialSupply,
  STELLAR_MAX_AMOUNT_STROOPS,
} from "../../validation/initial-supply";
import { OFFICIAL_STELLAR_TESTNET_HORIZON_URL } from "../../stellar/official-testnet-horizon";
import { OfficialStellarTestnetIssuancePreflightReader } from "../../stellar/shared-issuer-testnet-preflight";

const APPROVED_ISSUER =
  "GBW4IKGPC5Q4YRKGRMNNXTVRZNQZ3DFWFHXSQUAMWLXES75MWTY3TWOV";
const HASH = /^[0-9a-f]{64}$/;
const INTEGER = /^(0|[1-9][0-9]*)$/;
const AMOUNT = /^(0|[1-9][0-9]*)\.([0-9]{7})$/;
const STROOPS = 10_000_000n;

export class CustomerTrustlineError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "CustomerTrustlineError";
  }
}

export interface CustomerTrustlineConfiguration {
  issuerPublicKey: string;
  issuerFeeStroops: string;
  maxCustomerFeeStroops: string;
}

export function readCustomerTrustlineConfiguration(
  env: NodeJS.ProcessEnv = process.env,
): CustomerTrustlineConfiguration {
  if (
    env.NEXT_PUBLIC_STELLAR_NETWORK !== "testnet" ||
    env.ORRYLO_APPROVED_TESTNET_SHARED_ISSUER_PUBLIC_KEY !== APPROVED_ISSUER ||
    !env.ORRYLO_TESTNET_SHARED_ISSUER_FEE_STROOPS ||
    !INTEGER.test(env.ORRYLO_TESTNET_SHARED_ISSUER_FEE_STROOPS) ||
    BigInt(env.ORRYLO_TESTNET_SHARED_ISSUER_FEE_STROOPS) === 0n ||
    !env.ORRYLO_TESTNET_CUSTOMER_TRUSTLINE_MAX_FEE_STROOPS ||
    !INTEGER.test(env.ORRYLO_TESTNET_CUSTOMER_TRUSTLINE_MAX_FEE_STROOPS) ||
    BigInt(env.ORRYLO_TESTNET_CUSTOMER_TRUSTLINE_MAX_FEE_STROOPS) === 0n
  ) {
    throw new CustomerTrustlineError("trustline_configuration_unavailable");
  }
  return {
    issuerPublicKey: APPROVED_ISSUER,
    issuerFeeStroops: env.ORRYLO_TESTNET_SHARED_ISSUER_FEE_STROOPS,
    maxCustomerFeeStroops:
      env.ORRYLO_TESTNET_CUSTOMER_TRUSTLINE_MAX_FEE_STROOPS,
  };
}

interface HorizonAccount {
  account_id: string;
  sequence: string;
  subentry_count: number;
  num_sponsoring: number;
  num_sponsored: number;
  balances: Array<{
    asset_type: string;
    asset_code?: string;
    asset_issuer?: string;
    balance: string;
    limit?: string;
    buying_liabilities?: string;
    selling_liabilities?: string;
    is_authorized?: boolean;
  }>;
}

interface HorizonLedger {
  sequence: number;
  closed_at: string;
  base_fee_in_stroops: number;
  base_reserve_in_stroops: number;
}

export interface CustomerTrustlinePlan {
  status: "ready" | "signature_required";
  network: "testnet";
  issuerPublicKey: string;
  destinationPublicKey: string;
  assetCode: string;
  amount: string;
  issuerFeeStroops: string;
  customerFeeStroops: string;
  customerFeeCapStroops: string;
  additionalReserveStroops: string;
  /** Server-constructed, one-operation Testnet ChangeTrust only. */
  unsignedXdr?: string;
  transactionHash?: string;
  validUntil?: number;
}

function parseAmount(value: string): bigint {
  const match = AMOUNT.exec(value);
  if (!match) throw new CustomerTrustlineError("malformed_horizon_response");
  return BigInt(match[1]) * STROOPS + BigInt(match[2]);
}

function formatAmount(stroops: bigint): string {
  return (
    (stroops / STROOPS).toString() +
    "." +
    (stroops % STROOPS).toString().padStart(7, "0")
  );
}

async function readJson(
  fetchImpl: typeof fetch,
  path: string,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImpl(
      new URL(path, OFFICIAL_STELLAR_TESTNET_HORIZON_URL),
      {
        method: "GET",
        headers: { accept: "application/json" },
        cache: "no-store",
        redirect: "error",
      },
    );
  } catch {
    throw new CustomerTrustlineError("horizon_unavailable");
  }
  if (!response.ok) {
    if (response.status === 404) throw new CustomerTrustlineError("not_found");
    throw new CustomerTrustlineError("horizon_unavailable");
  }
  try {
    return await response.json();
  } catch {
    throw new CustomerTrustlineError("malformed_horizon_response");
  }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CustomerTrustlineError("malformed_horizon_response");
  }
  return value as Record<string, unknown>;
}

async function latestLedger(fetchImpl: typeof fetch): Promise<HorizonLedger> {
  const data = record(await readJson(fetchImpl, "/ledgers?order=desc&limit=1"));
  const embedded = record(data._embedded);
  if (!Array.isArray(embedded.records)) {
    throw new CustomerTrustlineError("malformed_horizon_response");
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
    throw new CustomerTrustlineError("malformed_horizon_response");
  }
  return ledger;
}

async function readAccount(
  fetchImpl: typeof fetch,
  destination: string,
): Promise<HorizonAccount> {
  const account = record(
    await readJson(fetchImpl, "/accounts/" + destination),
  ) as unknown as HorizonAccount;
  if (
    account.account_id !== destination ||
    typeof account.sequence !== "string" ||
    !INTEGER.test(account.sequence) ||
    !Number.isSafeInteger(account.subentry_count) ||
    account.subentry_count < 0 ||
    !Number.isSafeInteger(account.num_sponsoring) ||
    account.num_sponsoring < 0 ||
    !Number.isSafeInteger(account.num_sponsored) ||
    account.num_sponsored < 0 ||
    !Array.isArray(account.balances)
  ) {
    throw new CustomerTrustlineError("malformed_horizon_response");
  }
  return account;
}

export async function inspectCustomerTrustline(
  input: {
    configuration: CustomerTrustlineConfiguration;
    destinationPublicKey: string;
    assetCode: string;
    initialSupply: string;
  },
  fetchImpl: typeof fetch = globalThis.fetch,
  now: () => number = Date.now,
): Promise<CustomerTrustlinePlan> {
  const { configuration } = input;
  if (
    configuration.issuerPublicKey !== APPROVED_ISSUER ||
    !INTEGER.test(configuration.issuerFeeStroops) ||
    !INTEGER.test(configuration.maxCustomerFeeStroops)
  ) {
    throw new CustomerTrustlineError("trustline_configuration_unavailable");
  }
  const amount = validateInitialSupply(input.initialSupply);
  if (!amount.valid || !/^[A-Z0-9]{1,12}$/.test(input.assetCode)) {
    throw new CustomerTrustlineError("invalid_request");
  }
  let destination: string;
  try {
    destination = Keypair.fromPublicKey(input.destinationPublicKey).publicKey();
  } catch {
    throw new CustomerTrustlineError("invalid_destination");
  }
  if (destination === APPROVED_ISSUER)
    throw new CustomerTrustlineError("invalid_destination");

  // Reuse the issuer flag/signer/threshold, fee/reserve and exact trustline reader.
  await new OfficialStellarTestnetIssuancePreflightReader(
    fetchImpl,
  ).readIssuancePreconditions({
    issuerPublicKey: APPROVED_ISSUER,
    destinationPublicKey: destination,
    assetCode: input.assetCode,
    assetCodeReservedForProject: true,
    feeStroops: configuration.issuerFeeStroops,
  });

  const before = await latestLedger(fetchImpl);
  let account = await readAccount(fetchImpl, destination);
  const after = await latestLedger(fetchImpl);
  if (
    after.sequence < before.sequence ||
    Date.parse(after.closed_at) < Date.parse(before.closed_at) ||
    (after.sequence === before.sequence &&
      (after.closed_at !== before.closed_at ||
        after.base_fee_in_stroops !== before.base_fee_in_stroops ||
        after.base_reserve_in_stroops !== before.base_reserve_in_stroops))
  ) {
    throw new CustomerTrustlineError("malformed_horizon_response");
  }
  if (after.sequence > before.sequence)
    account = await readAccount(fetchImpl, destination);

  const trust = account.balances.find(
    (balance) =>
      balance.asset_type !== "native" &&
      balance.asset_code === input.assetCode &&
      balance.asset_issuer === APPROVED_ISSUER,
  );
  const balance = trust ? parseAmount(trust.balance) : 0n;
  const buying = trust
    ? parseAmount(trust.buying_liabilities ?? "0.0000000")
    : 0n;
  const limit = trust ? parseAmount(trust.limit ?? "") : 0n;
  if (trust && trust.is_authorized !== true) {
    throw new CustomerTrustlineError("trustline_unauthorized");
  }
  const common = {
    network: "testnet" as const,
    issuerPublicKey: APPROVED_ISSUER,
    destinationPublicKey: destination,
    assetCode: input.assetCode,
    amount: amount.normalized,
    issuerFeeStroops: configuration.issuerFeeStroops,
    customerFeeCapStroops: configuration.maxCustomerFeeStroops,
  };
  if (trust && limit - balance - buying >= amount.stroops) {
    return {
      ...common,
      status: "ready",
      customerFeeStroops: "0",
      additionalReserveStroops: "0",
    };
  }
  const minimumLimit = balance + buying + amount.stroops;
  if (minimumLimit > STELLAR_MAX_AMOUNT_STROOPS) {
    throw new CustomerTrustlineError("trustline_capacity_exceeded");
  }
  const fee = BigInt(after.base_fee_in_stroops);
  if (fee > BigInt(configuration.maxCustomerFeeStroops)) {
    throw new CustomerTrustlineError("trustline_fee_cap_exceeded");
  }
  const extraReserve = trust ? 0n : BigInt(after.base_reserve_in_stroops);
  const native = account.balances.find(
    (balance) => balance.asset_type === "native",
  );
  if (!native) throw new CustomerTrustlineError("malformed_horizon_response");
  const balanceNative = parseAmount(native.balance);
  const sellingLiabilities = parseAmount(
    native.selling_liabilities ?? "0.0000000",
  );
  const reserveUnits =
    2n +
    BigInt(account.subentry_count) +
    BigInt(account.num_sponsoring) -
    BigInt(account.num_sponsored);
  if (
    reserveUnits < 0n ||
    balanceNative -
      reserveUnits * BigInt(after.base_reserve_in_stroops) -
      sellingLiabilities <
      fee + extraReserve
  ) {
    throw new CustomerTrustlineError("insufficient_customer_xlm");
  }

  const validFrom = Math.floor(now() / 1000);
  const validUntil = validFrom + 300;
  const unsigned = new TransactionBuilder(
    new Account(destination, BigInt(account.sequence).toString()),
    { fee: fee.toString(), networkPassphrase: Networks.TESTNET },
  )
    .addOperation(
      Operation.changeTrust({
        asset: new Asset(input.assetCode, APPROVED_ISSUER),
        limit: formatAmount(minimumLimit),
      }),
    )
    .setTimebounds(validFrom, validUntil)
    .build();

  return {
    ...common,
    status: "signature_required",
    customerFeeStroops: fee.toString(),
    additionalReserveStroops: extraReserve.toString(),
    unsignedXdr: unsigned.toXDR(),
    transactionHash: Buffer.from(unsigned.hash()).toString("hex"),
    validUntil,
  };
}

export async function confirmCustomerTrustline(
  input: {
    configuration: CustomerTrustlineConfiguration;
    destinationPublicKey: string;
    assetCode: string;
    initialSupply: string;
    transactionHash: string;
  },
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<CustomerTrustlinePlan> {
  if (!HASH.test(input.transactionHash))
    throw new CustomerTrustlineError("invalid_request");
  const data = record(
    await readJson(fetchImpl, "/transactions/" + input.transactionHash),
  );
  if (
    data.hash !== input.transactionHash ||
    data.successful !== true ||
    !Number.isSafeInteger(data.ledger) ||
    typeof data.envelope_xdr !== "string"
  ) {
    throw new CustomerTrustlineError("trustline_unconfirmed");
  }
  let tx: Transaction;
  try {
    const parsed = TransactionBuilder.fromXDR(
      data.envelope_xdr,
      Networks.TESTNET,
    );
    if (!(parsed instanceof Transaction)) throw new Error("fee bump");
    tx = parsed;
  } catch {
    throw new CustomerTrustlineError("trustline_transaction_mismatch");
  }
  const operation = tx.operations[0] as unknown as {
    type: string;
    line?: Asset;
    limit?: string;
    source?: string;
  };
  const amount = validateInitialSupply(input.initialSupply);
  if (
    !amount.valid ||
    Buffer.from(tx.hash()).toString("hex") !== input.transactionHash ||
    tx.source !== input.destinationPublicKey ||
    tx.operations.length !== 1 ||
    operation?.type !== "changeTrust" ||
    (operation.source && operation.source !== input.destinationPublicKey) ||
    operation.line?.getCode() !== input.assetCode ||
    operation.line?.getIssuer() !== input.configuration.issuerPublicKey ||
    !operation.limit ||
    parseAmountString(operation.limit) < amount.stroops ||
    BigInt(tx.fee) > BigInt(input.configuration.maxCustomerFeeStroops)
  ) {
    throw new CustomerTrustlineError("trustline_transaction_mismatch");
  }
  const result = await inspectCustomerTrustline(input, fetchImpl);
  if (result.status !== "ready")
    throw new CustomerTrustlineError("trustline_unconfirmed");
  return result;
}

function parseAmountString(value: string): bigint {
  const parsed = validateInitialSupply(value);
  if (!parsed.valid)
    throw new CustomerTrustlineError("trustline_transaction_mismatch");
  return parsed.stroops;
}
