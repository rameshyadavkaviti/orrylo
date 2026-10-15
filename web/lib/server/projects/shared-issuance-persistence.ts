import type {
  SharedIssuanceApplicationDatabaseBoundary,
  TrustedConfirmationWriterDatabaseBoundary,
} from "../persistence/issuance-database-boundaries";
import type { ValidatedSharedIssuanceLedgerConfirmation } from "../../stellar/testnet-ledger-confirmation";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const PUBLIC_KEY_PATTERN = /^G[A-Z2-7]{55}$/;
const ASSET_CODE_PATTERN = /^[A-Z0-9]{1,12}$/;
const AMOUNT_PATTERN = /^(?:0|[1-9][0-9]*)\.[0-9]{7}$/;
const INTEGER_PATTERN = /^[0-9]+$/;

/** Application-facing shapes for migration 007's immutable contract. */
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
  /** Digest of the unsigned envelope persisted before signing. */
  envelopeXdrSha256: string;
  /** Digest of the fully decorated envelope, populated once after signing. */
  signedEnvelopeXdrSha256?: string;
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
  /** Digest of the unsigned envelope persisted before signing. */
  envelopeXdrSha256: string;
  signedEnvelopeXdrSha256?: string;
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

export interface SharedIssuancePersistenceRepository {
  appendIntent(
    intent: ImmutableSharedIssuanceIntent,
  ): Promise<ImmutableSharedIssuanceIntent>;
  appendAttempt(
    attempt: ImmutableSharedIssuanceTransactionAttempt,
  ): Promise<ImmutableSharedIssuanceTransactionAttempt>;
  recordSignedEnvelope(input: {
    attemptId: string;
    transactionHash: string;
    signedEnvelopeXdrSha256: string;
  }): Promise<ImmutableSharedIssuanceTransactionAttempt>;
  getIntent(
    issuanceRequestId: string,
  ): Promise<ImmutableSharedIssuanceIntent | null>;
  getAttempt(
    attemptId: string,
  ): Promise<ImmutableSharedIssuanceTransactionAttempt | null>;
  listAttempts(
    issuanceRequestId: string,
  ): Promise<ImmutableSharedIssuanceTransactionAttempt[]>;
  getConfirmation(
    issuanceRequestId: string,
  ): Promise<ImmutableSharedIssuanceLedgerConfirmation | null>;
}

export type SharedIssuancePersistenceWriter =
  SharedIssuancePersistenceRepository;

export interface TrustedLedgerConfirmationWriter {
  appendConfirmation(
    confirmation: ValidatedSharedIssuanceLedgerConfirmation,
  ): Promise<ImmutableSharedIssuanceLedgerConfirmation>;
}

export class SharedIssuancePersistenceUnavailableError extends Error {
  readonly code = "issuer_integration_unavailable";

  constructor() {
    super("The reviewed Shared Issuer persistence writer is unavailable.");
    this.name = "SharedIssuancePersistenceUnavailableError";
  }
}

export class SharedIssuancePersistenceConflictError extends Error {
  readonly code = "immutable_issuance_persistence_conflict";

  constructor() {
    super("Immutable issuance evidence conflicts with the persisted record.");
    this.name = "SharedIssuancePersistenceConflictError";
  }
}

interface IntentRow {
  issuance_request_id: string;
  issuance_intent_fingerprint: string;
  reservation_fingerprint: string;
  project_id: string;
  owner_public_key: string;
  network: "testnet";
  network_passphrase_hash: string;
  asset_code: string;
  issuer_public_key: string;
  destination_public_key: string;
  amount: string;
  policy_version: string;
  created_at: Date;
}

