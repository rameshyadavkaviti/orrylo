/**
 * Application-facing shapes for migration 007's immutable persistence
 * contract. These are data contracts only; this branch intentionally provides
 * no executable writer implementation.
 */
export interface ImmutableSharedIssuanceIntent {
  issuanceRequestId: string;
  issuanceIntentFingerprint: string;
  reservationFingerprint: string;
  projectId: string;
  ownerPublicKey: string;
  network: "testnet";
  networkPassphraseHash: string;
  assetCode: string;
  issuerPublicKey: string;
  destinationPublicKey: string;
  amount: string;
  policyVersion: string;
  createdAt: string;
}

export interface ImmutableSharedIssuanceTransactionAttempt {
  attemptId: string;
  issuanceRequestId: string;
  issuanceIntentFingerprint: string;
  attemptNumber: number;
  transactionHash: string;
  envelopeXdrSha256: string;
  sourceSequence: string;
  feeStroops: string;
  validFrom: number;
  validUntil: number;
  transactionSourcePublicKey: string;
  operationCount: 1;
  operationType: "payment";
  operationSourcePublicKey: string;
  assetCode: string;
  issuerPublicKey: string;
  destinationPublicKey: string;
  amount: string;
  createdAt: string;
}

export interface ImmutableSharedIssuanceLedgerConfirmation {
  confirmationId: string;
  issuanceRequestId: string;
  issuanceIntentFingerprint: string;
  attemptId: string;
  projectId: string;
  ownerPublicKey: string;
  network: "testnet";
  networkPassphraseHash: string;
  transactionHash: string;
  envelopeXdrSha256: string;
  resultXdrSha256: string;
  resultSuccess: true;
  ledgerSequence: number;
  ledgerClosedAt: string;
  transactionSourcePublicKey: string;
  operationCount: 1;
  operationType: "payment";
  operationSourcePublicKey: string;
  assetCode: string;
  issuerPublicKey: string;
  destinationPublicKey: string;
  amount: string;
  sourceSequence: string;
  verifierIdentity: string;
  verificationPolicyVersion: string;
  verifiedAt: string;
  createdAt: string;
}

export interface SharedIssuancePersistenceWriter {
  appendIntent(intent: ImmutableSharedIssuanceIntent): Promise<void>;
  appendAttempt(
    attempt: ImmutableSharedIssuanceTransactionAttempt,
  ): Promise<void>;
}

export interface TrustedLedgerConfirmationWriter {
  appendConfirmation(
    confirmation: ImmutableSharedIssuanceLedgerConfirmation,
  ): Promise<void>;
}

export class SharedIssuancePersistenceUnavailableError extends Error {
  readonly code = "issuer_integration_unavailable";

  constructor() {
    super("The reviewed Shared Issuer persistence writer is unavailable.");
    this.name = "SharedIssuancePersistenceUnavailableError";
  }
}

export class UnavailableSharedIssuancePersistenceWriter implements SharedIssuancePersistenceWriter {
  async appendIntent(intent: ImmutableSharedIssuanceIntent): Promise<never> {
    void intent;
    throw new SharedIssuancePersistenceUnavailableError();
  }

  async appendAttempt(
    attempt: ImmutableSharedIssuanceTransactionAttempt,
  ): Promise<never> {
    void attempt;
    throw new SharedIssuancePersistenceUnavailableError();
  }
}

export class UnavailableTrustedLedgerConfirmationWriter implements TrustedLedgerConfirmationWriter {
  async appendConfirmation(
    confirmation: ImmutableSharedIssuanceLedgerConfirmation,
  ): Promise<never> {
    void confirmation;
    throw new SharedIssuancePersistenceUnavailableError();
  }
}
