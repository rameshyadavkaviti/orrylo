import { createHash, randomUUID } from "node:crypto";

import type {
  ImmutableSharedIssuanceIntent,
  ImmutableSharedIssuanceLedgerConfirmation,
  ImmutableSharedIssuanceTransactionAttempt,
  SharedIssuanceSigningMode,
  TrustedLedgerConfirmationWriter,
} from "./shared-issuance-persistence";
import {
  SHARED_ISSUER_TESTNET_PASSPHRASE,
  buildSharedIssuerIssuancePlan,
  type SharedIssuerIssuancePlan,
  type SharedIssuerSignerAuthorization,
  type SharedIssuerSubmissionAdapter,
} from "../../stellar/shared-issuer-issuance";
import {
  loadAndAssertDurableSharedIssuerPlan,
  persistAndSubmitSharedIssuerEnvelope,
  type SignedEnvelopeAttemptWriter,
} from "../../stellar/shared-issuer-execution";
import {
  signDurableSharedIssuerTestnetEnvelope,
  type SharedIssuerSigningPrimitive,
} from "../../stellar/shared-issuer-signing-policy";
import type {
  OfficialStellarTestnetIssuancePreflightReader,
  SharedIssuerTestnetPreflightResult,
} from "../../stellar/shared-issuer-testnet-preflight";
import {
  AuthoritativeSharedIssuanceConfirmationValidator,
  StellarLedgerEvidenceError,
  type ValidatedSharedIssuanceLedgerConfirmation,
} from "../../stellar/testnet-ledger-confirmation";
import type { TestnetIssuanceStatus } from "./testnet-issuance-service";

type DurableStatus = Exclude<TestnetIssuanceStatus, "not_started">;

export interface SharedIssuanceOrchestrationStore extends SignedEnvelopeAttemptWriter {
  listAttempts(
    issuanceRequestId: string,
  ): Promise<ImmutableSharedIssuanceTransactionAttempt[]>;
  appendAttempt(
    attempt: ImmutableSharedIssuanceTransactionAttempt,
  ): Promise<ImmutableSharedIssuanceTransactionAttempt>;
  claimSigningMode(input: {
    attemptId: string;
    transactionHash: string;
    signingMode: SharedIssuanceSigningMode;
  }): Promise<ImmutableSharedIssuanceTransactionAttempt | null>;
  getConfirmation(
    issuanceRequestId: string,
  ): Promise<ImmutableSharedIssuanceLedgerConfirmation | null>;
  getLifecycle(issuanceRequestId: string): Promise<{
    status: DurableStatus;
    failureCode: string | null;
  } | null>;
  transition(
    issuanceRequestId: string,
    status: DurableStatus,
    failureCode?: string | null,
  ): Promise<boolean>;
}

export type SharedIssuanceOrchestrationResult =
  | {
      status: "confirmed";
      transactionHash: string;
      ledgerSequence: number;
    }
  | { status: "confirming"; transactionHash: string }
  | { status: "preparing_issuance" }
  | { status: "reconciliation_required"; transactionHash: string }
  | { status: "failed_before_submission"; failureCode: string };

export interface ManualSharedIssuanceSigningHandoff {
  status: "awaiting_manual_signature";
  requestId: string;
  attemptId: string;
  projectId: string;
  ownerPublicKey: string;
  network: "testnet";
  networkPassphrase: typeof SHARED_ISSUER_TESTNET_PASSPHRASE;
  issuerPublicKey: string;
  destinationPublicKey: string;
  assetCode: string;
  amount: string;
  transactionHash: string;
  unsignedEnvelopeXdr: string;
  unsignedEnvelopeXdrSha256: string;
  sourceSequence: string;
  feeStroops: string;
  validFrom: number;
  validUntil: number;
}

interface ConfirmationValidator {
  validate(
    input: Parameters<
      AuthoritativeSharedIssuanceConfirmationValidator["validate"]
    >[0],
  ): Promise<ValidatedSharedIssuanceLedgerConfirmation>;
}

