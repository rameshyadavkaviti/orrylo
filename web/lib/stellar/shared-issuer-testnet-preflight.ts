import { Keypair, Networks } from "@stellar/stellar-sdk";

import {
  SHARED_ISSUER_TESTNET_NETWORK,
  type SharedIssuerIssuancePreconditions,
  type SharedIssuerTrustlineSnapshot,
} from "./shared-issuer-issuance";
import { OFFICIAL_STELLAR_TESTNET_HORIZON_URL } from "./official-testnet-horizon";

const ASSET_CODE_PATTERN = /^[A-Z0-9]{1,12}$/;
const INTEGER_PATTERN = /^[0-9]+$/;
const STELLAR_AMOUNT_PATTERN = /^(0|[1-9][0-9]*)\.([0-9]{7})$/;
const STROOPS_PER_XLM = 10_000_000n;

type FetchLike = typeof fetch;

export type SharedIssuerTestnetPreflightErrorCode =
  | "invalid_issuer"
  | "invalid_destination"
  | "invalid_asset_code"
  | "invalid_fee"
  | "issuer_not_found"
  | "destination_not_found"
  | "horizon_unavailable"
  | "malformed_horizon_response"
  | "preflight_ledger_advanced"
  | "issuer_policy_mismatch"
  | "fee_below_network_minimum"
  | "insufficient_issuer_native_balance";

export class SharedIssuerTestnetPreflightError extends Error {
  constructor(
    readonly code: SharedIssuerTestnetPreflightErrorCode,
    message: string,
    readonly httpStatus?: number,
  ) {
    super(message);
    this.name = "SharedIssuerTestnetPreflightError";
  }
}

export interface SharedIssuerTestnetPreflightRequest {
  issuerPublicKey: string;
  destinationPublicKey: string;
  assetCode: string;
  assetCodeReservedForProject: boolean;
  feeStroops: string;
}

export interface SharedIssuerTestnetPreflightResult {
  network: typeof SHARED_ISSUER_TESTNET_NETWORK;
  networkPassphrase: typeof Networks.TESTNET;
  observedLedger: number;
  observedLedgerClosedAt: string;
  baseFeeStroops: string;
  baseReserveStroops: string;
  preconditions: SharedIssuerIssuancePreconditions;
}

interface HorizonLedgerRecord {
  sequence: number;
  closed_at: string;
  base_fee_in_stroops: number;
  base_reserve_in_stroops: number;
}

interface HorizonLedgerCollection {
  _embedded: {
    records: HorizonLedgerRecord[];
  };
}

interface HorizonThresholds {
  low_threshold: number;
  med_threshold: number;
  high_threshold: number;
}

interface HorizonFlags {
  auth_required: boolean;
  auth_revocable: boolean;
  auth_immutable: boolean;
  auth_clawback_enabled: boolean;
}

interface HorizonSigner {
  key: string;
  weight: number;
  type: string;
}

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

interface HorizonAccountRecord {
  account_id: string;
  sequence: string;
  subentry_count: number;
  num_sponsoring: number;
  num_sponsored: number;
  thresholds: HorizonThresholds;
  flags: HorizonFlags;
  signers: HorizonSigner[];
  balances: HorizonBalance[];
}

interface StableLedgerCheckpoint {
  sequence: number;
  closedAt: string;
  baseFeeStroops: bigint;
  baseReserveStroops: bigint;
}

/**
 * Reads the Testnet state needed to prepare one Shared Issuer issuance without
 * mutating either the issuer or the customer wallet.
 *
 * The reader brackets account reads with the same latest-ledger checkpoint.
 * If a ledger closes during the preflight window, the whole observation fails
 * closed and can be repeated before any transaction is built or signed.
 */
export class OfficialStellarTestnetIssuancePreflightReader {
  constructor(private readonly fetchImpl: FetchLike = globalThis.fetch) {}

