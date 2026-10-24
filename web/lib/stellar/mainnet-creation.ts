import { createHash } from "node:crypto";

import {
  Account,
  Asset,
  Keypair,
  Memo,
  Networks,
  Operation,
  Transaction,
  TransactionBuilder,
} from "@stellar/stellar-sdk";

import {
  isKnownRyloIssuerPublicKey,
  SHARED_ISSUER_CANDIDATE,
} from "../product/constants";
import { validateInitialSupply } from "../validation/initial-supply";

export const MAINNET_SHARED_ISSUER_PUBLIC_KEY = SHARED_ISSUER_CANDIDATE;
export const MAINNET_TREASURY_PUBLIC_KEY =
  "GAABHXPQQB3EBT6FZJKGR6C6DT7XJEUEBGVPK2G2AQDKBIVXCBKXDBR7";
export const MAINNET_CREATION_PRICE_STROOPS = "100000000";
export const MAINNET_CREATION_PRICE_XLM = "10.0000000";
export const OFFICIAL_STELLAR_MAINNET_HORIZON_URL =
  "https://horizon.stellar.org";

const INTEGER = /^(0|[1-9][0-9]*)$/;
const HASH = /^[0-9a-f]{64}$/;
const ASSET_CODE = /^[A-Z0-9]{1,12}$/;

export type MainnetCreationErrorCode =
  | "mainnet_disabled"
  | "mainnet_configuration_unavailable"
  | "treasury_identity_forbidden"
  | "invalid_request"
  | "fee_cap_exceeded"
  | "horizon_unavailable"
  | "invalid_horizon_response";

export class MainnetCreationError extends Error {
  constructor(readonly code: MainnetCreationErrorCode) {
    super(code);
    this.name = "MainnetCreationError";
  }
}

export interface MainnetCreationConfiguration {
  network: "public";
  enabled: true;
  issuerPublicKey: string;
  treasuryPublicKey: string;
  priceStroops: typeof MAINNET_CREATION_PRICE_STROOPS;
  issuerFeeStroops: string;
  customerTrustlineMaxFeeStroops: string;
}

function normalizedPublicKey(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return Keypair.fromPublicKey(value.trim()).publicKey();
  } catch {
    return null;
  }
}

function positiveInteger(value: string | undefined): value is string {
  return Boolean(value && INTEGER.test(value) && BigInt(value) > 0n);
}

export function readMainnetCreationConfiguration(
  env: Readonly<Record<string, string | undefined>> = process.env,
): MainnetCreationConfiguration {
  if (env.ORRYLO_MAINNET_CREATION_ENABLED !== "true") {
    throw new MainnetCreationError("mainnet_disabled");
  }
  const issuer = normalizedPublicKey(
    env.ORRYLO_MAINNET_SHARED_ISSUER_PUBLIC_KEY,
  );
  const treasury = normalizedPublicKey(env.ORRYLO_MAINNET_TREASURY_PUBLIC_KEY);
  if (
    issuer !== MAINNET_SHARED_ISSUER_PUBLIC_KEY ||
    env.ORRYLO_MAINNET_TREASURY_VERIFIED !== "true" ||
    !positiveInteger(env.ORRYLO_MAINNET_ISSUER_FEE_STROOPS) ||
    !positiveInteger(env.ORRYLO_MAINNET_CUSTOMER_TRUSTLINE_MAX_FEE_STROOPS)
  ) {
    throw new MainnetCreationError("mainnet_configuration_unavailable");
  }
  if (
    !treasury ||
    treasury !== MAINNET_TREASURY_PUBLIC_KEY ||
    isKnownRyloIssuerPublicKey(treasury)
  ) {
    throw new MainnetCreationError("treasury_identity_forbidden");
  }
  return {
    network: "public",
    enabled: true,
    issuerPublicKey: issuer,
    treasuryPublicKey: MAINNET_TREASURY_PUBLIC_KEY,
    priceStroops: MAINNET_CREATION_PRICE_STROOPS,
    issuerFeeStroops: env.ORRYLO_MAINNET_ISSUER_FEE_STROOPS,
    customerTrustlineMaxFeeStroops:
      env.ORRYLO_MAINNET_CUSTOMER_TRUSTLINE_MAX_FEE_STROOPS,
  };
}

export interface BuiltMainnetTransaction {
  unsignedXdr: string;
  unsignedXdrSha256: string;
  transactionHash: string;
  sourceSequence: string;
  feeStroops: string;
  validFrom: number;
  validUntil: number;
}