export class SharedIssuanceOrchestrationError extends Error {
  constructor(
    readonly code:
      | "intent_not_found"
      | "owner_intent_mismatch"
      | "invalid_attempt_history"
      | "manual_signing_not_ready"
      | "manual_signing_already_consumed"
      | "manual_signing_window_expired"
      | "manual_issuer_mismatch"
      | "signing_mode_already_claimed",
  ) {
    super(code);
    this.name = "SharedIssuanceOrchestrationError";
  }
}

/**
 * One-shot Testnet MVP orchestration. A persisted attempt is never submitted
 * twice: every replay moves directly to exact-hash authoritative reconciliation.
 */
export class SharedIssuanceOrchestrator {
  constructor(
    private readonly dependencies: {
      store: SharedIssuanceOrchestrationStore;
      preflight: Pick<
        OfficialStellarTestnetIssuancePreflightReader,
        "readIssuancePreconditions"
      >;
      primitive: SharedIssuerSigningPrimitive;
      submission: SharedIssuerSubmissionAdapter;
      authorization: SharedIssuerSignerAuthorization;
      confirmationValidator: ConfirmationValidator;
      confirmationWriter: TrustedLedgerConfirmationWriter;
      feeStroops: string;
      validitySeconds: number;
      now?: () => number;
      randomUuid?: () => string;
    },
  ) {}

