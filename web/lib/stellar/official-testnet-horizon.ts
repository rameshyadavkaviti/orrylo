import {
  Keypair,
  Networks,
  Transaction,
  TransactionBuilder,
} from "@stellar/stellar-sdk";

import type {
  SharedIssuerSubmissionAdapter,
  SharedIssuerSubmissionResult,
} from "./shared-issuer-issuance";
import type {
  StellarTestnetAccountSequenceEvidence,
  StellarTestnetLedgerReader,
  StellarTestnetTransactionLookup,
} from "./testnet-ledger-confirmation";

export const OFFICIAL_STELLAR_TESTNET_HORIZON_URL =
  "https://horizon-testnet.stellar.org";

const HASH_PATTERN = /^[0-9a-f]{64}$/;
const NON_NEGATIVE_INTEGER_PATTERN = /^[0-9]+$/;

type FetchLike = typeof fetch;

export type OfficialTestnetHorizonErrorCode =
  | "invalid_transaction_hash"
  | "invalid_account"
  | "account_not_found"
  | "invalid_signed_envelope"
  | "horizon_unavailable"
  | "malformed_horizon_response"
  | "submission_reconciliation_required";

export class OfficialTestnetHorizonError extends Error {
  constructor(
    readonly code: OfficialTestnetHorizonErrorCode,
    message: string,
    readonly transactionHash?: string,
    readonly httpStatus?: number,
  ) {
    super(message);
    this.name = "OfficialTestnetHorizonError";
  }
}

interface LatestLedgerObservation {
  observedLedger: number;
  observedAt: string;
  observedLedgerClosedAt: string;
}

interface HorizonTransactionRecord {
  hash: string;
  ledger: number;
  created_at: string;
  successful: boolean;
  envelope_xdr?: string;
  result_xdr?: string;
}

interface HorizonAccountRecord {
  account_id: string;
  sequence: string;
}

interface HorizonLedgerRecord {
  sequence: number;
  closed_at: string;
}

interface HorizonLedgerCollection {
  _embedded: {
    records: HorizonLedgerRecord[];
  };
}

interface HorizonSubmissionRecord {
  hash: string;
}

/**
 * Read-only adapter for the fixed official Stellar Testnet Horizon endpoint.
 *
 * The endpoint cannot be overridden. The injected fetch implementation exists
 * only as an HTTP transport seam; every request is still constructed against
 * the fixed HTTPS origin and redirects are rejected.
 */
export class OfficialStellarTestnetHorizonReader implements StellarTestnetLedgerReader {
  readonly authority = "official_testnet_horizon" as const;

