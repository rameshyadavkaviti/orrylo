import { NextRequest, NextResponse } from "next/server";

import { SESSION_COOKIE_NAME } from "../../../../../../lib/auth/constants";
import { isTrustedAuthOrigin } from "../../../../../../lib/auth/origin";
import {
  getWalletAuthService,
  readServerAuthConfig,
} from "../../../../../../lib/auth/runtime";
import type { AuthSession } from "../../../../../../lib/auth/stores";
import type { PublishMetadataFailureCode } from "../../../../../../lib/projects/metadata-publication-api";
import { SHARED_METADATA_TOML_ENDPOINT } from "../../../../../../lib/projects/metadata-publication";
import { isValidProjectId } from "../../../../../../lib/projects/project-profile";
import { getDatabaseClient } from "../../../../../../lib/server/persistence/database";
import {
  MetadataPublicationError,
  MetadataPublicationService,
  type PublishMetadataResult,
} from "../../../../../../lib/server/projects/metadata-publication-service";

export const runtime = "nodejs";

export interface PublishMetadataRouteDependencies {
  authDomain: string;
  getSession(token: string | undefined): Promise<AuthSession | null>;
  publish(
    projectId: string,
    ownerPublicKey: string,
  ): Promise<PublishMetadataResult>;
}

interface PublishMetadataContext {
  params: Promise<{ projectId: string }>;
}

export async function POST(
  request: NextRequest,
  context: PublishMetadataContext,
) {
  const config = readServerAuthConfig();
  const service = new MetadataPublicationService(getDatabaseClient());

  return handlePublishMetadata(request, context, {
    authDomain: config.domain,
    getSession: (token) => getWalletAuthService().getSession(token),
    publish: (projectId, ownerPublicKey) =>
      service.publishOwnedProject(projectId, ownerPublicKey),
  });
}

export async function handlePublishMetadata(
  request: NextRequest,
  context: PublishMetadataContext,
  dependencies: PublishMetadataRouteDependencies,
) {
  if (
    !isTrustedAuthOrigin(request.headers.get("origin"), dependencies.authDomain)
  ) {
    return failure("untrusted_origin", 403);
  }

  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = await dependencies.getSession(token);

  if (!session) {
    return failure("unauthenticated", 401);
  }

  const { projectId } = await context.params;

  if (!isValidProjectId(projectId)) {
    return failure("invalid_request", 400);
  }

  try {
    const result = await dependencies.publish(projectId, session.publicKey);

    if (result.status === "published_not_reachable") {
      return NextResponse.json(
        {
          ok: false,
          code: "verification_failed",
          published: true,
          reachable: false,
          endpoint: SHARED_METADATA_TOML_ENDPOINT,
          contentHash: result.publication.contentHash,
          revision: result.publication.revision,
          verificationErrorCode: result.publication.verificationErrorCode,
        },
        {
          status: 502,
          headers: { "Cache-Control": "no-store" },
        },
      );
    }

    if (!result.publication.verifiedAt) {
      return failure("database_failure", 500);
    }

    return NextResponse.json(
      {
        ok: true,
        changed: result.changed,
        published: true,
        reachable: true,
        endpoint: SHARED_METADATA_TOML_ENDPOINT,
        contentHash: result.publication.contentHash,
        revision: result.publication.revision,
        verifiedAt: result.publication.verifiedAt,
      },
      {
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (error) {
    if (error instanceof MetadataPublicationError) {
      switch (error.code) {
        case "project_not_found":
          return failure("project_not_found", 404);
        case "unsupported_issuer_model":
        case "unsupported_network":
        case "not_ready":
        case "asset_identity_conflict":
        case "publication_superseded":
          return failure(error.code, 409);
        case "invalid_owner":
          return failure("unauthenticated", 401);
        case "database_invariant":
          return failure("database_failure", 500);
      }
    }

    return failure("database_failure", 500);
  }
}

function failure(code: PublishMetadataFailureCode, status: number) {
  return NextResponse.json(
    { ok: false, code },
    {
      status,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
