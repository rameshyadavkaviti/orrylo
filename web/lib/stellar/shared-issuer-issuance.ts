import { createHash } from "node:crypto";

import {
  Account,
  Asset,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";

import { isKnownRyloIssuerPublicKey } from "../product/constants";

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
  | "rylo_issuer_forbidden"
  | "invalid_destination"
  | "issuer_destination_conflict"
  | "invalid_amount"
  | "asset_code_not_reserved"
  | "trustline_missing"
  | "trustline_unauthorized"
  | "trustline_capacity_exceeded"
  | "trustline_snapshot_mismatch"
  | "invalid_ledger_observation"
  | "invalid_sequence"
  | "invalid_fee"
  | "insufficient_fee_balance"
  | "invalid_timebounds"
  | "canonical_plan_mismatch"
  | "signed_envelope_invalid"
  | "signed_envelope_mismatch"
  | "unauthorized_signing_request"
  | "invalid_signer_authorization"
  | "missing_required_signatures"
  | "invalid_signature"
  | "issuance_intent_mismatch"
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
  network: typeof SHARED_ISSUER_TESTNET_NETWORK;
  networkPassphrase: typeof SHARED_ISSUER_TESTNET_PASSPHRASE;
  destinationPublicKey: string;
  assetCode: string;
  issuerPublicKey: string;
  observedLedger: number;
  exists: boolean;
  authorized: boolean;
  balance: string;
  limit: string;
  buyingLiabilities: string;
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

export interface SharedIssuerApprovedSigner {
  publicKey: string;
  weight: number;
}

export interface SharedIssuerSignerAuthorization {
  network: typeof SHARED_ISSUER_TESTNET_NETWORK;
  networkPassphrase: string;
  issuerPublicKey: string;
  requiredWeight: number;
  signers: SharedIssuerApprovedSigner[];
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
  | { status: "failed"; hash: string; ledger: number }
  | {
      status: "not_found";
      observedLedger: number;
      authoritative: boolean;
    };

export type SharedIssuerRecoveryDecision =
  | { action: "confirmed"; hash: string; ledger: number }
  | { action: "terminal_failure"; hash: string; ledger: number }
  | { action: "retry_same_envelope" }
  | { action: "await_authoritative_reconciliation" }
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
  assertSharedIssuerIdentitySeparated(issuerPublicKey);
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

  assertTrustlineSnapshotIdentity(
    preconditions.destinationTrustline,
    destinationPublicKey,
    assetCode,
    issuerPublicKey,
  );

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
  const buyingLiabilities = parseAssetUnits(
    preconditions.destinationTrustline.buyingLiabilities,
    true,
  );

  if (trustlineBalance + buyingLiabilities + amountUnits > trustlineLimit) {
    throw new SharedIssuerIssuanceError(
      "trustline_capacity_exceeded",
      "Issuance would exceed destination trustline capacity after buying liabilities.",
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
    intentFingerprint: hashSharedIssuerIssuanceIntent(intent),
    sourceSequence,
    validFrom: request.validFrom,
    validUntil: request.validUntil,
    feeStroops: feeStroops.toString(),
    unsignedEnvelopeXdr: transaction.toXDR(),
    transactionHash: Buffer.from(transaction.hash()).toString("hex"),
  };
}

export function assertSharedIssuerIssuancePlanCanonical(
  plan: SharedIssuerIssuancePlan,
): void {
  assertSharedIssuerIdentitySeparated(plan.intent.issuerPublicKey);

  try {
    const issuerPublicKey = normalizePublicKey(
      plan.intent.issuerPublicKey,
      "invalid_issuer",
    );
    const destinationPublicKey = normalizePublicKey(
      plan.intent.destinationPublicKey,
      "invalid_destination",
    );
    const amountUnits = parseAssetUnits(plan.intent.amount, false);
    const sourceSequence = parseSequence(plan.sourceSequence);
    const feeStroops = parsePositiveInteger(plan.feeStroops, "invalid_fee");

    if (
      plan.intent.policyVersion !== SHARED_ISSUANCE_POLICY_VERSION ||
      plan.intent.network !== SHARED_ISSUER_TESTNET_NETWORK ||
      typeof plan.intent.projectId !== "string" ||
      !plan.intent.projectId ||
      plan.intent.projectId.trim() !== plan.intent.projectId ||
      issuerPublicKey !== plan.intent.issuerPublicKey ||
      destinationPublicKey !== plan.intent.destinationPublicKey ||
      destinationPublicKey === issuerPublicKey ||
      !ASSET_CODE_PATTERN.test(plan.intent.assetCode) ||
      formatAssetUnits(amountUnits) !== plan.intent.amount ||
      sourceSequence !== plan.sourceSequence ||
      feeStroops.toString() !== plan.feeStroops ||
      !Number.isSafeInteger(plan.validFrom) ||
      !Number.isSafeInteger(plan.validUntil) ||
      plan.validFrom < 0 ||
      plan.validUntil <= plan.validFrom ||
      plan.intentFingerprint !== hashSharedIssuerIssuanceIntent(plan.intent)
    ) {
      throw new Error("invalid canonical plan metadata");
    }

    const rebuilt = new TransactionBuilder(
      new Account(issuerPublicKey, sourceSequence),
      {
        fee: feeStroops.toString(),
        networkPassphrase: SHARED_ISSUER_TESTNET_PASSPHRASE,
      },
    )
      .addOperation(
        Operation.payment({
          destination: destinationPublicKey,
          asset: new Asset(plan.intent.assetCode, issuerPublicKey),
          amount: plan.intent.amount,
        }),
      )
      .setTimebounds(plan.validFrom, plan.validUntil)
      .build();

    if (
      rebuilt.toXDR() !== plan.unsignedEnvelopeXdr ||
      Buffer.from(rebuilt.hash()).toString("hex") !== plan.transactionHash
    ) {
      throw new Error("canonical transaction body mismatch");
    }
  } catch {
    throw new SharedIssuerIssuanceError(
      "canonical_plan_mismatch",
      "Issuance plan is not the exact one-payment Testnet transaction authorized by its immutable intent.",
    );
  }
}

export function createSharedIssuerSigningRequest(
  plan: SharedIssuerIssuancePlan,
): SharedIssuerSigningRequest {
  assertSharedIssuerIssuancePlanCanonical(plan);

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
  assertSharedIssuerIssuancePlanCanonical(plan);

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
  assertSharedIssuerIssuancePlanCanonical(plan);

  let transactionHash: string;

  try {
    const transaction = TransactionBuilder.fromXDR(
      signedEnvelopeXdr,
      SHARED_ISSUER_TESTNET_PASSPHRASE,
    );
    transactionHash = Buffer.from(transaction.hash()).toString("hex");
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

export function assertSignedEnvelopeAuthorizedForSubmission(
  signedEnvelopeXdr: string,
  plan: SharedIssuerIssuancePlan,
  authorization: SharedIssuerSignerAuthorization,
): string {
  const transactionHash = assertSignedEnvelopeMatchesPlan(
    signedEnvelopeXdr,
    plan,
  );

  if (
    authorization.network !== SHARED_ISSUER_TESTNET_NETWORK ||
    authorization.networkPassphrase !== SHARED_ISSUER_TESTNET_PASSPHRASE ||
    normalizePublicKey(authorization.issuerPublicKey, "invalid_issuer") !==
      plan.intent.issuerPublicKey ||
    !Number.isSafeInteger(authorization.requiredWeight) ||
    authorization.requiredWeight <= 0 ||
    authorization.signers.length === 0
  ) {
    throw new SharedIssuerIssuanceError(
      "invalid_signer_authorization",
      "Approved signer authorization does not match the issuance plan.",
    );
  }

  const approvedSigners = new Map<
    string,
    { keypair: Keypair; weight: number }
  >();

  for (const signer of authorization.signers) {
    const publicKey = normalizePublicKey(signer.publicKey, "invalid_issuer");

    if (
      !Number.isSafeInteger(signer.weight) ||
      signer.weight <= 0 ||
      approvedSigners.has(publicKey)
    ) {
      throw new SharedIssuerIssuanceError(
        "invalid_signer_authorization",
        "Approved signer configuration contains an invalid or duplicate signer.",
      );
    }

    approvedSigners.set(publicKey, {
      keypair: Keypair.fromPublicKey(publicKey),
      weight: signer.weight,
    });
  }

  let transaction;

  try {
    transaction = TransactionBuilder.fromXDR(
      signedEnvelopeXdr,
      SHARED_ISSUER_TESTNET_PASSPHRASE,
    );
  } catch {
    throw new SharedIssuerIssuanceError(
      "signed_envelope_invalid",
      "Signed envelope is not valid Stellar Testnet transaction XDR.",
    );
  }

  if (transaction.signatures.length === 0) {
    throw new SharedIssuerIssuanceError(
      "missing_required_signatures",
      "Signed envelope contains no Stellar signatures.",
    );
  }

  const transactionHashBytes = Buffer.from(transaction.hash());
  const matchedSignerKeys = new Set<string>();
  let approvedWeight = 0;

  for (const signature of transaction.signatures) {
    let matchedPublicKey: string | null = null;

    for (const [publicKey, signer] of approvedSigners) {
      if (
        !matchedSignerKeys.has(publicKey) &&
        Buffer.from(signature.hint.toBytes()).equals(
          Buffer.from(signer.keypair.signatureHint()),
        ) &&
        signer.keypair.verify(transactionHashBytes, signature.signature)
      ) {
        matchedPublicKey = publicKey;
        approvedWeight += signer.weight;
        matchedSignerKeys.add(publicKey);
        break;
      }
    }

    if (!matchedPublicKey) {
      throw new SharedIssuerIssuanceError(
        "invalid_signature",
        "Envelope contains a missing, duplicate, unknown, or invalid approved-signer signature.",
      );
    }
  }

  if (approvedWeight < authorization.requiredWeight) {
    throw new SharedIssuerIssuanceError(
      "missing_required_signatures",
      "Envelope does not satisfy the approved issuer signer threshold.",
    );
  }

  return transactionHash;
}

export function assertReplacementPreservesIssuanceIntent(
  originalPlan: SharedIssuerIssuancePlan,
  replacementPlan: SharedIssuerIssuancePlan,
): void {
  if (
    originalPlan.intentFingerprint !== replacementPlan.intentFingerprint ||
    JSON.stringify(originalPlan.intent) !==
      JSON.stringify(replacementPlan.intent)
  ) {
    throw new SharedIssuerIssuanceError(
      "issuance_intent_mismatch",
      "Replacement transaction must preserve the immutable logical issuance intent.",
    );
  }
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
      ledger: input.lookup.ledger,
    };
  }

  assertLedgerObservation(input.lookup.observedLedger);

  const currentSequence = BigInt(parseSequence(input.currentIssuerSequence));
  const plannedSourceSequence = BigInt(input.plan.sourceSequence);

  if (currentSequence > plannedSourceSequence) {
    return { action: "reconcile_sequence" };
  }

  if (currentSequence < plannedSourceSequence) {
    throw new SharedIssuerIssuanceError(
      "sequence_conflict",
      "Observed issuer sequence moved backwards relative to the prepared transaction.",
    );
  }

  if (input.nowUnix < input.plan.validUntil) {
    return { action: "retry_same_envelope" };
  }

  if (!input.lookup.authoritative) {
    return { action: "await_authoritative_reconciliation" };
  }

  return { action: "rebuild_expired" };
}

function assertTrustlineSnapshotIdentity(
  snapshot: SharedIssuerTrustlineSnapshot,
  destinationPublicKey: string,
  assetCode: string,
  issuerPublicKey: string,
): void {
  assertLedgerObservation(snapshot.observedLedger);

  let snapshotDestination: string;
  let snapshotIssuer: string;

  try {
    snapshotDestination = Keypair.fromPublicKey(
      snapshot.destinationPublicKey.trim().toUpperCase(),
    ).publicKey();
    snapshotIssuer = Keypair.fromPublicKey(
      snapshot.issuerPublicKey.trim().toUpperCase(),
    ).publicKey();
  } catch {
    throw new SharedIssuerIssuanceError(
      "trustline_snapshot_mismatch",
      "Trustline snapshot contains an invalid Stellar identity.",
    );
  }

  if (
    snapshot.network !== SHARED_ISSUER_TESTNET_NETWORK ||
    snapshot.networkPassphrase !== SHARED_ISSUER_TESTNET_PASSPHRASE ||
    snapshotDestination !== destinationPublicKey ||
    snapshot.assetCode.trim().toUpperCase() !== assetCode ||
    snapshotIssuer !== issuerPublicKey
  ) {
    throw new SharedIssuerIssuanceError(
      "trustline_snapshot_mismatch",
      "Trustline snapshot does not match the requested Testnet asset identity.",
    );
  }
}

function assertLedgerObservation(observedLedger: number): void {
  if (!Number.isSafeInteger(observedLedger) || observedLedger <= 0) {
    throw new SharedIssuerIssuanceError(
      "invalid_ledger_observation",
      "Ledger observation must identify a positive integer ledger sequence.",
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

export function hashSharedIssuerIssuanceIntent(
  intent: SharedIssuerIssuanceIntent,
): string {
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

function assertSharedIssuerIdentitySeparated(issuerPublicKey: string): void {
  if (isKnownRyloIssuerPublicKey(issuerPublicKey)) {
    throw new SharedIssuerIssuanceError(
      "rylo_issuer_forbidden",
      "Known RYLO issuer identities cannot issue customer Shared Issuer assets.",
    );
  }
}