  constructor(
    private readonly fetchImpl: FetchLike = globalThis.fetch,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async lookupTransaction(
    transactionHash: string,
  ): Promise<StellarTestnetTransactionLookup> {
    const normalizedHash = normalizeTransactionHash(transactionHash);
    const response = await this.request(
      `/transactions/${normalizedHash}`,
      "GET",
    );

    if (response.status === 404) {
      const observation = await this.readLatestLedgerObservation();
      return {
        status: "not_found",
        network: "testnet",
        networkPassphrase: Networks.TESTNET,
        transactionHash: normalizedHash,
        ...observation,
      };
    }

    if (!response.ok) {
      throw new OfficialTestnetHorizonError(
        "horizon_unavailable",
        "Official Stellar Testnet Horizon transaction lookup failed.",
        normalizedHash,
        response.status,
      );
    }

    const record = await parseJson<HorizonTransactionRecord>(response);
    assertTransactionRecord(record, normalizedHash);

    const observation = await this.readLatestLedgerObservation();
    if (observation.observedLedger < record.ledger) {
      throw new OfficialTestnetHorizonError(
        "malformed_horizon_response",
        "Official Horizon returned a transaction newer than its latest ledger checkpoint.",
        normalizedHash,
      );
    }

    if (!record.successful) {
      return {
        status: "failed",
        network: "testnet",
        networkPassphrase: Networks.TESTNET,
        transactionHash: normalizedHash,
        ledgerSequence: record.ledger,
        ...observation,
      };
    }

    if (
      typeof record.envelope_xdr !== "string" ||
      !record.envelope_xdr ||
      typeof record.result_xdr !== "string" ||
      !record.result_xdr
    ) {
      throw new OfficialTestnetHorizonError(
        "malformed_horizon_response",
        "Successful Horizon transaction evidence is missing canonical XDR.",
        normalizedHash,
      );
    }

    return {
      status: "confirmed",
      network: "testnet",
      networkPassphrase: Networks.TESTNET,
      transactionHash: normalizedHash,
      resultTransactionHash: record.hash.toLowerCase(),
      envelopeXdr: record.envelope_xdr,
      resultXdr: record.result_xdr,
      ledgerSequence: record.ledger,
      ledgerClosedAt: normalizeTimestamp(record.created_at),
      ...observation,
    };
  }

  async readAccountSequence(
    accountPublicKey: string,
  ): Promise<StellarTestnetAccountSequenceEvidence> {
    const normalizedAccount = normalizeAccountPublicKey(accountPublicKey);
    const response = await this.request(
      `/accounts/${normalizedAccount}`,
      "GET",
    );

    if (response.status === 404) {
      throw new OfficialTestnetHorizonError(
        "account_not_found",
        "The expected Stellar Testnet account does not exist in official Horizon.",
      );
    }

    if (!response.ok) {
      throw new OfficialTestnetHorizonError(
        "horizon_unavailable",
        "Official Stellar Testnet Horizon account lookup failed.",
        undefined,
        response.status,
      );
    }

    const record = await parseJson<HorizonAccountRecord>(response);
    if (
      record.account_id !== normalizedAccount ||
      typeof record.sequence !== "string" ||
      !NON_NEGATIVE_INTEGER_PATTERN.test(record.sequence)
    ) {
      throw new OfficialTestnetHorizonError(
        "malformed_horizon_response",
        "Official Horizon returned malformed account sequence evidence.",
      );
    }

    const observation = await this.readLatestLedgerObservation();
    return {
      network: "testnet",
      networkPassphrase: Networks.TESTNET,
      accountPublicKey: normalizedAccount,
      sequence: BigInt(record.sequence).toString(),
      ...observation,
    };
  }

  private async readLatestLedgerObservation(): Promise<LatestLedgerObservation> {
    const response = await this.request("/ledgers?order=desc&limit=1", "GET");

    if (!response.ok) {
      throw new OfficialTestnetHorizonError(
        "horizon_unavailable",
        "Official Stellar Testnet Horizon latest-ledger lookup failed.",
        undefined,
        response.status,
      );
    }

    const collection = await parseJson<HorizonLedgerCollection>(response);
    const record = collection._embedded?.records?.[0];

    if (
      !record ||
      !Number.isSafeInteger(record.sequence) ||
      record.sequence <= 0 ||
      typeof record.closed_at !== "string"
    ) {
      throw new OfficialTestnetHorizonError(
        "malformed_horizon_response",
        "Official Horizon returned malformed latest-ledger evidence.",
      );
    }

    const observedLedgerClosedAt = normalizeTimestamp(record.closed_at);
    const observedAtMs = this.now();
    if (
      !Number.isFinite(observedAtMs) ||
      observedAtMs < Date.parse(observedLedgerClosedAt)
    ) {
      throw new OfficialTestnetHorizonError(
        "malformed_horizon_response",
        "Local observation time precedes the official Horizon ledger close time.",
      );
    }

    return {
      observedLedger: record.sequence,
      observedAt: new Date(observedAtMs).toISOString(),
      observedLedgerClosedAt,
    };
  }

  private async request(path: string, method: "GET"): Promise<Response> {
    const url = new URL(path, OFFICIAL_STELLAR_TESTNET_HORIZON_URL);
    try {
      return await this.fetchImpl(url, {
        method,
        headers: { accept: "application/json" },
        cache: "no-store",
        redirect: "error",
      });
    } catch {
      throw new OfficialTestnetHorizonError(
        "horizon_unavailable",
        "Official Stellar Testnet Horizon could not be reached.",
      );
    }
  }
}

/**
 * Submission-only adapter for the fixed official Stellar Testnet Horizon
 * endpoint. It never retries. Once the POST begins, every non-success outcome
 * is treated as reconciliation-required because the caller must resolve the
 * exact transaction hash before taking any further action.
 */
export class OfficialStellarTestnetHorizonSubmissionAdapter implements SharedIssuerSubmissionAdapter {
  constructor(private readonly fetchImpl: FetchLike = globalThis.fetch) {}