  async readIssuancePreconditions(
    request: SharedIssuerTestnetPreflightRequest,
  ): Promise<SharedIssuerTestnetPreflightResult> {
    const issuerPublicKey = normalizePublicKey(
      request.issuerPublicKey,
      "invalid_issuer",
    );
    const destinationPublicKey = normalizePublicKey(
      request.destinationPublicKey,
      "invalid_destination",
    );
    if (issuerPublicKey === destinationPublicKey) {
      throw new SharedIssuerTestnetPreflightError(
        "invalid_destination",
        "Customer destination must be different from the Shared Issuer.",
      );
    }

    const assetCode = request.assetCode.trim().toUpperCase();
    if (!ASSET_CODE_PATTERN.test(assetCode)) {
      throw new SharedIssuerTestnetPreflightError(
        "invalid_asset_code",
        "Asset code must contain 1-12 uppercase alphanumeric characters.",
      );
    }

    const feeStroops = parsePositiveInteger(request.feeStroops, "invalid_fee");

    const before = await this.readLatestLedger();
    const [issuer, destination] = await Promise.all([
      this.readAccount(issuerPublicKey, "issuer_not_found"),
      this.readAccount(destinationPublicKey, "destination_not_found"),
    ]);
    const after = await this.readLatestLedger();

    if (
      after.sequence !== before.sequence ||
      after.closedAt !== before.closedAt ||
      after.baseFeeStroops !== before.baseFeeStroops ||
      after.baseReserveStroops !== before.baseReserveStroops
    ) {
      throw new SharedIssuerTestnetPreflightError(
        "preflight_ledger_advanced",
        "The Testnet ledger changed during preflight; discard this observation and read a fresh snapshot before construction.",
      );
    }

    assertIssuerPolicy(issuer, issuerPublicKey);

    if (feeStroops < before.baseFeeStroops) {
      throw new SharedIssuerTestnetPreflightError(
        "fee_below_network_minimum",
        "Configured transaction fee is below the stable Testnet ledger base fee.",
      );
    }

    const issuerSpendableNativeStroops = computeSpendableNativeStroops(
      issuer,
      before.baseReserveStroops,
    );
    if (issuerSpendableNativeStroops < feeStroops) {
      throw new SharedIssuerTestnetPreflightError(
        "insufficient_issuer_native_balance",
        "Shared Issuer does not have enough spendable XLM for the configured transaction fee.",
      );
    }

    const destinationTrustline = buildTrustlineSnapshot(
      destination,
      destinationPublicKey,
      assetCode,
      issuerPublicKey,
      before.sequence,
    );

    return {
      network: SHARED_ISSUER_TESTNET_NETWORK,
      networkPassphrase: Networks.TESTNET,
      observedLedger: before.sequence,
      observedLedgerClosedAt: before.closedAt,
      baseFeeStroops: before.baseFeeStroops.toString(),
      baseReserveStroops: before.baseReserveStroops.toString(),
      preconditions: {
        assetCodeReservedForProject: request.assetCodeReservedForProject,
        issuerSequence: normalizeSequence(issuer.sequence),
        issuerSpendableNativeStroops: issuerSpendableNativeStroops.toString(),
        feeStroops: feeStroops.toString(),
        destinationTrustline,
      },
    };
  }

  private async readLatestLedger(): Promise<StableLedgerCheckpoint> {
    const response = await this.request("/ledgers?order=desc&limit=1");

    if (!response.ok) {
      throw new SharedIssuerTestnetPreflightError(
        "horizon_unavailable",
        "Official Stellar Testnet Horizon latest-ledger lookup failed.",
        response.status,
      );
    }

    const collection = await parseJson<HorizonLedgerCollection>(response);
    const record = collection._embedded?.records?.[0];
    if (
      !record ||
      !Number.isSafeInteger(record.sequence) ||
      record.sequence <= 0 ||
      typeof record.closed_at !== "string" ||
      !Number.isSafeInteger(record.base_fee_in_stroops) ||
      record.base_fee_in_stroops <= 0 ||
      !Number.isSafeInteger(record.base_reserve_in_stroops) ||
      record.base_reserve_in_stroops <= 0
    ) {
      throw malformed(
        "Official Horizon returned malformed ledger preflight data.",
      );
    }

    return {
      sequence: record.sequence,
      closedAt: normalizeTimestamp(record.closed_at),
      baseFeeStroops: BigInt(record.base_fee_in_stroops),
      baseReserveStroops: BigInt(record.base_reserve_in_stroops),
    };
  }

