/**
 * Future server-only secure Shared Issuer integration boundary.
 * This contract does NOT provide issuer signing, custody or transaction construction.
 * The reviewed Stellar Agent interface must replace the unavailable implementation.
 */
export interface SharedIssuerSubmission {
  requestId: string;
  projectId: string;
  network: "testnet";
  assetCode: string;
}

export type SharedIssuerSubmissionResult =
  | { status: "submitted"; transactionHash: string }
  | { status: "reconciliation_required"; transactionHash: string | null };

export interface SharedIssuerLookup {
  requestId: string;
  transactionHash: string;
  network: "testnet";
}

export type SharedIssuerLookupResult =
  | { status: "pending" }
  | { status: "failed"; failureCode: string }
  | {
      status: "confirmed";
      issuerPublicKey: string;
      transactionHash: string;
      ledgerSequence: number;
    };

export interface SharedIssuerExecutionAdapter {
  submit(request: SharedIssuerSubmission): Promise<SharedIssuerSubmissionResult>;
  lookup(request: SharedIssuerLookup): Promise<SharedIssuerLookupResult>;
}

export class SharedIssuerUnavailableError extends Error {
  readonly code = "issuer_integration_unavailable";

  constructor() {
    super("The reviewed Testnet Shared Issuer integration is not available.");
    this.name = "SharedIssuerUnavailableError";
  }
}

/** Deliberately no network access, signing, or transaction side effects. */
export class UnavailableSharedIssuerExecutionAdapter
  implements SharedIssuerExecutionAdapter
{
  async submit(_request: SharedIssuerSubmission): Promise<SharedIssuerSubmissionResult> {
    throw new SharedIssuerUnavailableError();
  }

  async lookup(_request: SharedIssuerLookup): Promise<SharedIssuerLookupResult> {
    throw new SharedIssuerUnavailableError();
  }
}
