import type {
  SharedIssuerIssuancePlan,
  SharedIssuerSigner,
  SharedIssuerSigningRequest,
  SharedIssuerSubmissionAdapter,
  SharedIssuerSubmissionResult,
  SharedIssuerTransactionLookup,
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
