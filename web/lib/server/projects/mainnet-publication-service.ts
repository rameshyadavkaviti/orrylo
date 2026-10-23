import { createHash } from "node:crypto";

import type { MetadataPublicationState } from "../../projects/metadata-publication";
import type { ProjectProfile } from "../../projects/project-profile";
import { generateProjectCurrencyToml } from "../../projects/stellar-toml";
import { SHARED_ASSET_DOMAIN } from "../../product/constants";
import { MAINNET_SHARED_ISSUER_PUBLIC_KEY } from "../../stellar/mainnet-creation";
import type { DatabaseClient } from "../persistence/database";
import { FixedSharedMetadataVerifier } from "./metadata-publication-verifier";

export interface MainnetAutomaticPublicationResult {
  status: "not_issued" | "pending" | "complete";
  landingPage: "draft" | "published" | "failed";
  metadata: "pending" | "verified" | "failed";
  errors: string[];
}

export interface MainnetAutomaticPublicationDependencies {
  hasConfirmation(projectId: string, ownerPublicKey: string): Promise<boolean>;
  publishLandingPage(projectId: string, ownerPublicKey: string): Promise<boolean>;
  publishMetadata(
    projectId: string,
    ownerPublicKey: string,
  ): Promise<{ verified: boolean; errorCode: string | null }>;
  recordStatus(
    projectId: string,
    ownerPublicKey: string,
    status: "pending" | "verified" | "failed",
    errorCode: string | null,
  ): Promise<void>;
}

function safeCode(error: unknown, fallback: string): string {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string" &&
    /^[a-z0-9_]{1,64}$/.test(error.code)
  ) {
    return error.code;
  }
  return fallback;
}

export class MainnetAutomaticPublicationService {
  constructor(private readonly dependencies: MainnetAutomaticPublicationDependencies) {}

  async reconcile(
    projectId: string,
    ownerPublicKey: string,
  ): Promise<MainnetAutomaticPublicationResult> {
    if (!(await this.dependencies.hasConfirmation(projectId, ownerPublicKey))) {
      return {
        status: "not_issued",
        landingPage: "draft",
        metadata: "pending",
        errors: [],
      };
    }
    const errors: string[] = [];
    let landingPage: MainnetAutomaticPublicationResult["landingPage"] = "failed";
    let metadata: MainnetAutomaticPublicationResult["metadata"] = "failed";
    try {
      landingPage = (await this.dependencies.publishLandingPage(projectId, ownerPublicKey))
        ? "published"
        : "failed";
      if (landingPage === "failed") errors.push("landing_page_publication_failed");
    } catch (error) {
      errors.push(safeCode(error, "landing_page_publication_failed"));
    }
    try {
      const result = await this.dependencies.publishMetadata(projectId, ownerPublicKey);
      metadata = result.verified ? "verified" : "failed";
      if (!result.verified) errors.push(result.errorCode ?? "metadata_verification_pending");
    } catch (error) {
      errors.push(safeCode(error, "metadata_publication_failed"));
    }
    const complete = landingPage === "published" && metadata === "verified";
    const errorCode = errors[0] ?? null;
    await this.dependencies.recordStatus(
      projectId,
      ownerPublicKey,
      complete ? "verified" : "failed",
      errorCode,
    );
    return {
      status: complete ? "complete" : "pending",
      landingPage,
      metadata,
      errors: [...new Set(errors)],
    };
  }
}

interface MainnetPublicationRow {
  project_id: string;
  metadata_home: string;
  network: "public";
  asset_code: string;
  issuer_public_key: string;
  currency_toml: string;
  content_hash: string;
  revision: string | number;
  published_at: Date;
  updated_at: Date;
  reachable: boolean;
  verified_at: Date | null;
  last_verification_at: Date | null;
  verification_error_code: string | null;
}

