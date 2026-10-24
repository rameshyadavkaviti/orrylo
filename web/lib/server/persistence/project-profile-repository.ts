import type { NormalizedProjectMetadata } from "../../projects/project-metadata";
import type {
  ManagedProjectProfile,
  ProjectProfile,
} from "../../projects/project-profile";
import {
  isValidProjectId,
  isValidProjectSlug,
} from "../../projects/project-profile";
import type { DatabaseClient } from "./database";
import { normalizeWalletPublicKey } from "./wallet";
import type { VerifiedSharedAssetProvenance } from "../projects/shared-asset-provenance";

interface ProjectProfileRow {
  project_id: string;
  slug: string;
  asset_code: string;
  display_name: string;
  description: string | null;
  category: string | null;
  logo_url: string | null;
  website_url: string | null;
  community_url: string | null;
  metadata_home: string | null;
  issuer_model: "shared" | "dedicated";
  network: "testnet" | "public";
  issuer_public_key: string | null;
  explorer_url: string | null;
  public_status: "draft" | "published";
  created_at: Date;
  updated_at: Date;
}

interface ManagedProjectProfileRow extends ProjectProfileRow {
  owner_public_key: string;
}

export interface CreateProjectProfileInput {
  projectId: string;
  slug: string;
  assetCode: string;
  displayName: string;
  description?: string | null;
  category?: string | null;
  logoUrl?: string | null;
  websiteUrl?: string | null;
  communityUrl?: string | null;
  metadataHome?: string | null;
  issuerModel: "shared" | "dedicated";
  network: "testnet" | "public";
  issuerPublicKey?: string | null;
  explorerUrl?: string | null;
  publicStatus?: "draft" | "published";
  now: number;
}

export class PostgresProjectProfileRepository {
  constructor(private readonly sql: DatabaseClient) {}

  async create(input: CreateProjectProfileInput): Promise<ProjectProfile> {
    if (!isValidProjectSlug(input.slug)) {
      throw new Error("Invalid project slug.");
    }

    const [row] = await this.sql<ProjectProfileRow[]>`
      INSERT INTO project_profiles (
        project_id,
        slug,
        asset_code,
        display_name,
        description,
        category,
        logo_url,
        website_url,
        community_url,
        metadata_home,
        issuer_model,
        network,
        issuer_public_key,
        explorer_url,
        public_status,
        created_at,
        updated_at
      )
      VALUES (
        ${input.projectId},
        ${input.slug},
        ${input.assetCode.trim().toUpperCase()},
        ${input.displayName.trim()},
        ${input.description?.trim() || null},
        ${input.category?.trim() || null},
        ${input.logoUrl?.trim() || null},
        ${input.websiteUrl?.trim() || null},
        ${input.communityUrl?.trim() || null},
        ${input.metadataHome?.trim() || null},
        ${input.issuerModel},
        ${input.network},
        ${input.issuerPublicKey?.trim().toUpperCase() || null},
        ${input.explorerUrl?.trim() || null},
        ${input.publicStatus ?? "draft"},
        ${new Date(input.now)},
        ${new Date(input.now)}
      )
      RETURNING *
    `;

    if (!row) {
      throw new Error("Project profile insert returned no row.");
    }

    return mapProjectProfile(row);
  }

  async findPublishedBySlug(slug: string): Promise<ProjectProfile | null> {
    if (!isValidProjectSlug(slug)) {
      return null;
    }

    const [row] = await this.sql<ProjectProfileRow[]>`
      SELECT p.*
      FROM project_profiles AS p
      INNER JOIN project_profile_owners AS owner
        ON owner.project_id = p.project_id
      WHERE p.slug = ${slug}
        AND p.public_status = 'published'
        AND p.issuer_model = 'shared'
        AND p.deleted_at IS NULL
        AND (
          (
            p.network = 'testnet'
            AND EXISTS (
              SELECT 1 FROM project_issuance_ledger_confirmations AS confirmation
              WHERE confirmation.project_id = p.project_id
                AND confirmation.owner_public_key = owner.owner_public_key
                AND confirmation.network = p.network
                AND confirmation.asset_code = p.asset_code
                AND confirmation.issuer_public_key = p.issuer_public_key
                AND confirmation.result_success = true
                AND confirmation.signed_envelope_xdr_sha256 IS NOT NULL
            )
          ) OR (
            p.network = 'public'
            AND EXISTS (
              SELECT 1 FROM mainnet_issuance_confirmations AS confirmation
              WHERE confirmation.project_id = p.project_id
                AND confirmation.owner_public_key = owner.owner_public_key
                AND confirmation.network = p.network
                AND confirmation.asset_code = p.asset_code
                AND confirmation.issuer_public_key = p.issuer_public_key
                AND confirmation.signed_envelope_xdr_sha256 IS NOT NULL
            )
          )
        )
      LIMIT 1
    `;

    return row ? mapProjectProfile(row) : null;
  }

