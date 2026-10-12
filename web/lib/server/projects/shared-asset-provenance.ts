/**
 * Immutable confirmation provenance returned by a future independently
 * reviewed Stellar Testnet confirmation reader.
 *
 * The persistence schema can store this evidence, but this integration branch
 * deliberately provides no database-to-application reader. Database rows are
 * not, by themselves, proof that the ledger was queried and verified.
 */
export interface VerifiedSharedAssetProvenance {
  confirmationId: string;
  projectId: string;
  ownerPublicKey: string;
  network: "testnet";
  assetCode: string;
  issuerPublicKey: string;
  destinationPublicKey: string;
  amount: string;
  issuanceRequestId: string;
  issuanceIntentFingerprint: string;
  transactionHash: string;
  /** Exact digest of the decorated envelope proved by post-009 validation. */
  signedEnvelopeXdrSha256: string;
  ledgerSequence: number;
}

export interface SharedAssetConfirmationReader {
  findConfirmed(
    projectId: string,
    ownerPublicKey: string,
  ): Promise<VerifiedSharedAssetProvenance | null>;
}

/**
 * Production default until a real Stellar ledger reader and its custody,
 * reconciliation, and enablement controls receive independent approval.
 */
export class UnavailableSharedAssetConfirmationReader implements SharedAssetConfirmationReader {
  async findConfirmed(
    projectId: string,
    ownerPublicKey: string,
  ): Promise<null> {
    void projectId;
    void ownerPublicKey;
    return null;
  }
}