  private async readAccount(
    publicKey: string,
    notFoundCode: "issuer_not_found" | "destination_not_found",
  ): Promise<HorizonAccountRecord> {
    const response = await this.request(`/accounts/${publicKey}`);
    if (response.status === 404) {
      throw new SharedIssuerTestnetPreflightError(
        notFoundCode,
        notFoundCode === "issuer_not_found"
          ? "The approved Testnet Shared Issuer account does not exist."
          : "The authenticated owner destination does not exist on Testnet.",
        response.status,
      );
    }

    if (!response.ok) {
      throw new SharedIssuerTestnetPreflightError(
        "horizon_unavailable",
        "Official Stellar Testnet Horizon account lookup failed.",
        response.status,
      );
    }

    const account = await parseJson<HorizonAccountRecord>(response);
    assertAccountShape(account, publicKey);
    return account;
  }

  private async request(path: string): Promise<Response> {
    const url = new URL(path, OFFICIAL_STELLAR_TESTNET_HORIZON_URL);
    try {
      return await this.fetchImpl(url, {
        method: "GET",
        headers: { accept: "application/json" },
        cache: "no-store",
        redirect: "error",
      });
    } catch {
      throw new SharedIssuerTestnetPreflightError(
        "horizon_unavailable",
        "Official Stellar Testnet Horizon could not be reached.",
      );
    }
  }
}

function assertIssuerPolicy(
  account: HorizonAccountRecord,
  issuerPublicKey: string,
): void {
  const flags = account.flags;
  const thresholds = account.thresholds;
  const signer = account.signers[0];

  if (
    flags.auth_required !== false ||
    flags.auth_revocable !== false ||
    flags.auth_clawback_enabled !== false ||
    flags.auth_immutable !== false ||
    thresholds.low_threshold !== 1 ||
    thresholds.med_threshold !== 1 ||
    thresholds.high_threshold !== 1 ||
    account.signers.length !== 1 ||
    !signer ||
    signer.key !== issuerPublicKey ||
    signer.weight !== 1 ||
    signer.type !== "ed25519_public_key"
  ) {
    throw new SharedIssuerTestnetPreflightError(
      "issuer_policy_mismatch",
      "Shared Issuer account flags, thresholds, or signer set do not match the owner-approved Testnet MVP Lite policy.",
    );
  }
}

function computeSpendableNativeStroops(
  account: HorizonAccountRecord,
  baseReserveStroops: bigint,
): bigint {
  const native = account.balances.find(
    (balance) => balance.asset_type === "native",
  );
  if (!native) {
    throw malformed("Shared Issuer account is missing its native XLM balance.");
  }

  const balance = parseStellarAmount(native.balance);
  const sellingLiabilities = parseStellarAmount(
    native.selling_liabilities ?? "0.0000000",
  );
  const reserveUnits =
    2n +
    BigInt(account.subentry_count) +
    BigInt(account.num_sponsoring) -
    BigInt(account.num_sponsored);

  if (reserveUnits < 0n) {
    throw malformed("Shared Issuer reserve counters are inconsistent.");
  }

  const spendable =
    balance - reserveUnits * baseReserveStroops - sellingLiabilities;
  if (spendable < 0n) {
    throw malformed(
      "Shared Issuer native balance is below its reserve and selling liabilities.",
    );
  }
  return spendable;
}

