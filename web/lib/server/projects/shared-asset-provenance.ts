import { isValidProjectId } from "../../projects/project-profile";
import type { DatabaseClient } from "../persistence/database";
import { normalizeWalletPublicKey } from "../persistence/wallet";

/** Immutable evidence written only after independent exact-hash validation. */
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

interface ConfirmationRow {
  confirmation_id: string;
  project_id: string;
  owner_public_key: string;
  network: "testnet";
  asset_code: string;
  issuer_public_key: string;
  destination_public_key: string;
  amount: string;
  issuance_request_id: string;
  issuance_intent_fingerprint: string;
  transaction_hash: string;
  signed_envelope_xdr_sha256: string;
  ledger_sequence: string | number;
}

const HASH_PATTERN = /^[0-9a-f]{64}$/;

/**
 * Reads the append-only confirmation produced by the trusted confirmation
 * writer. It never infers confirmation from a mutable issuance status.
 */
export class PostgresSharedAssetConfirmationReader implements SharedAssetConfirmationReader {
  constructor(private readonly sql: DatabaseClient) {}

  async findConfirmed(projectId: string, ownerPublicKeyInput: string) {
    if (!isValidProjectId(projectId)) return null;

    let ownerPublicKey: string;
    try {
      ownerPublicKey = normalizeWalletPublicKey(ownerPublicKeyInput);
    } catch {
      return null;
    }

    const [row] = await this.sql<ConfirmationRow[]>`
      SELECT
        confirmation.confirmation_id,
        confirmation.project_id,
        confirmation.owner_public_key,
        confirmation.network,
        confirmation.asset_code,
        confirmation.issuer_public_key,
        confirmation.destination_public_key,
        confirmation.amount::text AS amount,
        confirmation.issuance_request_id,
        confirmation.issuance_intent_fingerprint,
        confirmation.transaction_hash,
        confirmation.signed_envelope_xdr_sha256,
        confirmation.ledger_sequence
      FROM project_issuance_ledger_confirmations AS confirmation
      INNER JOIN project_profile_owners AS owner
        ON owner.project_id = confirmation.project_id
       AND owner.owner_public_key = confirmation.owner_public_key
      INNER JOIN project_profiles AS project
        ON project.project_id = confirmation.project_id
       AND project.asset_code = confirmation.asset_code
       AND project.network = confirmation.network
       AND project.issuer_model = 'shared'
      WHERE confirmation.project_id = ${projectId}
        AND confirmation.owner_public_key = ${ownerPublicKey}
        AND confirmation.network = 'testnet'
        AND confirmation.result_success = true
        AND confirmation.signed_envelope_xdr_sha256 IS NOT NULL
        AND project.deleted_at IS NULL
      LIMIT 1
    `;
    if (!row) return null;

    const ledgerSequence = Number(row.ledger_sequence);
    if (
      !HASH_PATTERN.test(row.issuance_intent_fingerprint.trim()) ||
      !HASH_PATTERN.test(row.transaction_hash.trim()) ||
      !HASH_PATTERN.test(row.signed_envelope_xdr_sha256.trim()) ||
      !Number.isSafeInteger(ledgerSequence) ||
      ledgerSequence <= 0
    ) {
      return null;
    }

    return {
      confirmationId: row.confirmation_id,
      projectId: row.project_id,
      ownerPublicKey: row.owner_public_key.trim(),
      network: "testnet" as const,
      assetCode: row.asset_code,
      issuerPublicKey: row.issuer_public_key.trim(),
      destinationPublicKey: row.destination_public_key.trim(),
      amount: row.amount,
      issuanceRequestId: row.issuance_request_id,
      issuanceIntentFingerprint: row.issuance_intent_fingerprint.trim(),
      transactionHash: row.transaction_hash.trim(),
      signedEnvelopeXdrSha256: row.signed_envelope_xdr_sha256.trim(),
      ledgerSequence,
    };
  }
}
