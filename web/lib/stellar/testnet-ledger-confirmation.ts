import { createHash } from "node:crypto";

import {
  Keypair,
  Transaction,
  TransactionBuilder,
  xdr,
} from "@stellar/stellar-sdk";

import type {
  ImmutableSharedIssuanceIntent,
  ImmutableSharedIssuanceLedgerConfirmation,
  ImmutableSharedIssuanceTransactionAttempt,
} from "../server/projects/shared-issuance-persistence";
import {
  SHARED_ISSUER_TESTNET_NETWORK,
  SHARED_ISSUER_TESTNET_PASSPHRASE,
  SHARED_ISSUANCE_POLICY_VERSION,
  classifySharedIssuerRecovery,
  hashSharedIssuerIssuanceIntent,
  type SharedIssuerIssuancePlan,
} from "./shared-issuer-issuance";

const TESTNET_PASSPHRASE_SHA256 =
  "cee0302d59844d32bdca915c8203dd44b33fbb7edc19051ea37abedf28ecd472";
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const POSTGRES_TIMESTAMPTZ_MIN_MS = Date.parse("-004713-11-24T00:00:00.000Z");
const VALIDATION_TOKEN = Symbol("validated-shared-issuance-confirmation");
const RECOVERY_VALIDATION_TOKEN = Symbol(
  "validated-shared-issuance-recovery-evidence",
);

interface StellarTestnetLedgerObservation {
  network: typeof SHARED_ISSUER_TESTNET_NETWORK;
  networkPassphrase: typeof SHARED_ISSUER_TESTNET_PASSPHRASE;
  observedLedger: number;
  observedAt: string;
  /** Close time of the newest ledger represented by this observation. */
  observedLedgerClosedAt: string;
}

export type StellarTestnetTransactionLookup =
  | (StellarTestnetLedgerObservation & {
      status: "confirmed";
      transactionHash: string;
      resultTransactionHash: string;
      envelopeXdr: string;
      resultXdr: string;
      ledgerSequence: number;
      ledgerClosedAt: string;
    })
  | (StellarTestnetLedgerObservation & {
      status: "failed";
      transactionHash: string;
      ledgerSequence: number;
    })
  | (StellarTestnetLedgerObservation & {
      status: "not_found";
      transactionHash: string;
    });

export interface StellarTestnetAccountSequenceEvidence extends StellarTestnetLedgerObservation {
  accountPublicKey: string;
  sequence: string;
}

/**
 * Read-only Testnet boundary. Implementations must independently authenticate
 * their Stellar data source; the ordinary application database is not a ledger.
 */
export interface StellarTestnetLedgerReader {
  /** Authority belongs to the configured reader, never to returned records. */
  readonly authority: "official_testnet_horizon" | "untrusted" | "unavailable";
  lookupTransaction(
    transactionHash: string,
  ): Promise<StellarTestnetTransactionLookup>;
  readAccountSequence(
    accountPublicKey: string,
  ): Promise<StellarTestnetAccountSequenceEvidence>;
}

export class StellarLedgerReaderUnavailableError extends Error {
  readonly code = "stellar_testnet_ledger_reader_unavailable";

  constructor() {
    super("The approved Stellar Testnet ledger reader is unavailable.");
    this.name = "StellarLedgerReaderUnavailableError";
  }
}

/** No Horizon/RPC client or network access is enabled by this adapter. */
export class UnavailableStellarTestnetLedgerReader implements StellarTestnetLedgerReader {
  readonly authority = "unavailable" as const;

  async lookupTransaction(
    _transactionHash: string,
  ): Promise<StellarTestnetTransactionLookup> {
    void _transactionHash;
    throw new StellarLedgerReaderUnavailableError();
  }

  async readAccountSequence(
    _accountPublicKey: string,
  ): Promise<StellarTestnetAccountSequenceEvidence> {
    void _accountPublicKey;
    throw new StellarLedgerReaderUnavailableError();
  }
}

