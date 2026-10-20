import type { MetadataPublicationState } from "../../projects/metadata-publication";
import type { DatabaseClient } from "../persistence/database";
import { PostgresMetadataPublicationRepository } from "../persistence/metadata-publication-repository";
import { PostgresProjectProfileRepository } from "../persistence/project-profile-repository";
import { normalizeWalletPublicKey } from "../persistence/wallet";
import {
  MetadataPublicationService,
  type PublishMetadataResult,
} from "./metadata-publication-service";
import {
  PostgresSharedAssetConfirmationReader,
  type VerifiedSharedAssetProvenance,
} from "./shared-asset-provenance";

export interface AutomaticPublicationResult {
  status: "not_issued" | "pending" | "complete";
  landingPage: "draft" | "published" | "failed";
  metadata: "not_published" | "pending" | "verified" | "failed";
  errors: string[];
}

export interface AutomaticPublicationDependencies {
  findConfirmation(
    projectId: string,
    ownerPublicKey: string,
  ): Promise<VerifiedSharedAssetProvenance | null>;
  publishLandingPage(
    projectId: string,
    ownerPublicKey: string,
    confirmation: VerifiedSharedAssetProvenance,
  ): Promise<{ slug: string; publicStatus: "published" } | null>;
  publishMetadata(
    projectId: string,
    ownerPublicKey: string,
  ): Promise<PublishMetadataResult>;
}

export async function reconcilePublicationAfterConfirmedExecution(
  execution: { status: string },
  reconcile: () => Promise<AutomaticPublicationResult>,
): Promise<AutomaticPublicationResult | undefined> {
  if (execution.status !== "confirmed") return undefined;

  try {
    return await reconcile();
  } catch (error) {
    return {
      status: "pending",
      landingPage: "failed",
      metadata: "failed",
      errors: [safeErrorCode(error, "automatic_publication_failed")],
    };
  }
}

export class AutomaticPublicationService {
  constructor(
    private readonly dependencies: AutomaticPublicationDependencies,
  ) {}

  async reconcileConfirmedProject(
    projectId: string,
    ownerPublicKey: string,
  ): Promise<AutomaticPublicationResult> {
    const confirmation = await this.dependencies.findConfirmation(
      projectId,
      ownerPublicKey,
    );
    if (!confirmation) {
      return {
        status: "not_issued",
        landingPage: "draft",
        metadata: "not_published",
        errors: [],
      };
    }

    const errors: string[] = [];
    let landingPage: AutomaticPublicationResult["landingPage"] = "failed";
    let metadata: AutomaticPublicationResult["metadata"] = "failed";

    try {
      const published = await this.dependencies.publishLandingPage(
        projectId,
        ownerPublicKey,
        confirmation,
      );
      if (published?.publicStatus === "published") {
        landingPage = "published";
      } else {
        errors.push("landing_page_not_ready");
      }
    } catch (error) {
      errors.push(safeErrorCode(error, "landing_page_publication_failed"));
    }

    try {
      const result = await this.dependencies.publishMetadata(
        projectId,
        ownerPublicKey,
      );
      if (result.status === "verified" && result.publication.reachable) {
        metadata = "verified";
      } else {
        metadata = "pending";
        errors.push(
          result.publication.verificationErrorCode ??
            "metadata_verification_pending",
        );
      }
    } catch (error) {
      errors.push(safeErrorCode(error, "metadata_publication_failed"));
    }

    return {
      status:
        landingPage === "published" && metadata === "verified"
          ? "complete"
          : "pending",
      landingPage,
      metadata,
      errors: [...new Set(errors)],
    };
  }
}

export function createServerAutomaticPublicationService(
  sql: DatabaseClient,
  env: NodeJS.ProcessEnv = process.env,
): AutomaticPublicationService {
  const approvedIssuer = readApprovedIssuer(env);
  const confirmationReader = new PostgresSharedAssetConfirmationReader(sql);
  const projectRepository = new PostgresProjectProfileRepository(sql);
  const metadataService = createServerMetadataPublicationService(sql, env);

  return new AutomaticPublicationService({
    async findConfirmation(projectId, ownerPublicKey) {
      const confirmation = await confirmationReader.findConfirmed(
        projectId,
        ownerPublicKey,
      );
      return confirmation?.issuerPublicKey === approvedIssuer
        ? confirmation
        : null;
    },
    async publishLandingPage(projectId, ownerPublicKey, confirmation) {
      const project = await projectRepository.publishConfirmedOwned(
        projectId,
        ownerPublicKey,
        confirmation,
      );
      return project?.publicStatus === "published"
        ? { slug: project.slug, publicStatus: "published" as const }
        : null;
    },
    publishMetadata: (projectId, ownerPublicKey) =>
      metadataService.publishOwnedProject(projectId, ownerPublicKey),
  });
}

export function createServerMetadataPublicationRepository(
  sql: DatabaseClient,
  env: NodeJS.ProcessEnv = process.env,
): PostgresMetadataPublicationRepository {
  const approvedIssuer = readApprovedIssuer(env);
  return new PostgresMetadataPublicationRepository(sql, {
    approvedIssuerPublicKey: approvedIssuer,
    confirmationReader: new PostgresSharedAssetConfirmationReader(sql),
  });
}

export function createServerMetadataPublicationService(
  sql: DatabaseClient,
  env: NodeJS.ProcessEnv = process.env,
): MetadataPublicationService {
  return new MetadataPublicationService(sql, {
    approvedIssuerPublicKey: readApprovedIssuer(env),
    confirmationReader: new PostgresSharedAssetConfirmationReader(sql),
  });
}

function readApprovedIssuer(env: NodeJS.ProcessEnv): string {
  return normalizeWalletPublicKey(
    env.ORRYLO_APPROVED_TESTNET_SHARED_ISSUER_PUBLIC_KEY ?? "",
  );
}

function safeErrorCode(error: unknown, fallback: string): string {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string" &&
    /^[a-z0-9_]{1,80}$/.test(error.code)
  ) {
    return error.code;
  }
  return fallback;
}

export type { MetadataPublicationState };