interface AttemptRow {
  attempt_id: string;
  issuance_request_id: string;
  issuance_intent_fingerprint: string;
  attempt_number: number;
  transaction_hash: string;
  envelope_xdr_sha256: string;
  signed_envelope_xdr_sha256: string | null;
  source_sequence: string;
  fee_stroops: string;
  valid_from: string;
  valid_until: string;
  transaction_source_public_key: string;
  operation_count: 1;
  operation_type: "payment";
  operation_source_public_key: string;
  asset_code: string;
  issuer_public_key: string;
  destination_public_key: string;
  amount: string;
  created_at: Date;
}

interface ConfirmationRow {
  confirmation_id: string;
  issuance_request_id: string;
  issuance_intent_fingerprint: string;
  attempt_id: string;
  project_id: string;
  owner_public_key: string;
  network: "testnet";
  network_passphrase_hash: string;
  transaction_hash: string;
  envelope_xdr_sha256: string;
  signed_envelope_xdr_sha256: string | null;
  result_xdr_sha256: string;
  result_success: true;
  ledger_sequence: string;
  ledger_closed_at: Date;
  transaction_source_public_key: string;
  operation_count: 1;
  operation_type: "payment";
  operation_source_public_key: string;
  asset_code: string;
  issuer_public_key: string;
  destination_public_key: string;
  amount: string;
  source_sequence: string;
  verifier_identity: string;
  verification_policy_version: string;
  verified_at: Date;
  created_at: Date;
}

export class PostgresSharedIssuancePersistenceRepository implements SharedIssuancePersistenceRepository {
  constructor(
    private readonly boundary: SharedIssuanceApplicationDatabaseBoundary,
  ) {
    boundary.assertAuthorized();
  }

  async appendIntent(
    intent: ImmutableSharedIssuanceIntent,
  ): Promise<ImmutableSharedIssuanceIntent> {
    assertIntent(intent);
    const sql = this.boundary.sql;
    await sql`
      INSERT INTO project_issuance_full_intents (
        issuance_request_id, issuance_intent_fingerprint,
        reservation_fingerprint, project_id, owner_public_key, network,
        network_passphrase_hash, asset_code, issuer_public_key,
        destination_public_key, amount, policy_version, created_at
      ) VALUES (
        ${intent.issuanceRequestId}, ${intent.issuanceIntentFingerprint},
        ${intent.reservationFingerprint}, ${intent.projectId},
        ${intent.ownerPublicKey}, 'testnet', ${intent.networkPassphraseHash},
        ${intent.assetCode}, ${intent.issuerPublicKey},
        ${intent.destinationPublicKey}, ${intent.amount},
        ${intent.policyVersion}, ${new Date(intent.createdAt)}
      )
      ON CONFLICT DO NOTHING
    `;
    const stored = await this.getIntent(intent.issuanceRequestId);
    if (!stored || !sameRecord(stored, intent)) {
      throw new SharedIssuancePersistenceConflictError();
    }
    return stored;
  }

  async appendAttempt(
    attempt: ImmutableSharedIssuanceTransactionAttempt,
  ): Promise<ImmutableSharedIssuanceTransactionAttempt> {
    assertAttempt(attempt);
    if (attempt.signedEnvelopeXdrSha256 !== undefined) {
      throw new SharedIssuancePersistenceConflictError();
    }
    const intent = await this.getIntent(attempt.issuanceRequestId);
    if (!intent || !attemptMatchesIntent(attempt, intent)) {
      throw new SharedIssuancePersistenceConflictError();
    }
    const sql = this.boundary.sql;
    await sql`
      INSERT INTO project_issuance_transaction_attempts (
        attempt_id, issuance_request_id, issuance_intent_fingerprint,
        attempt_number, transaction_hash, envelope_xdr_sha256,
        source_sequence, fee_stroops, valid_from, valid_until,
        transaction_source_public_key, operation_count, operation_type,
        operation_source_public_key, asset_code, issuer_public_key,
        destination_public_key, amount, created_at
      ) VALUES (
        ${attempt.attemptId}, ${attempt.issuanceRequestId},
        ${attempt.issuanceIntentFingerprint}, ${attempt.attemptNumber},
        ${attempt.transactionHash}, ${attempt.envelopeXdrSha256},
        ${attempt.sourceSequence}, ${attempt.feeStroops},
        ${attempt.validFrom}, ${attempt.validUntil},
        ${attempt.transactionSourcePublicKey}, 1, 'payment',
        ${attempt.operationSourcePublicKey}, ${attempt.assetCode},
        ${attempt.issuerPublicKey}, ${attempt.destinationPublicKey},
        ${attempt.amount}, ${new Date(attempt.createdAt)}
      )
      ON CONFLICT DO NOTHING
    `;
    const stored = await this.getAttempt(attempt.attemptId);
    if (!stored || !sameRecord(stored, attempt)) {
      throw new SharedIssuancePersistenceConflictError();
    }
    return stored;
  }