  async startOrResume(input: {
    requestId: string;
    projectId: string;
    ownerPublicKey: string;
  }): Promise<SharedIssuanceOrchestrationResult> {
    const intent = await this.dependencies.store.getIntent(input.requestId);
    if (!intent) throw new SharedIssuanceOrchestrationError("intent_not_found");
    assertAuthenticatedIntent(input, intent);

    const durableConfirmation = await this.dependencies.store.getConfirmation(
      input.requestId,
    );
    if (durableConfirmation) {
      await this.dependencies.store.transition(input.requestId, "confirmed");
      return confirmed(durableConfirmation);
    }

    let attempts = await this.dependencies.store.listAttempts(input.requestId);
    assertSingleAttemptHistory(attempts);
    let attempt = attempts[0];

    if (attempt?.signedEnvelopeXdrSha256) {
      return this.reconcile(intent, attempt);
    }

    const lifecycle = await this.dependencies.store.getLifecycle(
      input.requestId,
    );
    if (!lifecycle)
      throw new SharedIssuanceOrchestrationError("intent_not_found");
    if (lifecycle.status === "failed") {
      return {
        status: "failed_before_submission",
        failureCode:
          lifecycle.failureCode ?? "execution_failed_before_submission",
      };
    }
    if (attempt?.signingMode) {
      return { status: "preparing_issuance" };
    }
    if (
      lifecycle.status !== "awaiting_issuer_integration" &&
      lifecycle.status !== "pending_execution"
    ) {
      return { status: "preparing_issuance" };
    }

    let plan: SharedIssuerIssuancePlan;

    if (attempt) {
      try {
        plan = await this.loadCurrentPlan(intent, attempt);
      } catch (error) {
        return this.failBeforeSubmission(input.requestId, error);
      }
    } else {
      let preflight: SharedIssuerTestnetPreflightResult;
      try {
        preflight = await this.dependencies.preflight.readIssuancePreconditions(
          {
            issuerPublicKey: intent.issuerPublicKey,
            destinationPublicKey: intent.destinationPublicKey,
            assetCode: intent.assetCode,
            assetCodeReservedForProject: true,
            feeStroops: this.dependencies.feeStroops,
          },
        );
      } catch (error) {
        return this.failBeforeSubmission(input.requestId, error);
      }

      const now = this.dependencies.now?.() ?? Date.now();
      const validFrom = Math.floor(now / 1_000);
      try {
        plan = buildSharedIssuerIssuancePlan(
          {
            projectId: intent.projectId,
            assetCode: intent.assetCode,
            issuerPublicKey: intent.issuerPublicKey,
            destinationPublicKey: intent.destinationPublicKey,
            amount: intent.amount,
            network: "testnet",
            networkPassphrase: preflight.networkPassphrase,
            validFrom,
            validUntil: validFrom + this.dependencies.validitySeconds,
          },
          preflight.preconditions,
        );
      } catch (error) {
        return this.failBeforeSubmission(input.requestId, error);
      }

      const candidate: ImmutableSharedIssuanceTransactionAttempt = {
        attemptId: (this.dependencies.randomUuid ?? randomUUID)(),
        issuanceRequestId: intent.issuanceRequestId,
        issuanceIntentFingerprint: intent.issuanceIntentFingerprint,
        attemptNumber: 1,
        transactionHash: plan.transactionHash,
        envelopeXdrSha256: sha256(plan.unsignedEnvelopeXdr),
        sourceSequence: plan.sourceSequence,
        feeStroops: plan.feeStroops,
        validFrom: plan.validFrom,
        validUntil: plan.validUntil,
        transactionSourcePublicKey: intent.issuerPublicKey,
        operationCount: 1,
        operationType: "payment",
        operationSourcePublicKey: intent.issuerPublicKey,
        assetCode: intent.assetCode,
        issuerPublicKey: intent.issuerPublicKey,
        destinationPublicKey: intent.destinationPublicKey,
        amount: intent.amount,
        createdAt: new Date(now).toISOString(),
      };

      try {
        attempt = await this.dependencies.store.appendAttempt(candidate);
      } catch {
        attempts = await this.dependencies.store.listAttempts(input.requestId);
        assertSingleAttemptHistory(attempts);
        attempt = attempts[0];
        if (!attempt) {
          return { status: "preparing_issuance" };
        }
        if (attempt.signedEnvelopeXdrSha256) {
          return this.reconcile(intent, attempt);
        }
        if (attempt.signingMode) {
          return { status: "preparing_issuance" };
        }
        try {
          plan = await this.loadCurrentPlan(intent, attempt);
        } catch (error) {
          return this.failBeforeSubmission(input.requestId, error);
        }
      }
    }

    if (!(await this.ensurePendingExecution(input.requestId))) {
      return { status: "preparing_issuance" };
    }

    const claimedAttempt = await this.dependencies.store.claimSigningMode({
      attemptId: attempt.attemptId,
      transactionHash: attempt.transactionHash,
      signingMode: "private",
    });
    if (!claimedAttempt) {
      return { status: "preparing_issuance" };
    }

    try {
      const signed = await signDurableSharedIssuerTestnetEnvelope({
        reader: this.dependencies.store,
        attemptId: claimedAttempt.attemptId,
        plan,
        policy: { issuerPublicKey: intent.issuerPublicKey },
        primitive: this.dependencies.primitive,
      });
      await persistAndSubmitSharedIssuerEnvelope({
        writer: this.dependencies.store,
        attemptId: claimedAttempt.attemptId,
        plan,
        signedEnvelopeXdr: signed.signedEnvelopeXdr,
        authorization: this.dependencies.authorization,
        submission: this.dependencies.submission,
      });
      await this.dependencies.store.transition(input.requestId, "submitted");
    } catch (error) {
      const stored = await this.dependencies.store.getAttempt(
        claimedAttempt.attemptId,
      );
      if (stored?.signedEnvelopeXdrSha256) {
        await this.dependencies.store.transition(
          input.requestId,
          "reconciliation_required",
          "submission_reconciliation_required",
        );
        return {
          status: "reconciliation_required",
          transactionHash: stored.transactionHash,
        };
      }
      return this.failBeforeSubmission(input.requestId, error);
    }

    const persistedAttempt = await this.dependencies.store.getAttempt(
      claimedAttempt.attemptId,
    );
    if (!persistedAttempt) {
      throw new SharedIssuanceOrchestrationError("invalid_attempt_history");
    }
    return this.reconcile(intent, persistedAttempt);
  }