export type StellarLedgerEvidenceErrorCode =
  | "invalid_confirmation_request"
  | "intent_attempt_mismatch"
  | "wrong_network"
  | "wrong_transaction"
  | "non_authoritative_evidence"
  | "transaction_not_confirmed"
  | "invalid_envelope_xdr"
  | "invalid_result_xdr"
  | "transaction_failed"
  | "envelope_mismatch"
  | "signed_envelope_mismatch"
  | "result_mismatch"
  | "operation_mismatch"
  | "sequence_mismatch"
  | "stale_ledger_evidence"
  | "invalid_timestamp"
  | "invalid_ledger_sequence"
  | "recovery_not_eligible"
  | "recovery_sequence_changed";

export class StellarLedgerEvidenceError extends Error {
  constructor(readonly code: StellarLedgerEvidenceErrorCode) {
    super(code);
    this.name = "StellarLedgerEvidenceError";
  }
}

/**
 * Runtime proof token. The trusted writer accepts only instances created by
 * this validator, never caller-assembled database-shaped objects.
 */
export class ValidatedSharedIssuanceLedgerConfirmation {
  readonly #validated = true;

  constructor(
    validationToken: typeof VALIDATION_TOKEN,
    readonly record: Readonly<ImmutableSharedIssuanceLedgerConfirmation>,
  ) {
    if (validationToken !== VALIDATION_TOKEN) {
      throw new StellarLedgerEvidenceError("invalid_confirmation_request");
    }
    Object.freeze(record);
    Object.freeze(this);
  }

  assertValidated(): void {
    if (!this.#validated)
      throw new StellarLedgerEvidenceError("invalid_confirmation_request");
  }
}

export interface ValidatedSharedIssuanceRecoveryEvidenceRecord {
  issuanceRequestId: string;
  supersededAttemptId: string;
  issuanceIntentFingerprint: string;
  supersededTransactionHash: string;
  network: "testnet";
  lookupStatus: "not_found";
  lookupObservedLedger: number;
  lookupObservedLedgerClosedAt: string;
  sequenceObservedLedger: number;
  sequenceObservedLedgerClosedAt: string;
  issuerPublicKey: string;
  issuerSequence: string;
  recoveryAttemptId: string;
  recoveryTransactionHash: string;
  recoveryEnvelopeXdrSha256: string;
  recoverySourceSequence: string;
  recoveryFeeStroops: string;
  recoveryValidFrom: number;
  recoveryValidUntil: number;
  recoveryCreatedAt: string;
  verifierIdentity: string;
  verificationPolicyVersion: string;
  verifiedAt: string;
}

export class ValidatedSharedIssuanceRecoveryEvidence {
  readonly #validated = true;

  constructor(
    validationToken: typeof RECOVERY_VALIDATION_TOKEN,
    readonly record: Readonly<ValidatedSharedIssuanceRecoveryEvidenceRecord>,
  ) {
    if (validationToken !== RECOVERY_VALIDATION_TOKEN) {
      throw new StellarLedgerEvidenceError("invalid_confirmation_request");
    }
    Object.freeze(record);
    Object.freeze(this);
  }

  assertValidated(): void {
    if (!this.#validated) {
      throw new StellarLedgerEvidenceError("invalid_confirmation_request");
    }
  }
}

export class AuthoritativeSharedIssuanceConfirmationValidator {
  constructor(
    private readonly reader: StellarTestnetLedgerReader,
    private readonly options: { now?: () => number } = {},
  ) {}