  async recordSignedEnvelope(input: {
    attemptId: string;
    transactionHash: string;
    signedEnvelopeXdrSha256: string;
  }): Promise<ImmutableSharedIssuanceTransactionAttempt> {
    if (
      !UUID_PATTERN.test(input.attemptId) ||
      !HASH_PATTERN.test(input.transactionHash) ||
      !HASH_PATTERN.test(input.signedEnvelopeXdrSha256)
    ) {
      throw new SharedIssuancePersistenceConflictError();
    }
    const [row] = await this.boundary.sql<AttemptRow[]>`
      UPDATE project_issuance_transaction_attempts
      SET signed_envelope_xdr_sha256 = ${input.signedEnvelopeXdrSha256}
      WHERE attempt_id = ${input.attemptId}
        AND transaction_hash = ${input.transactionHash}
        AND signed_envelope_xdr_sha256 IS NULL
      RETURNING *
    `;
    if (!row) {
      throw new SharedIssuancePersistenceConflictError();
    }
    const stored = mapAttempt(row);
    if (
      stored.transactionHash !== input.transactionHash ||
      stored.signedEnvelopeXdrSha256 !== input.signedEnvelopeXdrSha256
    ) {
      throw new SharedIssuancePersistenceConflictError();
    }
    return stored;
  }

  async getIntent(
    issuanceRequestId: string,
  ): Promise<ImmutableSharedIssuanceIntent | null> {
    if (!UUID_PATTERN.test(issuanceRequestId)) return null;
    const [row] = await this.boundary.sql<IntentRow[]>`
      SELECT * FROM project_issuance_full_intents
      WHERE issuance_request_id = ${issuanceRequestId}
    `;
    return row ? mapIntent(row) : null;
  }

  async getAttempt(
    attemptId: string,
  ): Promise<ImmutableSharedIssuanceTransactionAttempt | null> {
    if (!UUID_PATTERN.test(attemptId)) return null;
    const [row] = await this.boundary.sql<AttemptRow[]>`
      SELECT * FROM project_issuance_transaction_attempts
      WHERE attempt_id = ${attemptId}
    `;
    return row ? mapAttempt(row) : null;
  }

  async listAttempts(
    issuanceRequestId: string,
  ): Promise<ImmutableSharedIssuanceTransactionAttempt[]> {
    if (!UUID_PATTERN.test(issuanceRequestId)) return [];
    const rows = await this.boundary.sql<AttemptRow[]>`
      SELECT * FROM project_issuance_transaction_attempts
      WHERE issuance_request_id = ${issuanceRequestId}
      ORDER BY attempt_number
    `;
    return rows.map(mapAttempt);
  }

  async getConfirmation(
    issuanceRequestId: string,
  ): Promise<ImmutableSharedIssuanceLedgerConfirmation | null> {
    if (!UUID_PATTERN.test(issuanceRequestId)) return null;
    const [row] = await this.boundary.sql<ConfirmationRow[]>`
      SELECT * FROM project_issuance_ledger_confirmations
      WHERE issuance_request_id = ${issuanceRequestId}
    `;
    return row ? mapConfirmation(row) : null;
  }
}