function buildTrustlineSnapshot(
  account: HorizonAccountRecord,
  destinationPublicKey: string,
  assetCode: string,
  issuerPublicKey: string,
  observedLedger: number,
): SharedIssuerTrustlineSnapshot {
  const trustline = account.balances.find(
    (balance) =>
      balance.asset_type !== "native" &&
      balance.asset_code === assetCode &&
      balance.asset_issuer === issuerPublicKey,
  );

  if (!trustline) {
    return {
      network: SHARED_ISSUER_TESTNET_NETWORK,
      networkPassphrase: Networks.TESTNET,
      destinationPublicKey,
      assetCode,
      issuerPublicKey,
      observedLedger,
      exists: false,
      authorized: false,
      balance: "0.0000000",
      limit: "0.0000000",
      buyingLiabilities: "0.0000000",
    };
  }

  if (
    typeof trustline.limit !== "string" ||
    typeof trustline.buying_liabilities !== "string" ||
    typeof trustline.is_authorized !== "boolean"
  ) {
    throw malformed("Official Horizon returned malformed trustline data.");
  }

  parseStellarAmount(trustline.balance);
  parseStellarAmount(trustline.limit);
  parseStellarAmount(trustline.buying_liabilities);

  return {
    network: SHARED_ISSUER_TESTNET_NETWORK,
    networkPassphrase: Networks.TESTNET,
    destinationPublicKey,
    assetCode,
    issuerPublicKey,
    observedLedger,
    exists: true,
    authorized: trustline.is_authorized,
    balance: trustline.balance,
    limit: trustline.limit,
    buyingLiabilities: trustline.buying_liabilities,
  };
}

function assertAccountShape(
  account: HorizonAccountRecord,
  expectedPublicKey: string,
): void {
  if (
    account.account_id !== expectedPublicKey ||
    typeof account.sequence !== "string" ||
    !INTEGER_PATTERN.test(account.sequence) ||
    !Number.isSafeInteger(account.subentry_count) ||
    account.subentry_count < 0 ||
    !Number.isSafeInteger(account.num_sponsoring) ||
    account.num_sponsoring < 0 ||
    !Number.isSafeInteger(account.num_sponsored) ||
    account.num_sponsored < 0 ||
    !account.thresholds ||
    !account.flags ||
    !Array.isArray(account.signers) ||
    !Array.isArray(account.balances)
  ) {
    throw malformed(
      "Official Horizon returned malformed account preflight data.",
    );
  }
}

function normalizePublicKey(
  value: string,
  code: "invalid_issuer" | "invalid_destination",
): string {
  try {
    return Keypair.fromPublicKey(value.trim().toUpperCase()).publicKey();
  } catch {
    throw new SharedIssuerTestnetPreflightError(
      code,
      code === "invalid_issuer"
        ? "Expected a checksum-valid Shared Issuer public key."
        : "Expected a checksum-valid owner destination public key.",
    );
  }
}

function normalizeSequence(value: string): string {
  if (!INTEGER_PATTERN.test(value)) {
    throw malformed("Official Horizon returned an invalid issuer sequence.");
  }
  return BigInt(value).toString();
}

function parsePositiveInteger(value: string, code: "invalid_fee"): bigint {
  if (!INTEGER_PATTERN.test(value)) {
    throw new SharedIssuerTestnetPreflightError(
      code,
      "Configured fee must be a positive integer number of stroops.",
    );
  }
  const parsed = BigInt(value);
  if (parsed <= 0n) {
    throw new SharedIssuerTestnetPreflightError(
      code,
      "Configured fee must be a positive integer number of stroops.",
    );
  }
  return parsed;
}

function parseStellarAmount(value: string): bigint {
  const match = STELLAR_AMOUNT_PATTERN.exec(value);
  if (!match) {
    throw malformed("Official Horizon returned a malformed Stellar amount.");
  }
  const whole = BigInt(match[1]);
  const fractional = BigInt(match[2]);
  return whole * STROOPS_PER_XLM + fractional;
}

function normalizeTimestamp(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw malformed("Official Horizon returned an invalid ledger close time.");
  }
  return new Date(timestamp).toISOString();
}

async function parseJson<T>(response: Response): Promise<T> {
  try {
    const value: unknown = await response.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("expected object");
    }
    return value as T;
  } catch {
    throw malformed("Official Horizon returned malformed JSON.");
  }
}

function malformed(message: string): SharedIssuerTestnetPreflightError {
  return new SharedIssuerTestnetPreflightError(
    "malformed_horizon_response",
    message,
  );
}