  async submitSignedEnvelope(
    signedEnvelopeXdr: string,
  ): Promise<SharedIssuerSubmissionResult> {
    const transaction = parseClassicTestnetTransaction(signedEnvelopeXdr);
    const transactionHash = Buffer.from(transaction.hash()).toString("hex");
    const url = new URL("/transactions", OFFICIAL_STELLAR_TESTNET_HORIZON_URL);

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ tx: signedEnvelopeXdr }).toString(),
        cache: "no-store",
        redirect: "error",
      });
    } catch {
      throw reconciliationRequired(transactionHash);
    }

    if (!response.ok) {
      throw reconciliationRequired(transactionHash, response.status);
    }

    let record: HorizonSubmissionRecord;
    try {
      record = await parseJson<HorizonSubmissionRecord>(response);
    } catch {
      throw reconciliationRequired(transactionHash, response.status);
    }

    if (
      typeof record.hash !== "string" ||
      !HASH_PATTERN.test(record.hash.toLowerCase()) ||
      record.hash.toLowerCase() !== transactionHash
    ) {
      throw reconciliationRequired(transactionHash, response.status);
    }

    return { hash: transactionHash };
  }
}

function parseClassicTestnetTransaction(
  signedEnvelopeXdr: string,
): Transaction {
  try {
    const transaction = TransactionBuilder.fromXDR(
      signedEnvelopeXdr,
      Networks.TESTNET,
    );
    if (!(transaction instanceof Transaction)) {
      throw new Error("fee bump transactions are not permitted");
    }
    return transaction;
  } catch {
    throw new OfficialTestnetHorizonError(
      "invalid_signed_envelope",
      "Submission requires one valid classic Stellar Testnet transaction envelope.",
    );
  }
}

function reconciliationRequired(
  transactionHash: string,
  httpStatus?: number,
): OfficialTestnetHorizonError {
  return new OfficialTestnetHorizonError(
    "submission_reconciliation_required",
    "Submission outcome is not trusted as final; reconcile the exact transaction hash before any further action.",
    transactionHash,
    httpStatus,
  );
}

function normalizeTransactionHash(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!HASH_PATTERN.test(normalized)) {
    throw new OfficialTestnetHorizonError(
      "invalid_transaction_hash",
      "Expected a 64-character hexadecimal Stellar transaction hash.",
    );
  }
  return normalized;
}

function normalizeAccountPublicKey(value: string): string {
  try {
    return Keypair.fromPublicKey(value.trim().toUpperCase()).publicKey();
  } catch {
    throw new OfficialTestnetHorizonError(
      "invalid_account",
      "Expected a checksum-valid Stellar account public key.",
    );
  }
}

function assertTransactionRecord(
  record: HorizonTransactionRecord,
  expectedHash: string,
): void {
  if (
    typeof record.hash !== "string" ||
    record.hash.toLowerCase() !== expectedHash ||
    !HASH_PATTERN.test(record.hash.toLowerCase()) ||
    !Number.isSafeInteger(record.ledger) ||
    record.ledger <= 0 ||
    typeof record.successful !== "boolean" ||
    typeof record.created_at !== "string"
  ) {
    throw new OfficialTestnetHorizonError(
      "malformed_horizon_response",
      "Official Horizon returned malformed or mismatched transaction evidence.",
      expectedHash,
    );
  }

  normalizeTimestamp(record.created_at);
}

function normalizeTimestamp(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new OfficialTestnetHorizonError(
      "malformed_horizon_response",
      "Official Horizon returned an invalid timestamp.",
    );
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
    throw new OfficialTestnetHorizonError(
      "malformed_horizon_response",
      "Official Horizon returned malformed JSON.",
    );
  }
}