function mapPublication(row: MainnetPublicationRow): MetadataPublicationState {
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

export class PostgresMainnetPublicationBackend
  implements MainnetAutomaticPublicationDependencies
{
  private readonly verifier: FixedSharedMetadataVerifier;

  constructor(
    private readonly sql: DatabaseClient,
    private readonly now: () => number = Date.now,
    fetchImpl: typeof fetch = globalThis.fetch,
  ) {
    this.verifier = new FixedSharedMetadataVerifier(fetchImpl);
  }

  async hasConfirmation(projectId: string, ownerPublicKey: string) {
    const [row] = await this.sql<{ present: boolean }[]>`
      SELECT EXISTS (
        SELECT 1
        FROM mainnet_issuance_confirmations AS confirmation
        JOIN mainnet_token_orders AS orders USING (order_id)
        WHERE confirmation.project_id = ${projectId}
          AND confirmation.owner_public_key = ${ownerPublicKey}
          AND orders.state = 'issued'
          AND confirmation.network = 'public'
          AND confirmation.issuer_public_key = ${MAINNET_SHARED_ISSUER_PUBLIC_KEY}
      ) AS present
    `;
    return row?.present === true;
  }

  async publishLandingPage(projectId: string, ownerPublicKey: string) {
    const rows = await this.sql<{ project_id: string }[]>`
      UPDATE project_profiles AS project
      SET public_status = 'published',
          issuer_public_key = confirmation.issuer_public_key,
          explorer_url = 'https://stellar.expert/explorer/public/tx/' || confirmation.transaction_hash,
          updated_at = ${new Date(this.now())}
      FROM project_profile_owners AS owner,
           mainnet_issuance_confirmations AS confirmation
      WHERE project.project_id = ${projectId}
        AND owner.project_id = project.project_id
        AND owner.owner_public_key = ${ownerPublicKey}
        AND confirmation.project_id = project.project_id
        AND confirmation.owner_public_key = owner.owner_public_key
        AND confirmation.network = 'public'
        AND confirmation.asset_code = project.asset_code
        AND confirmation.issuer_public_key = ${MAINNET_SHARED_ISSUER_PUBLIC_KEY}
        AND project.network = 'public'
        AND project.issuer_model = 'shared'
        AND project.deleted_at IS NULL
      RETURNING project.project_id
    `;
    return rows.length === 1;
  }

  async publishMetadata(projectId: string, ownerPublicKey: string) {
    const now = this.now();
    const publication = await this.sql.begin(async (tx) => {
      const [row] = await tx<{
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
        issuer_model: "shared";
        network: "public";
        issuer_public_key: string;
        explorer_url: string | null;
        public_status: "published";
        created_at: Date;
        updated_at: Date;
        order_id: string;
        confirmation_id: string;
      }[]>`
        SELECT project.*, orders.order_id, confirmation.confirmation_id
        FROM project_profiles AS project
        JOIN project_profile_owners AS owner USING (project_id)
        JOIN mainnet_token_orders AS orders USING (project_id)
        JOIN mainnet_issuance_confirmations AS confirmation USING (order_id, project_id)
        WHERE project.project_id = ${projectId}
          AND owner.owner_public_key = ${ownerPublicKey}
          AND project.network = 'public'
          AND project.public_status = 'published'
          AND confirmation.owner_public_key = owner.owner_public_key
          AND confirmation.issuer_public_key = ${MAINNET_SHARED_ISSUER_PUBLIC_KEY}
        FOR UPDATE OF project
      `;
      if (!row) throw Object.assign(new Error("confirmation missing"), { code: "issuer_provenance_unavailable" });
      const project: ProjectProfile = {
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
        issuerPublicKey: row.issuer_public_key.trim(),
        explorerUrl: row.explorer_url,
        publicStatus: row.public_status,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
      };
      const generated = generateProjectCurrencyToml(project);
      if (!generated?.issuerIncluded || generated.issuerPublicKey !== MAINNET_SHARED_ISSUER_PUBLIC_KEY) {
        throw Object.assign(new Error("metadata invalid"), { code: "metadata_not_ready" });
      }
      const contentHash = createHash("sha256").update(generated.content).digest("hex");
      const [published] = await tx<MainnetPublicationRow[]>`
        INSERT INTO mainnet_metadata_publications (
          project_id, order_id, confirmation_id, owner_public_key,
          metadata_home, network, asset_code, issuer_public_key,
          currency_toml, content_hash, revision, published_at, updated_at,
          reachable, verified_at, last_verification_at, verification_error_code
        ) VALUES (
          ${projectId}, ${row.order_id}, ${row.confirmation_id}, ${ownerPublicKey},
          ${SHARED_ASSET_DOMAIN}, 'public', ${project.assetCode},
          ${MAINNET_SHARED_ISSUER_PUBLIC_KEY}, ${generated.content}, ${contentHash},
          1, ${new Date(now)}, ${new Date(now)}, false, NULL, NULL, NULL
        )
        ON CONFLICT (project_id) DO UPDATE SET
          currency_toml = EXCLUDED.currency_toml,
          content_hash = EXCLUDED.content_hash,
          revision = CASE
            WHEN mainnet_metadata_publications.content_hash = EXCLUDED.content_hash
            THEN mainnet_metadata_publications.revision
            ELSE mainnet_metadata_publications.revision + 1
          END,
          updated_at = EXCLUDED.updated_at,
          reachable = false,
          verified_at = NULL,
          last_verification_at = NULL,
          verification_error_code = NULL
        RETURNING *
      `;
      if (!published) throw new Error("metadata_database_invariant");
      return mapPublication(published);
    });
    const verification = await this.verifier.verify(publication);
    const checkedAt = new Date(this.now());
    const [updated] = await this.sql<MainnetPublicationRow[]>`
      UPDATE mainnet_metadata_publications
      SET reachable = ${verification.ok},
          verified_at = ${verification.ok ? checkedAt : null},
          last_verification_at = ${checkedAt},
          verification_error_code = ${verification.ok ? null : verification.code},
          updated_at = ${checkedAt}
      WHERE project_id = ${projectId}
        AND content_hash = ${publication.contentHash}
      RETURNING *
    `;
    if (!updated) throw new Error("metadata_database_invariant");
    return {
      verified: verification.ok && updated.reachable,
      errorCode: verification.ok ? null : verification.code,
    };
  }

  async recordStatus(
    projectId: string,
    ownerPublicKey: string,
    status: "pending" | "verified" | "failed",
    errorCode: string | null,
  ) {
    await this.sql`
      UPDATE mainnet_token_orders AS orders
      SET publication_status = ${status},
          publication_error_code = ${errorCode},
          updated_at = ${new Date(this.now())}
      WHERE orders.project_id = ${projectId}
        AND orders.owner_public_key = ${ownerPublicKey}
        AND orders.state = 'issued'
    `;
  }

  async listPublications(): Promise<MetadataPublicationState[]> {
    const rows = await this.sql<MainnetPublicationRow[]>`
      SELECT publication.*
      FROM mainnet_metadata_publications AS publication
      JOIN mainnet_issuance_confirmations AS confirmation
        ON confirmation.confirmation_id = publication.confirmation_id
       AND confirmation.order_id = publication.order_id
       AND confirmation.project_id = publication.project_id
       AND confirmation.owner_public_key = publication.owner_public_key
      WHERE publication.network = 'public'
        AND publication.metadata_home = ${SHARED_ASSET_DOMAIN}
        AND confirmation.issuer_public_key = publication.issuer_public_key
      ORDER BY publication.asset_code, publication.issuer_public_key, publication.project_id
    `;
    return rows.map(mapPublication);
  }

  async getPublication(
    projectId: string,
    ownerPublicKey: string,
  ): Promise<MetadataPublicationState | null> {
    const [row] = await this.sql<MainnetPublicationRow[]>`
      SELECT publication.*
      FROM mainnet_metadata_publications AS publication
      JOIN mainnet_issuance_confirmations AS confirmation
        ON confirmation.confirmation_id = publication.confirmation_id
       AND confirmation.order_id = publication.order_id
       AND confirmation.project_id = publication.project_id
       AND confirmation.owner_public_key = publication.owner_public_key
      WHERE publication.project_id = ${projectId}
        AND publication.owner_public_key = ${ownerPublicKey}
        AND publication.network = 'public'
        AND publication.metadata_home = ${SHARED_ASSET_DOMAIN}
        AND confirmation.issuer_public_key = publication.issuer_public_key
      LIMIT 1
    `;
    return row ? mapPublication(row) : null;
  }
}

export function createServerMainnetPublicationService(sql: DatabaseClient) {
  const backend = new PostgresMainnetPublicationBackend(sql);
  return new MainnetAutomaticPublicationService(backend);
}