  async findOwnedById(
    projectId: string,
    ownerPublicKey: string,
  ): Promise<ManagedProjectProfile | null> {
    if (!isValidProjectId(projectId)) {
      return null;
    }

    const owner = normalizeWalletPublicKey(ownerPublicKey);
    const [row] = await this.sql<ManagedProjectProfileRow[]>`
      SELECT p.*, o.owner_public_key
      FROM project_profiles AS p
      INNER JOIN project_profile_owners AS o
        ON o.project_id = p.project_id
      WHERE p.project_id = ${projectId}
        AND o.owner_public_key = ${owner}
        AND p.deleted_at IS NULL
      LIMIT 1
    `;

    return row ? mapManagedProjectProfile(row) : null;
  }

  async listOwnedByWallet(
    ownerPublicKey: string,
  ): Promise<ManagedProjectProfile[]> {
    const owner = normalizeWalletPublicKey(ownerPublicKey);
    const rows = await this.sql<ManagedProjectProfileRow[]>`
      SELECT p.*, o.owner_public_key
      FROM project_profiles AS p
      INNER JOIN project_profile_owners AS o
        ON o.project_id = p.project_id
      WHERE o.owner_public_key = ${owner}
        AND p.deleted_at IS NULL
      ORDER BY p.created_at DESC, p.project_id
    `;

    return rows.map(mapManagedProjectProfile);
  }

  async updateOwnedLogoUrl(
    projectId: string,
    ownerPublicKey: string,
    logoUrl: string,
    now = Date.now(),
  ): Promise<ManagedProjectProfile | null> {
    if (!isValidProjectId(projectId)) return null;
    const owner = normalizeWalletPublicKey(ownerPublicKey);
    const [row] = await this.sql<ManagedProjectProfileRow[]>`
      UPDATE project_profiles AS p
      SET logo_url = ${logoUrl}, updated_at = ${new Date(now)}
      FROM project_profile_owners AS o
      WHERE p.project_id = ${projectId}
        AND o.project_id = p.project_id
        AND o.owner_public_key = ${owner}
        AND p.deleted_at IS NULL
      RETURNING p.*, o.owner_public_key
    `;
    return row ? mapManagedProjectProfile(row) : null;
  }

  async updateOwnedMetadata(
    projectId: string,
    ownerPublicKey: string,
    input: NormalizedProjectMetadata,
    now = Date.now(),
  ): Promise<ManagedProjectProfile | null> {
    if (!isValidProjectId(projectId)) {
      return null;
    }

    const owner = normalizeWalletPublicKey(ownerPublicKey);
    const [row] = await this.sql<ManagedProjectProfileRow[]>`
      UPDATE project_profiles AS p
      SET
        display_name = ${input.displayName},
        description = ${input.description},
        logo_url = ${input.logoUrl},
        website_url = ${input.websiteUrl},
        community_url = ${input.communityUrl},
        updated_at = ${new Date(now)}
      FROM project_profile_owners AS o
      WHERE p.project_id = ${projectId}
        AND o.project_id = p.project_id
        AND o.owner_public_key = ${owner}
        AND p.deleted_at IS NULL
      RETURNING p.*, o.owner_public_key
    `;

    return row ? mapManagedProjectProfile(row) : null;
  }

