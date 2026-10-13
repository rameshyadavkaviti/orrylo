import { createHash } from "node:crypto";

import type {
  ImmutableSharedIssuanceIntent,
  ImmutableSharedIssuanceTransactionAttempt,
  SharedIssuancePersistenceRepository,
} from "../server/projects/shared-issuance-persistence";
import type {
  SharedIssuerIssuancePlan,
  SharedIssuerSigner,
  SharedIssuerSigningRequest,
  SharedIssuerSubmissionAdapter,
  SharedIssuerSubmissionResult,
  SharedIssuerTransactionLookup,
} from "./shared-issuer-issuance";
import {
  SHARED_ISSUANCE_POLICY_VERSION,
  SHARED_ISSUER_TESTNET_NETWORK,
  SHARED_ISSUER_TESTNET_PASSPHRASE,
  SharedIssuerIssuanceError,
  assertSharedIssuerIssuancePlanCanonical,
  assertSignedEnvelopeAuthorizedForSubmission,
  assertSignedEnvelopeMatchesPlan,
  assertSubmissionHashMatchesPlan,
  createSharedIssuerSigningRequest,
  hashSharedIssuerIssuanceIntent,
  type SharedIssuerSignerAuthorization,
} from "./shared-issuer-issuance";

/**
 * Typed future integration with the Security-reviewed PR #27 Stellar boundary.
 * Preparation is pure and requires explicit ledger/issuer inputs; signing,
 * submission and lookup are separate facilities and currently unavailable.
 */
export interface SharedIssuerExecutionAdapter
  extends SharedIssuerSubmissionAdapter, SharedIssuerSigner {
  lookupTransaction(
    transactionHash: string,
  ): Promise<SharedIssuerTransactionLookup>;
}

export class SharedIssuerUnavailableError extends Error {
  readonly code = "issuer_integration_unavailable";
  constructor() {
    super(
      "The reviewed Testnet Shared Issuer execution service is unavailable.",
    );
    this.name = "SharedIssuerUnavailableError";
  }
}

/** No signing, Horizon requests, account mutation, or network side effects. */
export class UnavailableSharedIssuerExecutionAdapter implements SharedIssuerExecutionAdapter {
  async signCanonicalEnvelope(
    _request: SharedIssuerSigningRequest,
  ): Promise<{ signedEnvelopeXdr: string }> {
    void _request;
    throw new SharedIssuerUnavailableError();
  }

  async submitSignedEnvelope(
    _signedEnvelopeXdr: string,
  ): Promise<SharedIssuerSubmissionResult> {
    void _signedEnvelopeXdr;
    throw new SharedIssuerUnavailableError();
  }

  async lookupTransaction(
    _transactionHash: string,
  ): Promise<SharedIssuerTransactionLookup> {
    void _transactionHash;
    throw new SharedIssuerUnavailableError();
  }
}

/** Explicit compile-time compatibility check with PR #27's immutable plan. */
export type PreparedSharedIssuerOperation = {
  plan: SharedIssuerIssuancePlan;
  signer: SharedIssuerSigner;
  submission: SharedIssuerSubmissionAdapter;
};

export type SharedIssuerDurableExecutionReader = Pick<
  SharedIssuancePersistenceRepository,
  "getAttempt" | "getIntent"
>;

export type SignedEnvelopeAttemptWriter = Pick<
  SharedIssuancePersistenceRepository,
  "getAttempt" | "getIntent" | "recordSignedEnvelope"
>;

export async function loadAndAssertDurableSharedIssuerPlan(input: {
  reader: SharedIssuerDurableExecutionReader;
  attemptId: string;
  plan: SharedIssuerIssuancePlan;
}): Promise<{
  intent: ImmutableSharedIssuanceIntent;
  attempt: ImmutableSharedIssuanceTransactionAttempt;
}> {
  assertSharedIssuerIssuancePlanCanonical(input.plan);

  const attempt = await input.reader.getAttempt(input.attemptId);
  if (!attempt) {
    throwDurablePlanMismatch();
  }

  const intent = await input.reader.getIntent(attempt.issuanceRequestId);
  if (!intent) {
    throwDurablePlanMismatch();
  }

  assertDurableRecordsMatchPlan({
    intent,
    attempt,
    attemptId: input.attemptId,
    plan: input.plan,
  });

  return { intent, attempt };
}

/**
 * The only execution helper that invokes a Shared Issuer signer. Durable
 * intent/attempt evidence is loaded and bound to the canonical plan first.
 */
export async function signPersistedSharedIssuerEnvelope(input: {
  reader: SharedIssuerDurableExecutionReader;
  attemptId: string;
  plan: SharedIssuerIssuancePlan;
  signer: SharedIssuerSigner;
}): Promise<{ signedEnvelopeXdr: string }> {
  await loadAndAssertDurableSharedIssuerPlan({
    reader: input.reader,
    attemptId: input.attemptId,
    plan: input.plan,
  });

  const signed = await input.signer.signCanonicalEnvelope(
    createSharedIssuerSigningRequest(input.plan),
  );
  assertSignedEnvelopeMatchesPlan(signed.signedEnvelopeXdr, input.plan);
  return signed;
}