  /**
   * Local/operator-only preparation path. It creates attempt 1 exactly once and
   * returns only non-secret handoff data. It never invokes a signing primitive
   * or a submission adapter.
   */
  async prepareManualSigningHandoff(input: {
    requestId: string;
    projectId: string;
    ownerPublicKey: string;
  }): Promise<ManualSharedIssuanceSigningHandoff> {
    const intent = await this.dependencies.store.getIntent(input.requestId);
    if (!intent) throw new SharedIssuanceOrchestrationError("intent_not_found");
    assertAuthenticatedIntent(input, intent);
    this.assertManualIssuer(intent);

    if (await this.dependencies.store.getConfirmation(input.requestId)) {
      throw new SharedIssuanceOrchestrationError(
        "manual_signing_already_consumed",
      );
    }

    let attempts = await this.dependencies.store.listAttempts(input.requestId);
    assertSingleAttemptHistory(attempts);
    let attempt = attempts[0];

    if (attempt?.signedEnvelopeXdrSha256 || attempt?.signingMode) {
      throw new SharedIssuanceOrchestrationError(
        "manual_signing_already_consumed",
      );
    }

    const lifecycle = await this.dependencies.store.getLifecycle(
      input.requestId,
    );
    if (
      !lifecycle ||
      (lifecycle.status !== "awaiting_issuer_integration" &&
        lifecycle.status !== "pending_execution")
    ) {
      throw new SharedIssuanceOrchestrationError("manual_signing_not_ready");
    }

    let plan: SharedIssuerIssuancePlan;

    if (attempt) {
      try {
        plan = await this.loadCurrentPlan(intent, attempt);
      } catch (error) {
        await this.failBeforeSubmission(input.requestId, error);
        throw error;
      }
    } else {
      let preflight: SharedIssuerTestnetPreflightResult;
      try {
        preflight = await this.dependencies.preflight.readIssuancePreconditions(
          {
            issuerPublicKey: intent.issuerPublicKey,
            destinationPublicKey: intent.destinationPublicKey,
            assetCode: intent.assetCode,
            assetCodeReservedForProject: true,
            feeStroops: this.dependencies.feeStroops,
          },
        );
      } catch (error) {
        await this.failBeforeSubmission(input.requestId, error);
        throw error;
      }

      const now = this.dependencies.now?.() ?? Date.now();
      const validFrom = Math.floor(now / 1_000);
      try {
        plan = buildSharedIssuerIssuancePlan(
          {
            projectId: intent.projectId,
            assetCode: intent.assetCode,
            issuerPublicKey: intent.issuerPublicKey,
            destinationPublicKey: intent.destinationPublicKey,
            amount: intent.amount,
            network: "testnet",
            networkPassphrase: preflight.networkPassphrase,
            validFrom,
            validUntil: validFrom + this.dependencies.validitySeconds,
          },
          preflight.preconditions,
        );
      } catch (error) {
        await this.failBeforeSubmission(input.requestId, error);
        throw error;
      }

      const candidate: ImmutableSharedIssuanceTransactionAttempt = {
        attemptId: (this.dependencies.randomUuid ?? randomUUID)(),
        issuanceRequestId: intent.issuanceRequestId,
        issuanceIntentFingerprint: intent.issuanceIntentFingerprint,
        attemptNumber: 1,
        transactionHash: plan.transactionHash,
        envelopeXdrSha256: sha256(plan.unsignedEnvelopeXdr),
        sourceSequence: plan.sourceSequence,
        feeStroops: plan.feeStroops,
        validFrom: plan.validFrom,
        validUntil: plan.validUntil,
        transactionSourcePublicKey: intent.issuerPublicKey,
        operationCount: 1,
        operationType: "payment",
        operationSourcePublicKey: intent.issuerPublicKey,
        assetCode: intent.assetCode,
        issuerPublicKey: intent.issuerPublicKey,
        destinationPublicKey: intent.destinationPublicKey,
        amount: intent.amount,
        createdAt: new Date(now).toISOString(),
      };

      try {
        attempt = await this.dependencies.store.appendAttempt(candidate);
      } catch {
        attempts = await this.dependencies.store.listAttempts(input.requestId);
        assertSingleAttemptHistory(attempts);
        attempt = attempts[0];
        if (!attempt) {
          throw new SharedIssuanceOrchestrationError(
            "manual_signing_not_ready",
          );
        }
        if (attempt.signedEnvelopeXdrSha256 || attempt.signingMode) {
          throw new SharedIssuanceOrchestrationError(
            "manual_signing_already_consumed",
          );
        }
        plan = await this.loadCurrentPlan(intent, attempt);
      }
    }

    if (!(await this.ensurePendingExecution(input.requestId))) {
      throw new SharedIssuanceOrchestrationError("manual_signing_not_ready");
    }

    const claimedAttempt = await this.dependencies.store.claimSigningMode({
      attemptId: attempt.attemptId,
      transactionHash: attempt.transactionHash,
      signingMode: "manual",
    });
    if (!claimedAttempt) {
      throw new SharedIssuanceOrchestrationError(
        "manual_signing_already_consumed",
      );
    }

    await loadAndAssertDurableSharedIssuerPlan({
      reader: this.dependencies.store,
      attemptId: claimedAttempt.attemptId,
      plan,
    });
    return manualHandoff(intent, claimedAttempt, plan);
  }