  async publishConfirmedOwned(
    projectId: string,
    ownerPublicKey: string,
    confirmation: VerifiedSharedAssetProvenance,
    now = Date.now(),
  ): Promise<ManagedProjectProfile | null> {
    if (!isValidProjectId(projectId) || confirmation.projectId !== projectId) {
      return null;
    }
    const owner = normalizeWalletPublicKey(ownerPublicKey);
    if (confirmation.ownerPublicKey !== owner) return null;

    const explorerUrl = `https://stellar.expert/explorer/testnet/tx/${confirmation.transactionHash}`;
    const [row] = await this.sql<ManagedProjectProfileRow[]>`
      UPDATE project_profiles AS p
      SET
        public_status = 'published',
        issuer_public_key = ${confirmation.issuerPublicKey},
        explorer_url = ${explorerUrl},
        updated_at = CASE
          WHEN p.public_status = 'published'
            AND p.issuer_public_key = ${confirmation.issuerPublicKey}
            AND p.explorer_url = ${explorerUrl}
          THEN p.updated_at
          ELSE ${new Date(now)}
        END
      FROM project_profile_owners AS owner,
           project_issuance_ledger_confirmations AS confirmed
      WHERE p.project_id = ${projectId}
        AND owner.project_id = p.project_id
        AND owner.owner_public_key = ${owner}
        AND confirmed.confirmation_id = ${confirmation.confirmationId}
        AND confirmed.project_id = p.project_id
        AND confirmed.owner_public_key = owner.owner_public_key
        AND confirmed.network = 'testnet'
        AND confirmed.asset_code = p.asset_code
        AND confirmed.issuer_public_key = ${confirmation.issuerPublicKey}
        AND confirmed.issuance_request_id = ${confirmation.issuanceRequestId}
        AND confirmed.issuance_intent_fingerprint = ${confirmation.issuanceIntentFingerprint}
        AND confirmed.transaction_hash = ${confirmation.transactionHash}
        AND confirmed.signed_envelope_xdr_sha256 = ${confirmation.signedEnvelopeXdrSha256}
        AND confirmed.ledger_sequence = ${confirmation.ledgerSequence}
        AND confirmed.result_success = true
        AND p.network = 'testnet'
        AND p.issuer_model = 'shared'
        AND p.deleted_at IS NULL
      RETURNING p.*, owner.owner_public_key
    `;

    return row ? mapManagedProjectProfile(row) : null;
  }
  async archiveOwnedDraft(
    projectId: string,
    ownerPublicKey: string,
  ): Promise<boolean> {
    if (!isValidProjectId(projectId)) return false;
    const owner = normalizeWalletPublicKey(ownerPublicKey);
    const rows = await this.sql<{ project_id: string }[]>`
      UPDATE project_profiles AS p
      SET deleted_at = NOW()
      WHERE p.project_id = ${projectId}
        AND p.public_status = 'draft'
        AND p.deleted_at IS NULL
        AND EXISTS (
          SELECT 1 FROM project_profile_owners AS o
          WHERE o.project_id = p.project_id AND o.owner_public_key = ${owner}
        )
        AND NOT EXISTS (SELECT 1 FROM project_issuance_intents AS i WHERE i.project_id = p.project_id)
        AND NOT EXISTS (SELECT 1 FROM project_customer_change_trust_handoffs AS h WHERE h.project_id = p.project_id)
        AND NOT EXISTS (SELECT 1 FROM project_metadata_publications AS m WHERE m.project_id = p.project_id)
        AND NOT EXISTS (SELECT 1 FROM mainnet_token_orders AS o WHERE o.project_id = p.project_id)
      RETURNING p.project_id
    `;
    return rows.length === 1;
  }
}

function mapProjectProfile(row: ProjectProfileRow): ProjectProfile {
  return {
    projectId: row.project_id,
    slug: row.slug,
    assetCode: row.asset_code,
    displayName: row.display_name,
    description: row.description,
    category: row.category,
    logoUrl: row.logo_url,
    websiteUrl: row.website_url,
    communityUrl: row.community_url,
    metadataHome: row.metadata_home,
    issuerModel: row.issuer_model,
    network: row.network,
    issuerPublicKey: row.issuer_public_key?.trim() ?? null,
    explorerUrl: row.explorer_url,
    publicStatus: row.public_status,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function mapManagedProjectProfile(
  row: ManagedProjectProfileRow,
): ManagedProjectProfile {
  return {
    ...mapProjectProfile(row),
    ownerPublicKey: row.owner_public_key.trim(),
  };
}
