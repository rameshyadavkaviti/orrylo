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
      SELECT *
      FROM project_profiles
      WHERE slug = ${slug}
        AND public_status = 'published'
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
      ORDER BY p.created_at DESC, p.project_id
    `;

    return rows.map(mapManagedProjectProfile);
  }

  async publishOwned(
    projectId: string,
    ownerPublicKey: string,
    now = Date.now(),
  ): Promise<ManagedProjectProfile | null> {
    if (!isValidProjectId(projectId)) {
      return null;
    }

    const owner = normalizeWalletPublicKey(ownerPublicKey);
    const [row] = await this.sql<ManagedProjectProfileRow[]>`
      UPDATE project_profiles AS p
      SET
        public_status = 'published',
        updated_at = CASE
          WHEN p.public_status = 'published' THEN p.updated_at
          ELSE ${new Date(now)}
        END
      FROM project_profile_owners AS o
      WHERE p.project_id = ${projectId}
        AND o.project_id = p.project_id
        AND o.owner_public_key = ${owner}
      RETURNING p.*, o.owner_public_key
    `;

    return row ? mapManagedProjectProfile(row) : null;
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