interface BuildCommonInput {
  assetCode: string;
  amount: string;
  feeStroops: string;
  maxFeeStroops: string;
  ledgerClosedAt: string;
}

function validateBuildInput(input: BuildCommonInput) {
  const amount = validateInitialSupply(input.amount);
  const closedAtMs = Date.parse(input.ledgerClosedAt);
  if (
    !ASSET_CODE.test(input.assetCode) ||
    !amount.valid ||
    !positiveInteger(input.feeStroops) ||
    !positiveInteger(input.maxFeeStroops) ||
    !Number.isFinite(closedAtMs)
  ) {
    throw new MainnetCreationError("invalid_request");
  }
  if (BigInt(input.feeStroops) > BigInt(input.maxFeeStroops)) {
    throw new MainnetCreationError("fee_cap_exceeded");
  }
  return {
    amount: amount.normalized,
    validFrom: Math.floor(closedAtMs / 1000),
  };
}

function mapBuilt(transaction: Transaction): BuiltMainnetTransaction {
  const xdr = transaction.toXDR();
  return {
    unsignedXdr: xdr,
    unsignedXdrSha256: createHash("sha256").update(xdr).digest("hex"),
    transactionHash: Buffer.from(transaction.hash()).toString("hex"),
    sourceSequence: transaction.sequence,
    feeStroops: transaction.fee,
    validFrom: Number(transaction.timeBounds?.minTime ?? 0),
    validUntil: Number(transaction.timeBounds?.maxTime ?? 0),
  };
}

export function buildMainnetTrustline(
  input: BuildCommonInput & {
    ownerPublicKey: string;
    ownerSequence: string;
  },
): BuiltMainnetTransaction {
  const validated = validateBuildInput(input);
  const owner = normalizedPublicKey(input.ownerPublicKey);
  if (!owner || owner === MAINNET_SHARED_ISSUER_PUBLIC_KEY || !INTEGER.test(input.ownerSequence)) {
    throw new MainnetCreationError("invalid_request");
  }
  const transaction = new TransactionBuilder(new Account(owner, input.ownerSequence), {
    fee: input.feeStroops,
    networkPassphrase: Networks.PUBLIC,
  })
    .addOperation(
      Operation.changeTrust({
        asset: new Asset(input.assetCode, MAINNET_SHARED_ISSUER_PUBLIC_KEY),
        limit: validated.amount,
      }),
    )
    .setTimebounds(validated.validFrom, validated.validFrom + 300)
    .build();
  return mapBuilt(transaction);
}

export function buildMainnetPayment(input: {
  ownerPublicKey: string;
  ownerSequence: string;
  treasuryPublicKey: string;
  memo: string;
  feeStroops: string;
  maxFeeStroops: string;
  ledgerClosedAt: string;
}): BuiltMainnetTransaction {
  const owner = normalizedPublicKey(input.ownerPublicKey);
  const treasury = normalizedPublicKey(input.treasuryPublicKey);
  const closedAtMs = Date.parse(input.ledgerClosedAt);
  if (
    !owner ||
    treasury !== MAINNET_TREASURY_PUBLIC_KEY ||
    !INTEGER.test(input.ownerSequence) ||
    !positiveInteger(input.feeStroops) ||
    !positiveInteger(input.maxFeeStroops) ||
    BigInt(input.feeStroops) > BigInt(input.maxFeeStroops) ||
    !/^[A-Za-z0-9_-]{1,28}$/.test(input.memo) ||
    !Number.isFinite(closedAtMs)
  ) {
    throw new MainnetCreationError("invalid_request");
  }
  const validFrom = Math.floor(closedAtMs / 1000);
  const transaction = new TransactionBuilder(new Account(owner, input.ownerSequence), {
    fee: input.feeStroops,
    networkPassphrase: Networks.PUBLIC,
    memo: Memo.text(input.memo),
  })
    .addOperation(
      Operation.payment({
        destination: MAINNET_TREASURY_PUBLIC_KEY,
        asset: Asset.native(),
        amount: MAINNET_CREATION_PRICE_XLM,
      }),
    )
    .setTimebounds(validFrom, validFrom + 300)
    .build();
  return mapBuilt(transaction);
}