  async validate(input: {
    confirmationId: string;
    intent: ImmutableSharedIssuanceIntent;
    attempt: ImmutableSharedIssuanceTransactionAttempt;
    verifierIdentity: string;
    verificationPolicyVersion: string;
  }): Promise<ValidatedSharedIssuanceLedgerConfirmation> {
    assertConfirmationRequest(input);
    // Migration 009 intentionally leaves historical attempts/confirmations
    // nullable. Those rows are permanently ineligible for new validation.
    if (!input.attempt.signedEnvelopeXdrSha256) {
      throw new StellarLedgerEvidenceError("signed_envelope_mismatch");
    }
    if (this.reader.authority !== "official_testnet_horizon") {
      throw new StellarLedgerEvidenceError("non_authoritative_evidence");
    }
    const evidence = await this.reader.lookupTransaction(
      input.attempt.transactionHash,
    );
    assertLedgerObservation(evidence);

    if (evidence.status !== "confirmed") {
      throw new StellarLedgerEvidenceError("transaction_not_confirmed");
    }
    if (
      evidence.transactionHash.toLowerCase() !== input.attempt.transactionHash
    ) {
      throw new StellarLedgerEvidenceError("wrong_transaction");
    }
    if (
      evidence.resultTransactionHash.toLowerCase() !==
      input.attempt.transactionHash
    ) {
      throw new StellarLedgerEvidenceError("result_mismatch");
    }
    const ledgerClosedAtMs = parseTimestamp(evidence.ledgerClosedAt);
    if (
      evidence.observedLedger < evidence.ledgerSequence ||
      parseTimestamp(evidence.observedAt) < ledgerClosedAtMs ||
      ledgerClosedAtMs < parseTimestamp(input.intent.createdAt) ||
      ledgerClosedAtMs < parseTimestamp(input.attempt.createdAt)
    ) {
      throw new StellarLedgerEvidenceError("stale_ledger_evidence");
    }
    const ledgerClosedAtUnix = Math.floor(ledgerClosedAtMs / 1_000);
    if (
      ledgerClosedAtUnix < input.attempt.validFrom ||
      ledgerClosedAtUnix > input.attempt.validUntil
    ) {
      throw new StellarLedgerEvidenceError("stale_ledger_evidence");
    }

    let transaction: Transaction;
    try {
      const parsed = TransactionBuilder.fromXDR(
        evidence.envelopeXdr,
        SHARED_ISSUER_TESTNET_PASSPHRASE,
      );
      if (!(parsed instanceof Transaction))
        throw new Error("fee bump rejected");
      transaction = parsed;
    } catch {
      throw new StellarLedgerEvidenceError("invalid_envelope_xdr");
    }

    let transactionResult: xdr.TransactionResult;
    try {
      transactionResult = xdr.TransactionResult.fromXDR(
        evidence.resultXdr,
        "base64",
      );
    } catch {
      throw new StellarLedgerEvidenceError("invalid_result_xdr");
    }
    if (transactionResult.result.type !== "txSuccess") {
      throw new StellarLedgerEvidenceError("transaction_failed");
    }
    const [operationResult] = transactionResult.result.results;
    if (
      transactionResult.result.results.length !== 1 ||
      operationResult?.type !== "opInner" ||
      operationResult.tr.type !== "payment"
    ) {
      throw new StellarLedgerEvidenceError("operation_mismatch");
    }
    if (operationResult.tr.paymentResult.type !== "paymentSuccess") {
      throw new StellarLedgerEvidenceError("transaction_failed");
    }

    const transactionHash = Buffer.from(transaction.hash()).toString("hex");
    if (transactionHash !== input.attempt.transactionHash) {
      throw new StellarLedgerEvidenceError("envelope_mismatch");
    }
    const signedEnvelopeXdrSha256 = sha256(evidence.envelopeXdr);
    if (signedEnvelopeXdrSha256 !== input.attempt.signedEnvelopeXdrSha256) {
      throw new StellarLedgerEvidenceError("signed_envelope_mismatch");
    }

    assertTransactionMatchesAttempt(transaction, input.intent, input.attempt);
    const now = this.options.now?.() ?? Date.now();
    assertTimestamp(now);
    const ledgerClosedAt = new Date(ledgerClosedAtMs).toISOString();
    if (now < Date.parse(ledgerClosedAt)) {
      throw new StellarLedgerEvidenceError("invalid_timestamp");
    }
    const verifiedAt = new Date(now).toISOString();

    return new ValidatedSharedIssuanceLedgerConfirmation(VALIDATION_TOKEN, {
      confirmationId: input.confirmationId.toLowerCase(),
      issuanceRequestId: input.intent.issuanceRequestId,
      issuanceIntentFingerprint: input.intent.issuanceIntentFingerprint,
      attemptId: input.attempt.attemptId,
      projectId: input.intent.projectId,
      ownerPublicKey: input.intent.ownerPublicKey,
      network: "testnet",
      networkPassphraseHash: TESTNET_PASSPHRASE_SHA256,
      transactionHash,
      envelopeXdrSha256: input.attempt.envelopeXdrSha256,
      signedEnvelopeXdrSha256: input.attempt.signedEnvelopeXdrSha256,
      resultXdrSha256: sha256(evidence.resultXdr),
      resultSuccess: true,
      ledgerSequence: evidence.ledgerSequence,
      ledgerClosedAt,
      transactionSourcePublicKey: input.attempt.transactionSourcePublicKey,
      operationCount: 1,
      operationType: "payment",
      operationSourcePublicKey: input.attempt.operationSourcePublicKey,
      assetCode: input.intent.assetCode,
      issuerPublicKey: input.intent.issuerPublicKey,
      destinationPublicKey: input.intent.destinationPublicKey,
      amount: input.intent.amount,
      sourceSequence: input.attempt.sourceSequence,
      verifierIdentity: input.verifierIdentity.trim(),
      verificationPolicyVersion: input.verificationPolicyVersion.trim(),
      verifiedAt,
      createdAt: verifiedAt,
    });
  }
}

export async function validateBoundedSharedIssuanceRecoveryEvidence(input: {
  reader: StellarTestnetLedgerReader;
  intent: ImmutableSharedIssuanceIntent;
  attempt: ImmutableSharedIssuanceTransactionAttempt;
  recoveryAttempt: ImmutableSharedIssuanceTransactionAttempt;
  nowUnix: number;
  verifierIdentity: string;
  verificationPolicyVersion: string;
}): Promise<ValidatedSharedIssuanceRecoveryEvidence> {
  assertIntentAttemptMatch(input.intent, input.attempt);
  if (
    input.attempt.attemptNumber !== 1 ||
    input.attempt.signingMode !== "manual" ||
    input.attempt.signedEnvelopeXdrSha256 !== undefined ||
    !Number.isSafeInteger(input.nowUnix) ||
    input.nowUnix <= input.attempt.validUntil ||
    !input.verifierIdentity.trim() ||
    !input.verificationPolicyVersion.trim()
  ) {
    throw new StellarLedgerEvidenceError("recovery_not_eligible");
  }
  if (input.reader.authority !== "official_testnet_horizon") {
    throw new StellarLedgerEvidenceError("non_authoritative_evidence");
  }

  assertIntentAttemptMatch(input.intent, input.recoveryAttempt);
  if (
    input.recoveryAttempt.attemptNumber !== 2 ||
    input.recoveryAttempt.attemptId === input.attempt.attemptId ||
    input.recoveryAttempt.transactionHash === input.attempt.transactionHash ||
    input.recoveryAttempt.envelopeXdrSha256 ===
      input.attempt.envelopeXdrSha256 ||
    input.recoveryAttempt.signingMode !== undefined ||
    input.recoveryAttempt.signedEnvelopeXdrSha256 !== undefined ||
    input.recoveryAttempt.validFrom !== input.nowUnix ||
    input.recoveryAttempt.validFrom <= input.attempt.validUntil ||
    input.recoveryAttempt.validUntil <= input.recoveryAttempt.validFrom ||
    parseTimestamp(input.recoveryAttempt.createdAt) < input.nowUnix * 1_000
  ) {
    throw new StellarLedgerEvidenceError("recovery_not_eligible");
  }

  const [lookup, sequence] = await Promise.all([
    input.reader.lookupTransaction(input.attempt.transactionHash),
    input.reader.readAccountSequence(input.intent.issuerPublicKey),
  ]);
  assertLedgerObservation(lookup);
  assertLedgerObservation(sequence);

  if (
    lookup.transactionHash.toLowerCase() !== input.attempt.transactionHash ||
    sequence.accountPublicKey !== input.intent.issuerPublicKey
  ) {
    throw new StellarLedgerEvidenceError("wrong_transaction");
  }
  if (
    lookup.status !== "not_found" ||
    sequence.observedLedger < lookup.observedLedger
  ) {
    throw new StellarLedgerEvidenceError("recovery_not_eligible");
  }

  const lookupClosedAtMs = parseTimestamp(lookup.observedLedgerClosedAt);
  const sequenceClosedAtMs = parseTimestamp(sequence.observedLedgerClosedAt);
  const expiryMs = input.attempt.validUntil * 1_000;
  if (lookupClosedAtMs <= expiryMs || sequenceClosedAtMs <= expiryMs) {
    throw new StellarLedgerEvidenceError("stale_ledger_evidence");
  }
  if (
    sequence.sequence !== input.attempt.sourceSequence ||
    input.recoveryAttempt.sourceSequence !== sequence.sequence
  ) {
    throw new StellarLedgerEvidenceError("recovery_sequence_changed");
  }

  const verifiedAtMs = input.nowUnix * 1_000;
  assertTimestamp(verifiedAtMs);
  if (verifiedAtMs < lookupClosedAtMs || verifiedAtMs < sequenceClosedAtMs) {
    throw new StellarLedgerEvidenceError("invalid_timestamp");
  }

  return new ValidatedSharedIssuanceRecoveryEvidence(
    RECOVERY_VALIDATION_TOKEN,
    {
      issuanceRequestId: input.intent.issuanceRequestId,
      supersededAttemptId: input.attempt.attemptId,
      issuanceIntentFingerprint: input.intent.issuanceIntentFingerprint,
      supersededTransactionHash: input.attempt.transactionHash,
      network: "testnet",
      lookupStatus: "not_found",
      lookupObservedLedger: lookup.observedLedger,
      lookupObservedLedgerClosedAt: new Date(lookupClosedAtMs).toISOString(),
      sequenceObservedLedger: sequence.observedLedger,
      sequenceObservedLedgerClosedAt: new Date(
        sequenceClosedAtMs,
      ).toISOString(),
      issuerPublicKey: input.intent.issuerPublicKey,
      issuerSequence: sequence.sequence,
      recoveryAttemptId: input.recoveryAttempt.attemptId,
      recoveryTransactionHash: input.recoveryAttempt.transactionHash,
      recoveryEnvelopeXdrSha256: input.recoveryAttempt.envelopeXdrSha256,
      recoverySourceSequence: input.recoveryAttempt.sourceSequence,
      recoveryFeeStroops: input.recoveryAttempt.feeStroops,
      recoveryValidFrom: input.recoveryAttempt.validFrom,
      recoveryValidUntil: input.recoveryAttempt.validUntil,
      recoveryCreatedAt: input.recoveryAttempt.createdAt,
      verifierIdentity: input.verifierIdentity.trim(),
      verificationPolicyVersion: input.verificationPolicyVersion.trim(),
      verifiedAt: new Date(verifiedAtMs).toISOString(),
    },
  );
}

export type SharedIssuanceReconciliationDecision =
  | { action: "confirmed"; transactionHash: string; ledgerSequence: number }
  | {
      action: "terminal_failure";
      transactionHash: string;
      ledgerSequence: number;
    }
  | {
      action: "retry_same_envelope";
      attemptId: string;
      transactionHash: string;
    }
  | { action: "await_authoritative_reconciliation" }
  | { action: "reconcile_sequence" }
  | {
      action: "replacement_permitted";
      issuanceIntentFingerprint: string;
      supersededAttemptId: string;
      nextAttemptNumber: number;
    };

/**
 * Reconciliation is read-only. It can authorize construction of a successor
 * attempt only for an authoritative expired not-found result with an unchanged
 * issuer sequence; it never signs, submits, or constructs that replacement.
 */
export async function reconcileSharedIssuanceAttempt(input: {
  reader: StellarTestnetLedgerReader;
  intent: ImmutableSharedIssuanceIntent;
  attempt: ImmutableSharedIssuanceTransactionAttempt;
  nowUnix: number;
}): Promise<SharedIssuanceReconciliationDecision> {
  assertIntentAttemptMatch(input.intent, input.attempt);
  if (input.reader.authority !== "official_testnet_horizon") {
    return { action: "await_authoritative_reconciliation" };
  }
  const [lookup, sequence] = await Promise.all([
    input.reader.lookupTransaction(input.attempt.transactionHash),
    input.reader.readAccountSequence(input.intent.issuerPublicKey),
  ]);
  assertLedgerObservation(lookup);
  assertLedgerObservation(sequence);
  if (
    lookup.transactionHash.toLowerCase() !== input.attempt.transactionHash ||
    sequence.accountPublicKey !== input.intent.issuerPublicKey
  ) {
    throw new StellarLedgerEvidenceError("wrong_transaction");
  }
  if (sequence.observedLedger < lookup.observedLedger) {
    return { action: "await_authoritative_reconciliation" };
  }
  const decision = classifySharedIssuerRecovery({
    plan: asRecoveryPlan(input.intent, input.attempt),
    lookup:
      lookup.status === "not_found"
        ? {
            status: "not_found",
            observedLedger: lookup.observedLedger,
            authoritative: true,
          }
        : {
            status: lookup.status,
            hash: lookup.transactionHash,
            ledger: lookup.ledgerSequence,
          },
    currentIssuerSequence: sequence.sequence,
    nowUnix: input.nowUnix,
  });

  if (
    decision.action === "rebuild_expired" &&
    (parseTimestamp(lookup.observedLedgerClosedAt) <=
      input.attempt.validUntil * 1_000 ||
      parseTimestamp(sequence.observedLedgerClosedAt) <=
        input.attempt.validUntil * 1_000)
  ) {
    return { action: "await_authoritative_reconciliation" };
  }

  switch (decision.action) {
    case "confirmed":
      return {
        action: "confirmed",
        transactionHash: decision.hash,
        ledgerSequence: decision.ledger,
      };
    case "terminal_failure":
      return {
        action: "terminal_failure",
        transactionHash: decision.hash,
        ledgerSequence: decision.ledger,
      };
    case "retry_same_envelope":
      return {
        action: "retry_same_envelope",
        attemptId: input.attempt.attemptId,
        transactionHash: input.attempt.transactionHash,
      };
    case "rebuild_expired":
      // MVP Lite has exactly one immutable transaction attempt. Even after
      // authoritative post-expiry reconciliation, replacement construction is
      // deliberately unavailable until a separately reviewed retry design.
      return { action: "await_authoritative_reconciliation" };
    default:
      return decision;
  }
}

function assertConfirmationRequest(input: {
  confirmationId: string;
  intent: ImmutableSharedIssuanceIntent;
  attempt: ImmutableSharedIssuanceTransactionAttempt;
  verifierIdentity: string;
  verificationPolicyVersion: string;
}): void {
  if (
    !UUID_PATTERN.test(input.confirmationId) ||
    !input.verifierIdentity.trim() ||
    !input.verificationPolicyVersion.trim()
  ) {
    throw new StellarLedgerEvidenceError("invalid_confirmation_request");
  }
  assertIntentAttemptMatch(input.intent, input.attempt);
}

function assertIntentAttemptMatch(
  intent: ImmutableSharedIssuanceIntent,
  attempt: ImmutableSharedIssuanceTransactionAttempt,
): void {
  const recomputedFingerprint = hashSharedIssuerIssuanceIntent({
    policyVersion: SHARED_ISSUANCE_POLICY_VERSION,
    projectId: intent.projectId,
    network: intent.network,
    assetCode: intent.assetCode,
    issuerPublicKey: intent.issuerPublicKey,
    destinationPublicKey: intent.destinationPublicKey,
    amount: intent.amount,
  });
  if (
    intent.network !== SHARED_ISSUER_TESTNET_NETWORK ||
    intent.policyVersion !== SHARED_ISSUANCE_POLICY_VERSION ||
    intent.networkPassphraseHash !== TESTNET_PASSPHRASE_SHA256 ||
    !UUID_PATTERN.test(intent.issuanceRequestId) ||
    !UUID_PATTERN.test(intent.projectId) ||
    !UUID_PATTERN.test(attempt.attemptId) ||
    !HASH_PATTERN.test(intent.issuanceIntentFingerprint) ||
    !HASH_PATTERN.test(attempt.transactionHash) ||
    !HASH_PATTERN.test(attempt.envelopeXdrSha256) ||
    (attempt.signedEnvelopeXdrSha256 !== undefined &&
      !HASH_PATTERN.test(attempt.signedEnvelopeXdrSha256)) ||
    !isValidStellarPublicKey(intent.ownerPublicKey) ||
    !isValidStellarPublicKey(intent.issuerPublicKey) ||
    !isValidStellarPublicKey(intent.destinationPublicKey) ||
    recomputedFingerprint !== intent.issuanceIntentFingerprint ||
    attempt.issuanceRequestId !== intent.issuanceRequestId ||
    attempt.issuanceIntentFingerprint !== intent.issuanceIntentFingerprint ||
    attempt.transactionSourcePublicKey !== intent.issuerPublicKey ||
    attempt.operationSourcePublicKey !== intent.issuerPublicKey ||
    attempt.assetCode !== intent.assetCode ||
    attempt.issuerPublicKey !== intent.issuerPublicKey ||
    attempt.destinationPublicKey !== intent.destinationPublicKey ||
    attempt.amount !== intent.amount ||
    attempt.operationCount !== 1 ||
    attempt.operationType !== "payment"
  ) {
    throw new StellarLedgerEvidenceError("intent_attempt_mismatch");
  }
}

function assertTransactionMatchesAttempt(
  transaction: Transaction,
  intent: ImmutableSharedIssuanceIntent,
  attempt: ImmutableSharedIssuanceTransactionAttempt,
): void {
  const [operation] = transaction.operations;
  if (
    transaction.source !== intent.issuerPublicKey ||
    transaction.fee !== attempt.feeStroops ||
    transaction.operations.length !== 1 ||
    operation?.type !== "payment" ||
    (operation.source ?? transaction.source) !== intent.issuerPublicKey ||
    operation.destination !== intent.destinationPublicKey ||
    operation.asset.code !== intent.assetCode ||
    operation.asset.issuer !== intent.issuerPublicKey ||
    operation.amount !== intent.amount ||
    transaction.timeBounds?.minTime !== attempt.validFrom.toString() ||
    transaction.timeBounds?.maxTime !== attempt.validUntil.toString()
  ) {
    throw new StellarLedgerEvidenceError("operation_mismatch");
  }
  if (
    transaction.sequence !== (BigInt(attempt.sourceSequence) + 1n).toString()
  ) {
    throw new StellarLedgerEvidenceError("sequence_mismatch");
  }
}

function assertLedgerObservation(
  evidence: StellarTestnetLedgerObservation,
): void {
  if (
    evidence.network !== SHARED_ISSUER_TESTNET_NETWORK ||
    evidence.networkPassphrase !== SHARED_ISSUER_TESTNET_PASSPHRASE
  ) {
    throw new StellarLedgerEvidenceError("wrong_network");
  }
  if (
    !Number.isSafeInteger(evidence.observedLedger) ||
    evidence.observedLedger <= 0
  ) {
    throw new StellarLedgerEvidenceError("invalid_ledger_sequence");
  }
  parseTimestamp(evidence.observedAt);
  const observedLedgerClosedAt = parseTimestamp(
    evidence.observedLedgerClosedAt,
  );
  if (parseTimestamp(evidence.observedAt) < observedLedgerClosedAt) {
    throw new StellarLedgerEvidenceError("stale_ledger_evidence");
  }
  if (
    "ledgerSequence" in evidence &&
    (typeof evidence.ledgerSequence !== "number" ||
      !Number.isSafeInteger(evidence.ledgerSequence) ||
      evidence.ledgerSequence <= 0)
  ) {
    throw new StellarLedgerEvidenceError("invalid_ledger_sequence");
  }
}

function asRecoveryPlan(
  intent: ImmutableSharedIssuanceIntent,
  attempt: ImmutableSharedIssuanceTransactionAttempt,
): SharedIssuerIssuancePlan {
  return {
    intent: {
      policyVersion: intent.policyVersion as "shared-issuer-testnet-v1",
      projectId: intent.projectId,
      network: "testnet",
      assetCode: intent.assetCode,
      issuerPublicKey: intent.issuerPublicKey,
      destinationPublicKey: intent.destinationPublicKey,
      amount: intent.amount,
    },
    intentFingerprint: intent.issuanceIntentFingerprint,
    sourceSequence: attempt.sourceSequence,
    validFrom: attempt.validFrom,
    validUntil: attempt.validUntil,
    feeStroops: attempt.feeStroops,
    unsignedEnvelopeXdr: "persisted-by-reference",
    transactionHash: attempt.transactionHash,
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function parseTimestamp(value: string): number {
  const parsed = Date.parse(value);
  assertTimestamp(parsed);
  return parsed;
}

function assertTimestamp(value: number): void {
  if (
    !Number.isFinite(value) ||
    !Number.isFinite(new Date(value).getTime()) ||
    value < POSTGRES_TIMESTAMPTZ_MIN_MS
  ) {
    throw new StellarLedgerEvidenceError("invalid_timestamp");
  }
}

export function isSha256(value: string): boolean {
  return HASH_PATTERN.test(value);
}

export function isValidStellarPublicKey(value: string): boolean {
  try {
    return Keypair.fromPublicKey(value).publicKey() === value;
  } catch {
    return false;
  }
}