/**
 * Future execution ordering boundary. It binds the canonical plan to durable
 * intent/attempt evidence, validates signatures, durably records the decorated
 * envelope digest, revalidates the returned attempt, and only then invokes the
 * supplied submission adapter. The production adapter remains unavailable.
 */
export async function persistAndSubmitSharedIssuerEnvelope(input: {
  writer: SignedEnvelopeAttemptWriter;
  attemptId: string;
  plan: SharedIssuerIssuancePlan;
  signedEnvelopeXdr: string;
  authorization: SharedIssuerSignerAuthorization;
  submission: SharedIssuerSubmissionAdapter;
}): Promise<SharedIssuerSubmissionResult> {
  const { intent } = await loadAndAssertDurableSharedIssuerPlan({
    reader: input.writer,
    attemptId: input.attemptId,
    plan: input.plan,
  });
  assertSignedEnvelopeAuthorizedForSubmission(
    input.signedEnvelopeXdr,
    input.plan,
    input.authorization,
  );
  const signedEnvelopeXdrSha256 = createHash("sha256")
    .update(input.signedEnvelopeXdr, "utf8")
    .digest("hex");
  const persisted = await input.writer.recordSignedEnvelope({
    attemptId: input.attemptId,
    transactionHash: input.plan.transactionHash,
    signedEnvelopeXdrSha256,
  });
  assertDurableRecordsMatchPlan({
    intent,
    attempt: persisted,
    attemptId: input.attemptId,
    plan: input.plan,
  });
  if (persisted.signedEnvelopeXdrSha256 !== signedEnvelopeXdrSha256) {
    throw new SharedIssuerIssuanceError(
      "signed_envelope_mismatch",
      "Persisted signed-envelope digest does not match the authorized envelope.",
    );
  }

  const result = await input.submission.submitSignedEnvelope(
    input.signedEnvelopeXdr,
  );
  assertSubmissionHashMatchesPlan(result, input.plan);
  return result;
}

function assertDurableRecordsMatchPlan(input: {
  intent: ImmutableSharedIssuanceIntent;
  attempt: ImmutableSharedIssuanceTransactionAttempt;
  attemptId: string;
  plan: SharedIssuerIssuancePlan;
}): void {
  const { intent, attempt, plan } = input;
  const networkPassphraseHash = createHash("sha256")
    .update(SHARED_ISSUER_TESTNET_PASSPHRASE, "utf8")
    .digest("hex");
  const unsignedEnvelopeXdrSha256 = createHash("sha256")
    .update(plan.unsignedEnvelopeXdr, "utf8")
    .digest("hex");
  const durableIntentFingerprint = hashSharedIssuerIssuanceIntent({
    policyVersion: SHARED_ISSUANCE_POLICY_VERSION,
    projectId: intent.projectId,
    network: SHARED_ISSUER_TESTNET_NETWORK,
    assetCode: intent.assetCode,
    issuerPublicKey: intent.issuerPublicKey,
    destinationPublicKey: intent.destinationPublicKey,
    amount: intent.amount,
  });

  if (
    attempt.attemptId !== input.attemptId ||
    attempt.attemptNumber !== 1 ||
    attempt.issuanceRequestId !== intent.issuanceRequestId ||
    attempt.issuanceIntentFingerprint !== intent.issuanceIntentFingerprint ||
    intent.issuanceIntentFingerprint !== durableIntentFingerprint ||
    plan.intentFingerprint !== intent.issuanceIntentFingerprint ||
    intent.projectId !== plan.intent.projectId ||
    intent.ownerPublicKey !== intent.destinationPublicKey ||
    intent.ownerPublicKey !== plan.intent.destinationPublicKey ||
    intent.network !== SHARED_ISSUER_TESTNET_NETWORK ||
    intent.networkPassphraseHash !== networkPassphraseHash ||
    intent.policyVersion !== SHARED_ISSUANCE_POLICY_VERSION ||
    intent.assetCode !== plan.intent.assetCode ||
    intent.issuerPublicKey !== plan.intent.issuerPublicKey ||
    intent.destinationPublicKey !== plan.intent.destinationPublicKey ||
    intent.amount !== plan.intent.amount ||
    attempt.transactionHash !== plan.transactionHash ||
    attempt.envelopeXdrSha256 !== unsignedEnvelopeXdrSha256 ||
    attempt.sourceSequence !== plan.sourceSequence ||
    attempt.feeStroops !== plan.feeStroops ||
    attempt.validFrom !== plan.validFrom ||
    attempt.validUntil !== plan.validUntil ||
    attempt.transactionSourcePublicKey !== plan.intent.issuerPublicKey ||
    attempt.operationCount !== 1 ||
    attempt.operationType !== "payment" ||
    attempt.operationSourcePublicKey !== plan.intent.issuerPublicKey ||
    attempt.assetCode !== plan.intent.assetCode ||
    attempt.issuerPublicKey !== plan.intent.issuerPublicKey ||
    attempt.destinationPublicKey !== plan.intent.destinationPublicKey ||
    attempt.amount !== plan.intent.amount
  ) {
    throwDurablePlanMismatch();
  }
}

function throwDurablePlanMismatch(): never {
  throw new SharedIssuerIssuanceError(
    "canonical_plan_mismatch",
    "Canonical issuance plan does not match the persisted immutable issuance intent and transaction attempt.",
  );
}
