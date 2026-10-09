import { createHash } from "node:crypto";

import type { MetadataPublicationState } from "../../projects/metadata-publication";
import type { ProjectProfile } from "../../projects/project-profile";
import { isValidProjectId } from "../../projects/project-profile";
import { generateProjectCurrencyToml } from "../../projects/stellar-toml";
import { SHARED_ASSET_DOMAIN } from "../../product/constants";
import type { DatabaseClient } from "../persistence/database";
import {
  mapMetadataPublication,
  type MetadataPublicationRow,
  PostgresMetadataPublicationRepository,
} from "../persistence/metadata-publication-repository";
import {
  InvalidStellarPublicKeyError,
  normalizeWalletPublicKey,
} from "../persistence/wallet";
import {
  FixedSharedMetadataVerifier,
  type MetadataPublicationVerifier,
} from "./metadata-publication-verifier";

const PUBLICATION_LOCK_KEY = "orrylo:metadata:testnet:assets.orrylo.com";

export type MetadataPublicationErrorCode =
  | "invalid_owner"
  | "project_not_found"
  | "unsupported_issuer_model"
  | "unsupported_network"
  | "not_ready"
  | "asset_identity_conflict"
  | "publication_superseded"
  | "database_invariant";

export class MetadataPublicationError extends Error {
  constructor(readonly code: MetadataPublicationErrorCode) {
    super(code);
    this.name = "MetadataPublicationError";
  }
}

export interface PublishMetadataResult {
  status: "verified" | "published_not_reachable";
  changed: boolean;
  publication: MetadataPublicationState;
}

interface LockedProjectRow {
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

export class MetadataPublicationService {
  private readonly verifier: MetadataPublicationVerifier;

  constructor(
    private readonly sql: DatabaseClient,
    private readonly options: {
      now?: () => number;
      verifier?: MetadataPublicationVerifier;
    } = {},
  ) {
    this.verifier = options.verifier ?? new FixedSharedMetadataVerifier();
  }