  /**
   * Accepts one operator-supplied signed envelope for the already-persisted
   * attempt. The existing authorization boundary validates the exact Testnet
   * transaction and signer, persists the signed digest, and only then performs
   * the single Horizon submission.
   */
  async submitManualSignedEnvelope(input: {
    requestId: string;
    projectId: string;
    ownerPublicKey: string;
    signedEnvelopeXdr: string;
  }): Promise<SharedIssuanceOrchestrationResult> {
    const intent = await this.dependencies.store.getIntent(input.requestId);
    if (!intent) throw new SharedIssuanceOrchestrationError("intent_not_found");
    assertAuthenticatedIntent(input, intent);
    this.assertManualIssuer(intent);

    const durableConfirmation = await this.dependencies.store.getConfirmation(
      input.requestId,
    );
    if (durableConfirmation) {
      throw new SharedIssuanceOrchestrationError(
        "manual_signing_already_consumed",
      );
    }

    const attempts = await this.dependencies.store.listAttempts(
      input.requestId,
    );
    if (attempts.length !== 1 || attempts[0]!.attemptNumber !== 1) {
      throw new SharedIssuanceOrchestrationError("manual_signing_not_ready");
    }
    const attempt = attempts[0]!;
    if (attempt.signingMode !== "manual" || attempt.signedEnvelopeXdrSha256) {
      throw new SharedIssuanceOrchestrationError(
        "manual_signing_already_consumed",
      );
    }

    const lifecycle = await this.dependencies.store.getLifecycle(
      input.requestId,
    );
    if (!lifecycle || lifecycle.status !== "pending_execution") {
      throw new SharedIssuanceOrchestrationError("manual_signing_not_ready");
    }

    const plan = await this.loadCurrentPlan(intent, attempt);

    try {
      await persistAndSubmitSharedIssuerEnvelope({
        writer: this.dependencies.store,
        attemptId: attempt.attemptId,
        plan,
        signedEnvelopeXdr: input.signedEnvelopeXdr,
        authorization: this.dependencies.authorization,
        submission: this.dependencies.submission,
      });
      await this.dependencies.store.transition(input.requestId, "submitted");
    } catch (error) {
      const stored = await this.dependencies.store.getAttempt(
        attempt.attemptId,
      );
      if (stored?.signedEnvelopeXdrSha256) {
        await this.dependencies.store.transition(
          input.requestId,
          "reconciliation_required",
          "submission_reconciliation_required",
        );
        return {
          status: "reconciliation_required",
          transactionHash: stored.transactionHash,
        };
      }
      throw error;
    }

    const persistedAttempt = await this.dependencies.store.getAttempt(
      attempt.attemptId,
    );
    if (!persistedAttempt) {
      throw new SharedIssuanceOrchestrationError("invalid_attempt_history");
    }
    return this.reconcile(intent, persistedAttempt);
  }

