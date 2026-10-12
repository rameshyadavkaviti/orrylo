import { createHash } from "node:crypto";

import {
  Account,
  Asset,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";

export const SHARED_ISSUER_TESTNET_NETWORK = "testnet" as const;
export const SHARED_ISSUER_TESTNET_PASSPHRASE = Networks.TESTNET;
export const SHARED_ISSUANCE_POLICY_VERSION = "shared-issuer-testnet-v1";

const ASSET_CODE_PATTERN = /^[A-Z0-9]{1,12}$/;
const STROOPS_PER_UNIT = 10_000_000n;

export type SharedIssuerIssuanceErrorCode =
  | "invalid_network"
  | "invalid_network_passphrase"
  | "invalid_project_id"
  | "invalid_asset_code"
  | "invalid_issuer"
  | "invalid_destination"
  | "issuer_destination_conflict"
  | "invalid_amount"
  | "asset_code_not_reserved"
  | "trustline_missing"
  | "trustline_unauthorized"
  | "trustline_capacity_exceeded"
  | "invalid_sequence"
  | "invalid_fee"
  | "insufficient_fee_balance"
  | "invalid_timebounds"
  | "signed_envelope_invalid"
  | "signed_envelope_mismatch"
  | "unauthorized_signing_request"
  | "submission_hash_mismatch"
  | "sequence_conflict";

export class SharedIssuerIssuanceError extends Error {
  constructor(
    readonly code: SharedIssuerIssuanceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SharedIssuerIssuanceError";
  }
}

export interface SharedIssuerIssuanceRequest {
  projectId: string;
  assetCode: string;
  issuerPublicKey: string;
  destinationPublicKey: string;
  amount: string;
  network: "testnet";
  networkPassphrase: string;
  validFrom: number;
  validUntil: number;
}

export interface SharedIssuerTrustlineSnapshot {
  exists: boolean;
  authorized: boolean;
  balance: string;
  limit: string;
}

export interface SharedIssuerIssuancePreconditions {
  assetCodeReservedForProject: boolean;
  issuerSequence: string;
  issuerSpendableNativeStroops: string;
  feeStroops: string;
  destinationTrustline: SharedIssuerTrustlineSnapshot;
}

export interface SharedIssuerIssuanceIntent {
  policyVersion: typeof SHARED_ISSUANCE_POLICY_VERSION;
  projectId: string;
  network: typeof SHARED_ISSUER_TESTNET_NETWORK;
  assetCode: string;
  issuerPublicKey: string;
  destinationPublicKey: string;
  amount: string;
}

export interface SharedIssuerIssuancePlan {
  intent: SharedIssuerIssuanceIntent;
  intentFingerprint: string;
  sourceSequence: string;
  validFrom: number;
  validUntil: number;
  feeStroops: string;
  unsignedEnvelopeXdr: string;
  transactionHash: string;
}

export interface SharedIssuerSigningRequest {
  policyVersion: typeof SHARED_ISSUANCE_POLICY_VERSION;
  issuerPublicKey: string;
  network: typeof SHARED_ISSUER_TESTNET_NETWORK;
  networkPassphrase: typeof SHARED_ISSUER_TESTNET_PASSPHRASE;
  transactionHash: string;
  unsignedEnvelopeXdr: string;
}

export interface SharedIssuerSigner {
  signCanonicalEnvelope(
    request: SharedIssuerSigningRequest,
  ): Promise<{ signedEnvelopeXdr: string }>;
}

export interface SharedIssuerSubmissionResult {
  hash: string;
}

export interface SharedIssuerSubmissionAdapter {
  submitSignedEnvelope(
    signedEnvelopeXdr: string,
  ): Promise<SharedIssuerSubmissionResult>;
}

export type SharedIssuerTransactionLookup =
  | { status: "confirmed"; hash: string; ledger: number }
  | { status: "failed"; hash: string }
  | { status: "not_found" };

export type SharedIssuerRecoveryDecision =
  | { action: "confirmed"; hash: string; ledger: number }
  | { action: "terminal_failure"; hash: string }
  | { action: "retry_same_envelope" }
  | { action: "rebuild_expired" }
  | { action: "reconcile_sequence" };

export function buildSharedIssuerIssuancePlan(
  request: SharedIssuerIssuanceRequest,
  preconditions: SharedIssuerIssuancePreconditions,
): SharedIssuerIssuancePlan {
  if (request.network !== SHARED_ISSUER_TESTNET_NETWORK) {
    throw new SharedIssuerIssuanceError(
      "invalid_network",
      "Shared Issuer issuance is Testnet-only in this phase.",
    );
  }

  if (request.networkPassphrase !== SHARED_ISSUER_TESTNET_PASSPHRASE) {
    throw new SharedIssuerIssuanceError(
      "invalid_network_passphrase",
      "Shared Issuer issuance requires the Stellar Testnet network passphrase.",
    );
  }

  const projectId = request.projectId.trim();
  if (!projectId) {
    throw new SharedIssuerIssuanceError(
      "invalid_project_id",
      "Project ID is required.",
    );
  }

  const assetCode = request.assetCode.trim().toUpperCase();
  if (!ASSET_CODE_PATTERN.test(assetCode)) {
    throw new SharedIssuerIssuanceError(
      "invalid_asset_code",
      "Asset code must contain 1-12 uppercase alphanumeric characters.",
    );
  }

  const issuerPublicKey = normalizePublicKey(
    request.issuerPublicKey,
    "invalid_issuer",
  );
  const destinationPublicKey = normalizePublicKey(
    request.destinationPublicKey,
    "invalid_destination",
  );

  if (issuerPublicKey === destinationPublicKey) {
    throw new SharedIssuerIssuanceError(
      "issuer_destination_conflict",
      "Issuer and customer destination must be different Stellar accounts.",
    );
  }

  const amountUnits = parseAssetUnits(request.amount, false);
  const amount = formatAssetUnits(amountUnits);

  if (!preconditions.assetCodeReservedForProject) {
    throw new SharedIssuerIssuanceError(
      "asset_code_not_reserved",
      "The application must atomically reserve this asset code for the project before transaction preparation.",
    );
  }

  if (!preconditions.destinationTrustline.exists) {
    throw new SharedIssuerIssuanceError(
      "trustline_missing",
      "Destination must already have a trustline for the exact asset identity.",
    );
  }

  if (!preconditions.destinationTrustline.authorized) {
    throw new SharedIssuerIssuanceError(
      "trustline_unauthorized",
      "Destination trustline is not authorized to receive the asset.",
    );
  }

  const trustlineBalance = parseAssetUnits(
    preconditions.destinationTrustline.balance,
    true,
  );
  const trustlineLimit = parseAssetUnits(
    preconditions.destinationTrustline.limit,
    false,
  );

  if (trustlineBalance + amountUnits > trustlineLimit) {
    throw new SharedIssuerIssuanceError(
      "trustline_capacity_exceeded",
      "Issuance would exceed the destination trustline limit.",
    );
  }

  const sourceSequence = parseSequence(preconditions.issuerSequence);
  const feeStroops = parsePositiveInteger(
    preconditions.feeStroops,
    "invalid_fee",
  );
  const spendableStroops = parseNonNegativeInteger(
    preconditions.issuerSpendableNativeStroops,
    "invalid_fee",
  );

  if (spendableStroops < feeStroops) {
    throw new SharedIssuerIssuanceError(
      "insufficient_fee_balance",
      "Issuer does not have enough spendable XLM for the transaction fee.",
    );
  }

  if (
    !Number.isSafeInteger(request.validFrom) ||
    !Number.isSafeInteger(request.validUntil) ||
    request.validFrom < 0 ||
    request.validUntil <= request.validFrom
  ) {
    throw new SharedIssuerIssuanceError(
      "invalid_timebounds",
      "Transaction time bounds must be explicit increasing Unix-second values.",
    );
  }

  const account = new Account(issuerPublicKey, sourceSequence);
  const asset = new Asset(assetCode, issuerPublicKey);
  const transaction = new TransactionBuilder(account, {
    fee: feeStroops.toString(),
    networkPassphrase: SHARED_ISSUER_TESTNET_PASSPHRASE,
  })
    .addOperation(
      Operation.payment({
        destination: destinationPublicKey,
        asset,
        amount,
      }),
    )
    .setTimebounds(request.validFrom, request.validUntil)
    .build();

  const intent: SharedIssuerIssuanceIntent = {
    policyVersion: SHARED_ISSUANCE_POLICY_VERSION,
    projectId,
    network: SHARED_ISSUER_TESTNET_NETWORK,
    assetCode,
    issuerPublicKey,
    destinationPublicKey,
    amount,
  };

  return {
    intent,
    intentFingerprint: hashIntent(intent),
    sourceSequence,
    validFrom: request.validFrom,
    validUntil: request.validUntil,
    feeStroops: feeStroops.toString(),
    unsignedEnvelopeXdr: transaction.toXDR(),
    transactionHash: transaction.hash().toString("hex"),
  };
}

export function createSharedIssuerSigningRequest(
  plan: SharedIssuerIssuancePlan,
): SharedIssuerSigningRequest {
  return {
    policyVersion: SHARED_ISSUANCE_POLICY_VERSION,
    issuerPublicKey: plan.intent.issuerPublicKey,
    network: SHARED_ISSUER_TESTNET_NETWORK,
    networkPassphrase: SHARED_ISSUER_TESTNET_PASSPHRASE,
    transactionHash: plan.transactionHash,
    unsignedEnvelopeXdr: plan.unsignedEnvelopeXdr,
  };
}

export function assertSigningRequestMatchesPlan(
  request: SharedIssuerSigningRequest,
  plan: SharedIssuerIssuancePlan,
): void {
  if (
    request.policyVersion !== SHARED_ISSUANCE_POLICY_VERSION ||
    request.issuerPublicKey !== plan.intent.issuerPublicKey ||
    request.network !== SHARED_ISSUER_TESTNET_NETWORK ||
    request.networkPassphrase !== SHARED_ISSUER_TESTNET_PASSPHRASE ||
    request.transactionHash !== plan.transactionHash ||
    request.unsignedEnvelopeXdr !== plan.unsignedEnvelopeXdr
  ) {
    throw new SharedIssuerIssuanceError(
      "unauthorized_signing_request",
      "Signing request does not match the reviewed canonical issuance plan.",
    );
  }
}

export function assertSignedEnvelopeMatchesPlan(
  signedEnvelopeXdr: string,
  plan: SharedIssuerIssuancePlan,
): string {
  let transactionHash: string;

  try {
    const transaction = TransactionBuilder.fromXDR(
      signedEnvelopeXdr,
      SHARED_ISSUER_TESTNET_PASSPHRASE,
    );
    transactionHash = transaction.hash().toString("hex");
  } catch {
    throw new SharedIssuerIssuanceError(
      "signed_envelope_invalid",
      "Signed envelope is not valid Stellar Testnet transaction XDR.",
    );
  }

  if (transactionHash !== plan.transactionHash) {
    throw new SharedIssuerIssuanceError(
      "signed_envelope_mismatch",
      "Signed envelope does not match the reviewed canonical transaction.",
    );
  }

  return transactionHash;
}

export function assertSubmissionHashMatchesPlan(
  submission: SharedIssuerSubmissionResult,
  plan: SharedIssuerIssuancePlan,
): void {
  if (submission.hash.toLowerCase() !== plan.transactionHash) {
    throw new SharedIssuerIssuanceError(
      "submission_hash_mismatch",
      "Submission response hash does not match the canonical transaction hash.",
    );
  }
}

export function classifySharedIssuerRecovery(input: {
  plan: SharedIssuerIssuancePlan;
  lookup: SharedIssuerTransactionLookup;
  currentIssuerSequence: string;
  nowUnix: number;
}): SharedIssuerRecoveryDecision {
  if (input.lookup.status !== "not_found") {
    if (input.lookup.hash.toLowerCase() !== input.plan.transactionHash) {
      throw new SharedIssuerIssuanceError(
        "submission_hash_mismatch",
        "Ledger lookup hash does not match the canonical transaction hash.",
      );
    }

    if (input.lookup.status === "confirmed") {
      return {
        action: "confirmed",
        hash: input.lookup.hash.toLowerCase(),
        ledger: input.lookup.ledger,
      };
    }

    return {
      action: "terminal_failure",
      hash: input.lookup.hash.toLowerCase(),
    };
  }

  if (input.nowUnix >= input.plan.validUntil) {
    return { action: "rebuild_expired" };
  }

  const currentSequence = parseSequence(input.currentIssuerSequence);
  const plannedSourceSequence = BigInt(input.plan.sourceSequence);

  if (currentSequence === plannedSourceSequence) {
    return { action: "retry_same_envelope" };
  }

  if (currentSequence > plannedSourceSequence) {
    return { action: "reconcile_sequence" };
  }

  throw new SharedIssuerIssuanceError(
    "sequence_conflict",
    "Observed issuer sequence moved backwards relative to the prepared transaction.",
  );
}

function normalizePublicKey(
  value: string,
  code: "invalid_issuer" | "invalid_destination",
): string {
  try {
    return Keypair.fromPublicKey(value.trim().toUpperCase()).publicKey();
  } catch {
    throw new SharedIssuerIssuanceError(
      code,
      "Expected a checksum-valid Stellar public key.",
    );
  }
}

function parseSequence(value: string): string {
  const sequence = parseNonNegativeInteger(value, "invalid_sequence");
  return sequence.toString();
}

function parsePositiveInteger(value: string, code: "invalid_fee"): bigint {
  const parsed = parseNonNegativeInteger(value, code);
  if (parsed <= 0n) {
    throw new SharedIssuerIssuanceError(code, "Expected a positive integer.");
  }
  return parsed;
}

function parseNonNegativeInteger(
  value: string,
  code: "invalid_fee" | "invalid_sequence",
): bigint {
  if (!/^[0-9]+$/.test(value)) {
    throw new SharedIssuerIssuanceError(
      code,
      "Expected a non-negative integer.",
    );
  }

  return BigInt(value);
}

function parseAssetUnits(value: string, allowZero: boolean): bigint {
  const match = /^([0-9]+)(?:\.([0-9]{1,7}))?$/.exec(value.trim());

  if (!match) {
    throw new SharedIssuerIssuanceError(
      "invalid_amount",
      "Asset amount must be a plain decimal with at most 7 fractional digits.",
    );
  }

  const whole = BigInt(match[1]);
  const fractional = BigInt((match[2] ?? "").padEnd(7, "0") || "0");
  const units = whole * STROOPS_PER_UNIT + fractional;

  if ((!allowZero && units <= 0n) || (allowZero && units < 0n)) {
    throw new SharedIssuerIssuanceError(
      "invalid_amount",
      "Asset amount must be positive.",
    );
  }

  return units;
}

function formatAssetUnits(units: bigint): string {
  const whole = units / STROOPS_PER_UNIT;
  const fractional = (units % STROOPS_PER_UNIT).toString().padStart(7, "0");
  return `${whole}.${fractional}`;
}

function hashIntent(intent: SharedIssuerIssuanceIntent): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        intent.policyVersion,
        intent.projectId,
        intent.network,
        intent.assetCode,
        intent.issuerPublicKey,
        intent.destinationPublicKey,
        intent.amount,
      ]),
      "utf8",
    )
    .digest("hex");
}