  async publishOwnedProject(
    projectId: string,
    ownerPublicKeyInput: string,
  ): Promise<PublishMetadataResult> {
    if (!isValidProjectId(projectId)) {
      throw new MetadataPublicationError("project_not_found");
    }

    let ownerPublicKey: string;

    try {
      ownerPublicKey = normalizeWalletPublicKey(ownerPublicKeyInput);
    } catch (error) {
      if (error instanceof InvalidStellarPublicKeyError) {
        throw new MetadataPublicationError("invalid_owner");
      }

      throw error;
    }

    const now = this.options.now?.() ?? Date.now();

    let outcome: {
      changed: boolean;
      publication: MetadataPublicationState;
    };

    try {
      outcome = await this.sql.begin(async (transaction) => {
        const [row] = await transaction<LockedProjectRow[]>`
          SELECT p.*
          FROM project_profiles AS p
          INNER JOIN project_profile_owners AS o
            ON o.project_id = p.project_id
          WHERE p.project_id = ${projectId}
            AND o.owner_public_key = ${ownerPublicKey}
          FOR UPDATE OF p
        `;

        if (!row) {
          throw new MetadataPublicationError("project_not_found");
        }

        const project = mapLockedProject(row);

        if (project.issuerModel !== "shared") {
          throw new MetadataPublicationError("unsupported_issuer_model");
        }

        if (project.network !== "testnet") {
          throw new MetadataPublicationError("unsupported_network");
        }

        if (project.metadataHome !== SHARED_ASSET_DOMAIN) {
          throw new MetadataPublicationError("not_ready");
        }

        const generated = generateProjectCurrencyToml(project);

        if (
          !generated ||
          !generated.issuerIncluded ||
          !generated.issuerPublicKey
        ) {
          throw new MetadataPublicationError("not_ready");
        }

        const contentHash = createHash("sha256")
          .update(generated.content, "utf8")
          .digest("hex");

        await transaction`
          SELECT pg_advisory_xact_lock(
            hashtextextended(${PUBLICATION_LOCK_KEY}, 0)
          )
        `;

        const [conflict] = await transaction<{ project_id: string }[]>`
          SELECT project_id
          FROM project_metadata_publications
          WHERE network = 'testnet'
            AND metadata_home = ${SHARED_ASSET_DOMAIN}
            AND asset_code = ${project.assetCode}
            AND issuer_public_key = ${generated.issuerPublicKey}
            AND project_id <> ${project.projectId}
          LIMIT 1
        `;

        if (conflict) {
          throw new MetadataPublicationError("asset_identity_conflict");
        }

        const [existing] = await transaction<MetadataPublicationRow[]>`
          SELECT *
          FROM project_metadata_publications
          WHERE project_id = ${project.projectId}
          FOR UPDATE
        `;

        if (
          existing &&
          existing.content_hash.trim() === contentHash &&
          existing.currency_toml === generated.content &&
          existing.metadata_home === SHARED_ASSET_DOMAIN &&
          existing.network === "testnet" &&
          existing.asset_code === project.assetCode &&
          existing.issuer_public_key.trim() === generated.issuerPublicKey
        ) {
          return {
            changed: false,
            publication: mapMetadataPublication(existing),
          };
        }

        const [published] = await transaction<MetadataPublicationRow[]>`
          INSERT INTO project_metadata_publications (
            project_id,
            metadata_home,
            network,
            asset_code,
            issuer_public_key,
            currency_toml,
            content_hash,
            revision,
            published_at,
            updated_at,
            reachable,
            verified_at,
            last_verification_at,
            verification_error_code
          )
          VALUES (
            ${project.projectId},
            ${SHARED_ASSET_DOMAIN},
            'testnet',
            ${project.assetCode},
            ${generated.issuerPublicKey},
            ${generated.content},
            ${contentHash},
            1,
            ${new Date(now)},
            ${new Date(now)},
            false,
            NULL,
            NULL,
            NULL
          )
          ON CONFLICT (project_id) DO UPDATE
          SET
            metadata_home = EXCLUDED.metadata_home,
            network = EXCLUDED.network,
            asset_code = EXCLUDED.asset_code,
            issuer_public_key = EXCLUDED.issuer_public_key,
            currency_toml = EXCLUDED.currency_toml,
            content_hash = EXCLUDED.content_hash,
            revision = project_metadata_publications.revision + 1,
            published_at = EXCLUDED.published_at,
            updated_at = EXCLUDED.updated_at,
            reachable = false,
            verified_at = NULL,
            last_verification_at = NULL,
            verification_error_code = NULL
          RETURNING *
        `;

        if (!published) {
          throw new MetadataPublicationError("database_invariant");
        }

        return {
          changed: true,
          publication: mapMetadataPublication(published),
        };
      });
    } catch (error) {
      if (
        !(error instanceof MetadataPublicationError) &&
        isUniqueViolation(error)
      ) {
        throw new MetadataPublicationError("asset_identity_conflict");
      }

      throw error;
    }

    if (!outcome.changed && outcome.publication.reachable) {
      return {
        status: "verified",
        changed: false,
        publication: outcome.publication,
      };
    }

    const verification = await this.verifier.verify(outcome.publication);
    const verificationNow = this.options.now?.() ?? Date.now();
    const repository = new PostgresMetadataPublicationRepository(this.sql);

    const publication = verification.ok
      ? await repository.markVerifiedIfCurrent({
          projectId,
          contentHash: outcome.publication.contentHash,
          now: verificationNow,
        })
      : await repository.markVerificationFailureIfCurrent({
          projectId,
          contentHash: outcome.publication.contentHash,
          errorCode: verification.code,
          now: verificationNow,
        });

    if (!publication) {
      throw new MetadataPublicationError("publication_superseded");
    }

    return {
      status: verification.ok ? "verified" : "published_not_reachable",
      changed: outcome.changed,
      publication,
    };
  }
}

function mapLockedProject(row: LockedProjectRow): ProjectProfile {
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

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
}