  /**
   * Manual/operator reconciliation never signs or submits. Once signed
   * provenance exists, this is the only supported replay path.
   */
  async reconcileManualAttempt(input: {
    requestId: string;
    projectId: string;
    ownerPublicKey: string;
  }): Promise<SharedIssuanceOrchestrationResult> {
    const intent = await this.dependencies.store.getIntent(input.requestId);
    if (!intent) throw new SharedIssuanceOrchestrationError("intent_not_found");
    assertAuthenticatedIntent(input, intent);
    this.assertManualIssuer(intent);

    const durableConfirmation = await this.dependencies.store.getConfirmation(
      input.requestId,
    );
    if (durableConfirmation) {
      await this.dependencies.store.transition(input.requestId, "confirmed");
      return confirmed(durableConfirmation);
    }

    const attempts = await this.dependencies.store.listAttempts(
      input.requestId,
    );
    if (
      attempts.length !== 1 ||
      attempts[0]!.attemptNumber !== 1 ||
      attempts[0]!.signingMode !== "manual" ||
      !attempts[0]!.signedEnvelopeXdrSha256
    ) {
      throw new SharedIssuanceOrchestrationError("manual_signing_not_ready");
    }
    return this.reconcile(intent, attempts[0]!);
  }

  private async loadCurrentPlan(
    intent: ImmutableSharedIssuanceIntent,
    attempt: ImmutableSharedIssuanceTransactionAttempt,
  ): Promise<SharedIssuerIssuancePlan> {
    const nowUnix = Math.floor(
      (this.dependencies.now?.() ?? Date.now()) / 1_000,
    );
    if (nowUnix >= attempt.validUntil) {
      throw new SharedIssuanceOrchestrationError(
        "manual_signing_window_expired",
      );
    }

    const preflight =
      await this.dependencies.preflight.readIssuancePreconditions({
        issuerPublicKey: intent.issuerPublicKey,
        destinationPublicKey: intent.destinationPublicKey,
        assetCode: intent.assetCode,
        assetCodeReservedForProject: true,
        feeStroops: this.dependencies.feeStroops,
      });
    const plan = buildSharedIssuerIssuancePlan(
      {
        projectId: intent.projectId,
        assetCode: intent.assetCode,
        issuerPublicKey: intent.issuerPublicKey,
        destinationPublicKey: intent.destinationPublicKey,
        amount: intent.amount,
        network: "testnet",
        networkPassphrase: preflight.networkPassphrase,
        validFrom: attempt.validFrom,
        validUntil: attempt.validUntil,
      },
      preflight.preconditions,
    );
    await loadAndAssertDurableSharedIssuerPlan({
      reader: this.dependencies.store,
      attemptId: attempt.attemptId,
      plan,
    });
    return plan;
  }

  private async ensurePendingExecution(requestId: string): Promise<boolean> {
    const lifecycle = await this.dependencies.store.getLifecycle(requestId);
    if (!lifecycle) {
      throw new SharedIssuanceOrchestrationError("intent_not_found");
    }
    if (lifecycle.status === "pending_execution") {
      return true;
    }
    if (lifecycle.status !== "awaiting_issuer_integration") {
      return false;
    }
    if (
      await this.dependencies.store.transition(requestId, "pending_execution")
    ) {
      return true;
    }
    const current = await this.dependencies.store.getLifecycle(requestId);
    return current?.status === "pending_execution";
  }

  private assertManualIssuer(intent: ImmutableSharedIssuanceIntent): void {
    if (
      this.dependencies.authorization.network !== "testnet" ||
      this.dependencies.authorization.networkPassphrase !==
        SHARED_ISSUER_TESTNET_PASSPHRASE ||
      this.dependencies.authorization.issuerPublicKey !== intent.issuerPublicKey
    ) {
      throw new SharedIssuanceOrchestrationError("manual_issuer_mismatch");
    }
  }

