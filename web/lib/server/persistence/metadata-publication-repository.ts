import type { MetadataPublicationState } from "../../projects/metadata-publication";
import { SHARED_ASSET_DOMAIN } from "../../product/constants";
import type { DatabaseClient } from "./database";

export interface MetadataPublicationRow {
  project_id: string;
  metadata_home: string;
  network: "testnet" | "public";
  asset_code: string;
  issuer_public_key: string;
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
  constructor(private readonly sql: DatabaseClient) {}

  async getByProjectId(
    projectId: string,
  ): Promise<MetadataPublicationState | null> {
    const [row] = await this.sql<MetadataPublicationRow[]>`
      SELECT *
      FROM project_metadata_publications
      WHERE project_id = ${projectId}
      LIMIT 1
    `;

    return row ? mapMetadataPublication(row) : null;
  }

  async listSharedTestnetPublications(): Promise<MetadataPublicationState[]> {
    const rows = await this.sql<MetadataPublicationRow[]>`
      SELECT *
      FROM project_metadata_publications
      WHERE network = 'testnet'
        AND metadata_home = ${SHARED_ASSET_DOMAIN}
      ORDER BY asset_code, issuer_public_key, project_id
    `;

    return rows.map(mapMetadataPublication);
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
    revision: row.revision,
    publishedAt: row.published_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    reachable: row.reachable,
    verifiedAt: row.verified_at?.toISOString() ?? null,
    lastVerificationAt: row.last_verification_at?.toISOString() ?? null,
    verificationErrorCode: row.verification_error_code,
  };
}
