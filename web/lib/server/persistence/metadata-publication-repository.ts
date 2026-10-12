import type { MetadataPublicationState } from "../../projects/metadata-publication";
import { SHARED_ASSET_DOMAIN } from "../../product/constants";
import type { DatabaseClient } from "./database";
import { normalizeWalletPublicKey } from "./wallet";
import {
  type SharedAssetConfirmationReader,
  UnavailableSharedAssetConfirmationReader,
} from "../projects/shared-asset-provenance";

export interface MetadataPublicationRow {
  project_id: string;
  metadata_home: string;
  network: "testnet" | "public";
  asset_code: string;
  issuer_public_key: string;
  owner_public_key: string | null;
  issuance_request_id: string;
  issuance_fingerprint: string;
  confirmation_id: string | null;
  currency_toml: string;
  content_hash: string;
  revision: number;
  published_at: Date;
  updated_at: Date;
  reachable: boolean;
  verified_at: Date | null;
  last_verification_at: Date | null;
  verification_error_code: string | null;
}

export class PostgresMetadataPublicationRepository {
  private readonly confirmationReader: SharedAssetConfirmationReader;
  private readonly approvedIssuerPublicKey: string | null;

  constructor(
    private readonly sql: DatabaseClient,
    options: {
      confirmationReader?: SharedAssetConfirmationReader;
      approvedIssuerPublicKey?: string | null;
    } = {},
  ) {
    this.confirmationReader =
      options.confirmationReader ??
      new UnavailableSharedAssetConfirmationReader();
    try {
      this.approvedIssuerPublicKey = options.approvedIssuerPublicKey
        ? normalizeWalletPublicKey(options.approvedIssuerPublicKey)
        : null;
    } catch {
      this.approvedIssuerPublicKey = null;
    }
  }

  private async hasValidProvenance(
    row: MetadataPublicationRow,
    ownerPublicKey: string,
  ): Promise<boolean> {
    if (!this.approvedIssuerPublicKey || !row.confirmation_id) return false;
    const source = await this.confirmationReader.findConfirmed(
      row.project_id,
      ownerPublicKey,
    );
    return Boolean(
      source &&
      row.owner_public_key !== null &&
      source.confirmationId === row.confirmation_id &&
      source.projectId === row.project_id &&
      source.ownerPublicKey === ownerPublicKey &&
      source.ownerPublicKey === row.owner_public_key.trim() &&
      source.network === row.network &&
      source.assetCode === row.asset_code &&
      source.issuerPublicKey === this.approvedIssuerPublicKey &&
      source.issuerPublicKey === row.issuer_public_key.trim() &&
      source.issuanceRequestId === row.issuance_request_id &&
      source.issuanceIntentFingerprint === row.issuance_fingerprint.trim(),
    );
  }

  async getByProjectId(
    projectId: string,
  ): Promise<MetadataPublicationState | null> {
    const [row] = await this.sql<
      (MetadataPublicationRow & { current_owner_public_key: string })[]
    >`
      SELECT pub.*, owner.owner_public_key AS current_owner_public_key
      FROM project_metadata_publications AS pub
      JOIN project_profile_owners AS owner ON owner.project_id = pub.project_id
      JOIN project_profiles AS project ON project.project_id = pub.project_id
      WHERE pub.project_id = ${projectId}
        AND project.network = pub.network
        AND project.asset_code = pub.asset_code
        AND project.issuer_model = 'shared'
        AND pub.owner_public_key = owner.owner_public_key
        AND (project.issuer_public_key IS NULL
          OR project.issuer_public_key = pub.issuer_public_key)
      LIMIT 1
    `;
    if (
      !row ||
      !(await this.hasValidProvenance(row, row.current_owner_public_key.trim()))
    ) {
      return null;
    }
    return mapMetadataPublication(row);
  }

  async listSharedTestnetPublications(): Promise<MetadataPublicationState[]> {
    const rows = await this.sql<
      (MetadataPublicationRow & { current_owner_public_key: string })[]
    >`
      SELECT pub.*, owner.owner_public_key AS current_owner_public_key
      FROM project_metadata_publications AS pub
      JOIN project_profile_owners AS owner ON owner.project_id = pub.project_id
      JOIN project_profiles AS project ON project.project_id = pub.project_id
      WHERE pub.network = 'testnet'
        AND pub.metadata_home = ${SHARED_ASSET_DOMAIN}
        AND project.network = pub.network
        AND project.asset_code = pub.asset_code
        AND project.issuer_model = 'shared'
        AND pub.owner_public_key = owner.owner_public_key
        AND (project.issuer_public_key IS NULL
          OR project.issuer_public_key = pub.issuer_public_key)
      ORDER BY pub.asset_code, pub.issuer_public_key, pub.project_id
    `;
    const valid: MetadataPublicationState[] = [];
    for (const row of rows) {
      if (
        await this.hasValidProvenance(row, row.current_owner_public_key.trim())
      ) {
        valid.push(mapMetadataPublication(row));
      }
    }
    return valid;
  }

  async markVerifiedIfCurrent(input: {
    projectId: string;
    contentHash: string;
    now: number;
  }): Promise<MetadataPublicationState | null> {
    const [row] = await this.sql<MetadataPublicationRow[]>`
      UPDATE project_metadata_publications
      SET
        reachable = true,
        verified_at = ${new Date(input.now)},
        last_verification_at = ${new Date(input.now)},
        verification_error_code = NULL,
        updated_at = ${new Date(input.now)}
      WHERE project_id = ${input.projectId}
        AND content_hash = ${input.contentHash}
      RETURNING *
    `;

    return row ? mapMetadataPublication(row) : null;
  }

  async markVerificationFailureIfCurrent(input: {
    projectId: string;
    contentHash: string;
    errorCode: string;
    now: number;
  }): Promise<MetadataPublicationState | null> {
    const [row] = await this.sql<MetadataPublicationRow[]>`
      UPDATE project_metadata_publications
      SET
        reachable = false,
        verified_at = NULL,
        last_verification_at = ${new Date(input.now)},
        verification_error_code = ${input.errorCode},
        updated_at = ${new Date(input.now)}
      WHERE project_id = ${input.projectId}
        AND content_hash = ${input.contentHash}
      RETURNING *
    `;

    return row ? mapMetadataPublication(row) : null;
  }
}

export function mapMetadataPublication(
  row: MetadataPublicationRow,
): MetadataPublicationState {
  return {
    projectId: row.project_id,
    metadataHome: row.metadata_home,
    network: row.network,
    assetCode: row.asset_code,
    issuerPublicKey: row.issuer_public_key.trim(),
    currencyToml: row.currency_toml,
    contentHash: row.content_hash.trim(),
    revision: Number(row.revision),
    publishedAt: row.published_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    reachable: row.reachable,
    verifiedAt: row.verified_at?.toISOString() ?? null,
    lastVerificationAt: row.last_verification_at?.toISOString() ?? null,
    verificationErrorCode: row.verification_error_code,
  };
}