  private async reconcile(
    intent: ImmutableSharedIssuanceIntent,
    attempt: ImmutableSharedIssuanceTransactionAttempt,
  ): Promise<SharedIssuanceOrchestrationResult> {
    if (!attempt.signedEnvelopeXdrSha256) {
      return {
        status: "failed_before_submission",
        failureCode: "signing_failed_before_submission",
      };
    }
    try {
      const validated = await this.dependencies.confirmationValidator.validate({
        confirmationId: attempt.attemptId,
        intent,
        attempt,
        verifierIdentity: "official-stellar-testnet-horizon",
        verificationPolicyVersion: "shared-issuer-testnet-confirmation-v1",
      });
      const durable =
        await this.dependencies.confirmationWriter.appendConfirmation(
          validated,
        );
      await this.dependencies.store.transition(
        intent.issuanceRequestId,
        "confirmed",
      );
      return confirmed(durable);
    } catch (error) {
      if (
        error instanceof StellarLedgerEvidenceError &&
        error.code === "transaction_not_confirmed"
      ) {
        return {
          status: "confirming",
          transactionHash: attempt.transactionHash,
        };
      }
      await this.dependencies.store.transition(
        intent.issuanceRequestId,
        "reconciliation_required",
        safeFailureCode(error),
      );
      return {
        status: "reconciliation_required",
        transactionHash: attempt.transactionHash,
      };
    }
  }

  private async failBeforeSubmission(
    requestId: string,
    error: unknown,
  ): Promise<SharedIssuanceOrchestrationResult> {
    const failureCode = safeFailureCode(error);
    await this.dependencies.store.transition(requestId, "failed", failureCode);
    return { status: "failed_before_submission", failureCode };
  }
}

function assertSingleAttemptHistory(
  attempts: ImmutableSharedIssuanceTransactionAttempt[],
): void {
  if (attempts.length > 1 || (attempts[0] && attempts[0].attemptNumber !== 1)) {
    throw new SharedIssuanceOrchestrationError("invalid_attempt_history");
  }
}

function assertAuthenticatedIntent(
  input: { projectId: string; ownerPublicKey: string },
  intent: ImmutableSharedIssuanceIntent,
): void {
  if (
    intent.projectId !== input.projectId ||
    intent.ownerPublicKey !== input.ownerPublicKey ||
    intent.destinationPublicKey !== input.ownerPublicKey
  ) {
    throw new SharedIssuanceOrchestrationError("owner_intent_mismatch");
  }
}

function manualHandoff(
  intent: ImmutableSharedIssuanceIntent,
  attempt: ImmutableSharedIssuanceTransactionAttempt,
  plan: SharedIssuerIssuancePlan,
): ManualSharedIssuanceSigningHandoff {
  return {
    status: "awaiting_manual_signature",
    requestId: intent.issuanceRequestId,
    attemptId: attempt.attemptId,
    projectId: intent.projectId,
    ownerPublicKey: intent.ownerPublicKey,
    network: "testnet",
    networkPassphrase: SHARED_ISSUER_TESTNET_PASSPHRASE,
    issuerPublicKey: intent.issuerPublicKey,
    destinationPublicKey: intent.destinationPublicKey,
    assetCode: intent.assetCode,
    amount: intent.amount,
    transactionHash: attempt.transactionHash,
    unsignedEnvelopeXdr: plan.unsignedEnvelopeXdr,
    unsignedEnvelopeXdrSha256: attempt.envelopeXdrSha256,
    sourceSequence: attempt.sourceSequence,
    feeStroops: attempt.feeStroops,
    validFrom: attempt.validFrom,
    validUntil: attempt.validUntil,
  };
}

function confirmed(
  confirmation: ImmutableSharedIssuanceLedgerConfirmation,
): SharedIssuanceOrchestrationResult {
  return {
    status: "confirmed",
    transactionHash: confirmation.transactionHash,
    ledgerSequence: confirmation.ledgerSequence,
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function safeFailureCode(error: unknown): string {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string" &&
    /^[a-z0-9_]{1,80}$/.test(error.code)
  ) {
    return error.code;
  }
  return "execution_failed_before_submission";
}