export function buildMainnetIssuance(
  input: BuildCommonInput & {
    issuerSequence: string;
    destinationPublicKey: string;
  },
): BuiltMainnetTransaction {
  const validated = validateBuildInput(input);
  const destination = normalizedPublicKey(input.destinationPublicKey);
  if (
    !destination ||
    destination === MAINNET_SHARED_ISSUER_PUBLIC_KEY ||
    !INTEGER.test(input.issuerSequence)
  ) {
    throw new MainnetCreationError("invalid_request");
  }
  const transaction = new TransactionBuilder(
    new Account(MAINNET_SHARED_ISSUER_PUBLIC_KEY, input.issuerSequence),
    { fee: input.feeStroops, networkPassphrase: Networks.PUBLIC },
  )
    .addOperation(
      Operation.payment({
        destination,
        asset: new Asset(input.assetCode, MAINNET_SHARED_ISSUER_PUBLIC_KEY),
        amount: validated.amount,
      }),
    )
    .setTimebounds(validated.validFrom, validated.validFrom + 300)
    .build();
  return mapBuilt(transaction);
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function horizonAmountToStroops(value: unknown): bigint | null {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)\.[0-9]{7}$/.test(value)) {
    return null;
  }
  const [whole, fraction] = value.split(".") as [string, string];
  return BigInt(whole) * 10_000_000n + BigInt(fraction);
}

async function readHorizon(
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

export type MainnetIssuanceVerification =
  | { status: "not_found" | "rejected" }
  | {
      status: "confirmed";
      transactionHash: string;
      ledgerSequence: number;
      ledgerClosedAt: string;
      sourceSequence: string;
      envelopeXdrSha256: string;
      resultXdrSha256: string;
    };

export async function verifyMainnetIssuance(
  input: {
    transactionHash: string;
    destinationPublicKey: string;
    assetCode: string;
    amount: string;
  },
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<MainnetIssuanceVerification> {
  const destination = normalizedPublicKey(input.destinationPublicKey);
  const amount = validateInitialSupply(input.amount);
  if (!HASH.test(input.transactionHash) || !destination || !ASSET_CODE.test(input.assetCode) || !amount.valid) {
    throw new MainnetCreationError("invalid_request");
  }
  const transaction = await readHorizon(fetchImpl, `/transactions/${input.transactionHash}`);
  if (transaction === null) return { status: "not_found" };
  const tx = record(transaction);
  if (
    !tx ||
    tx.hash !== input.transactionHash ||
    tx.successful !== true ||
    tx.source_account !== MAINNET_SHARED_ISSUER_PUBLIC_KEY ||
    typeof tx.source_account_sequence !== "string" ||
    !INTEGER.test(tx.source_account_sequence) ||
    tx.operation_count !== 1 ||
    !Number.isSafeInteger(tx.ledger) ||
    (tx.ledger as number) < 1 ||
    typeof tx.created_at !== "string" ||
    !Number.isFinite(Date.parse(tx.created_at)) ||
    typeof tx.envelope_xdr !== "string" ||
    typeof tx.result_xdr !== "string"
  ) {
    return { status: "rejected" };
  }
  const operations = record(
    await readHorizon(fetchImpl, `/transactions/${input.transactionHash}/operations?limit=2`),
  );
  const embedded = record(operations?._embedded);
  const records = embedded?.records;
  if (!Array.isArray(records) || records.length !== 1) return { status: "rejected" };
  const operation = record(records[0]);
  if (
    !operation ||
    operation.type !== "payment" ||
    operation.source_account !== MAINNET_SHARED_ISSUER_PUBLIC_KEY ||
    operation.from !== MAINNET_SHARED_ISSUER_PUBLIC_KEY ||
    operation.to !== destination ||
    operation.asset_code !== input.assetCode ||
    operation.asset_issuer !== MAINNET_SHARED_ISSUER_PUBLIC_KEY ||
    horizonAmountToStroops(operation.amount) !== amount.stroops
  ) {
    return { status: "rejected" };
  }
  return {
    status: "confirmed",
    transactionHash: input.transactionHash,
    ledgerSequence: tx.ledger as number,
    ledgerClosedAt: new Date(tx.created_at).toISOString(),
    sourceSequence: tx.source_account_sequence,
    envelopeXdrSha256: createHash("sha256").update(tx.envelope_xdr).digest("hex"),
    resultXdrSha256: createHash("sha256").update(tx.result_xdr).digest("hex"),
  };
}
