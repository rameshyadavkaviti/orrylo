import { createHash, randomUUID } from "node:crypto";

import type {
  ImmutableSharedIssuanceIntent,
  ImmutableSharedIssuanceLedgerConfirmation,
  ImmutableSharedIssuanceTransactionAttempt,
  TrustedLedgerConfirmationWriter,
} from "./shared-issuance-persistence";
import {
  buildSharedIssuerIssuancePlan,
  type SharedIssuerSignerAuthorization,
  type SharedIssuerSubmissionAdapter,
} from "../../stellar/shared-issuer-issuance";
import {
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
      "intent_not_found" | "owner_intent_mismatch" | "invalid_attempt_history",
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

    const attempts = await this.dependencies.store.listAttempts(
      input.requestId,
    );
    if (
      attempts.length > 1 ||
      (attempts[0] && attempts[0].attemptNumber !== 1)
    ) {
      throw new SharedIssuanceOrchestrationError("invalid_attempt_history");
    }
    if (attempts[0]) return this.reconcile(intent, attempts[0]);

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

    const claimed = await this.dependencies.store.transition(
      input.requestId,
      "pending_execution",
    );
    if (!claimed) {
      const concurrentAttempts = await this.dependencies.store.listAttempts(
        input.requestId,
      );
      if (concurrentAttempts[0])
        return this.reconcile(intent, concurrentAttempts[0]);
      return { status: "preparing_issuance" };
    }
    let preflight: SharedIssuerTestnetPreflightResult;
    try {
      preflight = await this.dependencies.preflight.readIssuancePreconditions({
        issuerPublicKey: intent.issuerPublicKey,
        destinationPublicKey: intent.destinationPublicKey,
        assetCode: intent.assetCode,
        assetCodeReservedForProject: true,
        feeStroops: this.dependencies.feeStroops,
      });
    } catch (error) {
      return this.failBeforeSubmission(input.requestId, error);
    }

    const now = this.dependencies.now?.() ?? Date.now();
    const validFrom = Math.floor(now / 1_000);
    let plan;
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

    const attempt: ImmutableSharedIssuanceTransactionAttempt = {
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
      await this.dependencies.store.appendAttempt(attempt);
      const signed = await signDurableSharedIssuerTestnetEnvelope({
        reader: this.dependencies.store,
        attemptId: attempt.attemptId,
        plan,
        policy: { issuerPublicKey: intent.issuerPublicKey },
        primitive: this.dependencies.primitive,
      });
      await persistAndSubmitSharedIssuerEnvelope({
        writer: this.dependencies.store,
        attemptId: attempt.attemptId,
        plan,
        signedEnvelopeXdr: signed.signedEnvelopeXdr,
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
      return this.failBeforeSubmission(input.requestId, error);
    }

    const persistedAttempt = await this.dependencies.store.getAttempt(
      attempt.attemptId,
    );
    if (!persistedAttempt) {
      throw new SharedIssuanceOrchestrationError("invalid_attempt_history");
    }
    return this.reconcile(intent, persistedAttempt);
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
