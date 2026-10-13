import { createHash } from "node:crypto";

import type {
  SharedIssuerIssuancePlan,
  SharedIssuerSigner,
  SharedIssuerSigningRequest,
  SharedIssuerSubmissionAdapter,
  SharedIssuerSubmissionResult,
  SharedIssuerTransactionLookup,
} from "./shared-issuer-issuance";
import {
  SharedIssuerIssuanceError,
  assertSharedIssuerIssuancePlanCanonical,
  assertSignedEnvelopeAuthorizedForSubmission,
  assertSubmissionHashMatchesPlan,
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

export interface SignedEnvelopeAttemptWriter {
  recordSignedEnvelope(input: {
    attemptId: string;
    transactionHash: string;
    signedEnvelopeXdrSha256: string;
  }): Promise<{ signedEnvelopeXdrSha256?: string }>;
}

/**
 * Future execution ordering boundary. It validates signatures, durably records
 * the decorated-envelope digest, and only then invokes the supplied submission
 * adapter. The production adapter remains unavailable.
 */
export async function persistAndSubmitSharedIssuerEnvelope(input: {
  writer: SignedEnvelopeAttemptWriter;
  attemptId: string;
  plan: SharedIssuerIssuancePlan;
  signedEnvelopeXdr: string;
  authorization: SharedIssuerSignerAuthorization;
  submission: SharedIssuerSubmissionAdapter;
}): Promise<SharedIssuerSubmissionResult> {
  assertSharedIssuerIssuancePlanCanonical(input.plan);
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