export class PostgresTrustedLedgerConfirmationWriter implements TrustedLedgerConfirmationWriter {
  constructor(
    private readonly boundary: TrustedConfirmationWriterDatabaseBoundary,
  ) {
    boundary.assertAuthorized();
  }

  async appendConfirmation(
    confirmation: ValidatedSharedIssuanceLedgerConfirmation,
  ): Promise<ImmutableSharedIssuanceLedgerConfirmation> {
    confirmation.assertValidated();
    const record = confirmation.record;
    const sql = this.boundary.sql;
    await sql`
      INSERT INTO project_issuance_ledger_confirmations (
        confirmation_id, issuance_request_id, issuance_intent_fingerprint,
        attempt_id, project_id, owner_public_key, network,
        network_passphrase_hash, transaction_hash, envelope_xdr_sha256,
        signed_envelope_xdr_sha256, result_xdr_sha256, result_success,
        ledger_sequence, ledger_closed_at,
        transaction_source_public_key, operation_count, operation_type,
        operation_source_public_key, asset_code, issuer_public_key,
        destination_public_key, amount, source_sequence, verifier_identity,
        verification_policy_version, verified_at, created_at
      ) VALUES (
        ${record.confirmationId}, ${record.issuanceRequestId},
        ${record.issuanceIntentFingerprint}, ${record.attemptId},
        ${record.projectId}, ${record.ownerPublicKey}, 'testnet',
        ${record.networkPassphraseHash}, ${record.transactionHash},
        ${record.envelopeXdrSha256},
        ${record.signedEnvelopeXdrSha256 ?? null},
        ${record.resultXdrSha256}, true,
        ${record.ledgerSequence}, ${new Date(record.ledgerClosedAt)},
        ${record.transactionSourcePublicKey}, 1, 'payment',
        ${record.operationSourcePublicKey}, ${record.assetCode},
        ${record.issuerPublicKey}, ${record.destinationPublicKey},
        ${record.amount}, ${record.sourceSequence}, ${record.verifierIdentity},
        ${record.verificationPolicyVersion}, ${new Date(record.verifiedAt)},
        ${new Date(record.createdAt)}
      )
      ON CONFLICT DO NOTHING
    `;
    const [row] = await sql<ConfirmationRow[]>`
      SELECT * FROM project_issuance_ledger_confirmations
      WHERE confirmation_id = ${record.confirmationId}
    `;
    const stored = row ? mapConfirmation(row) : null;
    if (!stored || !sameRecord(stored, record)) {
      throw new SharedIssuancePersistenceConflictError();
    }
    return stored;
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

  async recordSignedEnvelope(_input: {
    attemptId: string;
    transactionHash: string;
    signedEnvelopeXdrSha256: string;
  }): Promise<never> {
    void _input;
    throw new SharedIssuancePersistenceUnavailableError();
  }

  async getIntent(_issuanceRequestId: string): Promise<never> {
    void _issuanceRequestId;
    throw new SharedIssuancePersistenceUnavailableError();
  }

  async getAttempt(_attemptId: string): Promise<never> {
    void _attemptId;
    throw new SharedIssuancePersistenceUnavailableError();
  }

  async listAttempts(_issuanceRequestId: string): Promise<never> {
    void _issuanceRequestId;
    throw new SharedIssuancePersistenceUnavailableError();
  }

  async getConfirmation(_issuanceRequestId: string): Promise<never> {
    void _issuanceRequestId;
    throw new SharedIssuancePersistenceUnavailableError();
  }
}

export class UnavailableTrustedLedgerConfirmationWriter implements TrustedLedgerConfirmationWriter {
  async appendConfirmation(
    confirmation: ValidatedSharedIssuanceLedgerConfirmation,
  ): Promise<never> {
    void confirmation;
    throw new SharedIssuancePersistenceUnavailableError();
  }
}

function mapIntent(row: IntentRow): ImmutableSharedIssuanceIntent {
  return {
    issuanceRequestId: row.issuance_request_id,
    issuanceIntentFingerprint: row.issuance_intent_fingerprint.trim(),
    reservationFingerprint: row.reservation_fingerprint.trim(),
    projectId: row.project_id,
    ownerPublicKey: row.owner_public_key.trim(),
    network: row.network,
    networkPassphraseHash: row.network_passphrase_hash.trim(),
    assetCode: row.asset_code,
    issuerPublicKey: row.issuer_public_key.trim(),
    destinationPublicKey: row.destination_public_key.trim(),
    amount: row.amount,
    policyVersion: row.policy_version,
    createdAt: row.created_at.toISOString(),
  };
}

function mapAttempt(
  row: AttemptRow,
): ImmutableSharedIssuanceTransactionAttempt {
  const attempt: ImmutableSharedIssuanceTransactionAttempt = {
    attemptId: row.attempt_id,
    issuanceRequestId: row.issuance_request_id,
    issuanceIntentFingerprint: row.issuance_intent_fingerprint.trim(),
    attemptNumber: Number(row.attempt_number),
    transactionHash: row.transaction_hash.trim(),
    envelopeXdrSha256: row.envelope_xdr_sha256.trim(),
    sourceSequence: row.source_sequence,
    feeStroops: row.fee_stroops,
    validFrom: Number(row.valid_from),
    validUntil: Number(row.valid_until),
    transactionSourcePublicKey: row.transaction_source_public_key.trim(),
    operationCount: row.operation_count,
    operationType: row.operation_type,
    operationSourcePublicKey: row.operation_source_public_key.trim(),
    assetCode: row.asset_code,
    issuerPublicKey: row.issuer_public_key.trim(),
    destinationPublicKey: row.destination_public_key.trim(),
    amount: row.amount,
    createdAt: row.created_at.toISOString(),
  };
  if (row.signed_envelope_xdr_sha256 !== null) {
    attempt.signedEnvelopeXdrSha256 = row.signed_envelope_xdr_sha256.trim();
  }
  return attempt;
}

function mapConfirmation(
  row: ConfirmationRow,
): ImmutableSharedIssuanceLedgerConfirmation {
  const confirmation: ImmutableSharedIssuanceLedgerConfirmation = {
    confirmationId: row.confirmation_id,
    issuanceRequestId: row.issuance_request_id,
    issuanceIntentFingerprint: row.issuance_intent_fingerprint.trim(),
    attemptId: row.attempt_id,
    projectId: row.project_id,
    ownerPublicKey: row.owner_public_key.trim(),
    network: row.network,
    networkPassphraseHash: row.network_passphrase_hash.trim(),
    transactionHash: row.transaction_hash.trim(),
    envelopeXdrSha256: row.envelope_xdr_sha256.trim(),
    ...(row.signed_envelope_xdr_sha256 === null
      ? {}
      : {
          signedEnvelopeXdrSha256: row.signed_envelope_xdr_sha256.trim(),
        }),
    resultXdrSha256: row.result_xdr_sha256.trim(),
    resultSuccess: row.result_success,
    ledgerSequence: Number(row.ledger_sequence),
    ledgerClosedAt: row.ledger_closed_at.toISOString(),
    transactionSourcePublicKey: row.transaction_source_public_key.trim(),
    operationCount: row.operation_count,
    operationType: row.operation_type,
    operationSourcePublicKey: row.operation_source_public_key.trim(),
    assetCode: row.asset_code,
    issuerPublicKey: row.issuer_public_key.trim(),
    destinationPublicKey: row.destination_public_key.trim(),
    amount: row.amount,
    sourceSequence: row.source_sequence,
    verifierIdentity: row.verifier_identity,
    verificationPolicyVersion: row.verification_policy_version,
    verifiedAt: row.verified_at.toISOString(),
    createdAt: row.created_at.toISOString(),
  };
  return confirmation;
}

function assertIntent(intent: ImmutableSharedIssuanceIntent): void {
  if (
    !UUID_PATTERN.test(intent.issuanceRequestId) ||
    !UUID_PATTERN.test(intent.projectId) ||
    !HASH_PATTERN.test(intent.issuanceIntentFingerprint) ||
    !HASH_PATTERN.test(intent.reservationFingerprint) ||
    !HASH_PATTERN.test(intent.networkPassphraseHash) ||
    !PUBLIC_KEY_PATTERN.test(intent.ownerPublicKey) ||
    !PUBLIC_KEY_PATTERN.test(intent.issuerPublicKey) ||
    !PUBLIC_KEY_PATTERN.test(intent.destinationPublicKey) ||
    !ASSET_CODE_PATTERN.test(intent.assetCode) ||
    !AMOUNT_PATTERN.test(intent.amount) ||
    BigInt(intent.amount.replace(".", "")) <= 0n ||
    intent.network !== "testnet" ||
    !intent.policyVersion.trim() ||
    !validTimestamp(intent.createdAt)
  ) {
    throw new SharedIssuancePersistenceConflictError();
  }
}

function assertAttempt(
  attempt: ImmutableSharedIssuanceTransactionAttempt,
): void {
  if (
    !UUID_PATTERN.test(attempt.attemptId) ||
    !UUID_PATTERN.test(attempt.issuanceRequestId) ||
    !HASH_PATTERN.test(attempt.issuanceIntentFingerprint) ||
    !HASH_PATTERN.test(attempt.transactionHash) ||
    !HASH_PATTERN.test(attempt.envelopeXdrSha256) ||
    (attempt.signedEnvelopeXdrSha256 !== undefined &&
      !HASH_PATTERN.test(attempt.signedEnvelopeXdrSha256)) ||
    !Number.isSafeInteger(attempt.attemptNumber) ||
    attempt.attemptNumber !== 1 ||
    !INTEGER_PATTERN.test(attempt.sourceSequence) ||
    !INTEGER_PATTERN.test(attempt.feeStroops) ||
    BigInt(attempt.feeStroops) <= 0n ||
    !Number.isSafeInteger(attempt.validFrom) ||
    !Number.isSafeInteger(attempt.validUntil) ||
    attempt.validFrom < 0 ||
    attempt.validUntil <= attempt.validFrom ||
    !PUBLIC_KEY_PATTERN.test(attempt.transactionSourcePublicKey) ||
    !PUBLIC_KEY_PATTERN.test(attempt.operationSourcePublicKey) ||
    !PUBLIC_KEY_PATTERN.test(attempt.issuerPublicKey) ||
    !PUBLIC_KEY_PATTERN.test(attempt.destinationPublicKey) ||
    !ASSET_CODE_PATTERN.test(attempt.assetCode) ||
    !AMOUNT_PATTERN.test(attempt.amount) ||
    attempt.operationCount !== 1 ||
    attempt.operationType !== "payment" ||
    !validTimestamp(attempt.createdAt)
  ) {
    throw new SharedIssuancePersistenceConflictError();
  }
}

function attemptMatchesIntent(
  attempt: ImmutableSharedIssuanceTransactionAttempt,
  intent: ImmutableSharedIssuanceIntent,
): boolean {
  return (
    attempt.issuanceIntentFingerprint === intent.issuanceIntentFingerprint &&
    attempt.transactionSourcePublicKey === intent.issuerPublicKey &&
    attempt.operationSourcePublicKey === intent.issuerPublicKey &&
    attempt.assetCode === intent.assetCode &&
    attempt.issuerPublicKey === intent.issuerPublicKey &&
    attempt.destinationPublicKey === intent.destinationPublicKey &&
    attempt.amount === intent.amount
  );
}

function sameRecord(left: object, right: object): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function validTimestamp(value: string): boolean {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}
