import { NextRequest, NextResponse } from "next/server";

import { SESSION_COOKIE_NAME } from "../../../../../lib/auth/constants";
import { isTrustedAuthOrigin } from "../../../../../lib/auth/origin";
import {
  getWalletAuthService,
  readServerAuthConfig,
} from "../../../../../lib/auth/runtime";
import type { AuthSession } from "../../../../../lib/auth/stores";
import type { UpdateProjectMetadataFailureCode } from "../../../../../lib/projects/managed-project-metadata-api";
import {
  parseEditableProjectMetadataInput,
  type NormalizedProjectMetadata,
  validateEditableProjectMetadata,
} from "../../../../../lib/projects/project-metadata";
import { isValidProjectId } from "../../../../../lib/projects/project-profile";
import { getDatabaseClient } from "../../../../../lib/server/persistence/database";
import { PostgresProjectProfileRepository } from "../../../../../lib/server/persistence/project-profile-repository";

export const runtime = "nodejs";

export interface UpdateProjectMetadataRouteDependencies {
  authDomain: string;
  getSession(token: string | undefined): Promise<AuthSession | null>;
  updateMetadata(
    projectId: string,
    ownerPublicKey: string,
    metadata: NormalizedProjectMetadata,
  ): Promise<{ projectId: string; updatedAt: string } | null>;
}

interface MetadataContext {
  params: Promise<{ projectId: string }>;
}

export async function PATCH(request: NextRequest, context: MetadataContext) {
  const config = readServerAuthConfig();
  const repository = new PostgresProjectProfileRepository(getDatabaseClient());

  return handleUpdateProjectMetadata(request, context, {
    authDomain: config.domain,
    getSession: (token) => getWalletAuthService().getSession(token),
    updateMetadata: async (projectId, ownerPublicKey, metadata) => {
      const project = await repository.updateOwnedMetadata(
        projectId,
        ownerPublicKey,
        metadata,
      );

      return project
        ? { projectId: project.projectId, updatedAt: project.updatedAt }
        : null;
    },
  });
}

export async function handleUpdateProjectMetadata(
  request: NextRequest,
  context: MetadataContext,
  dependencies: UpdateProjectMetadataRouteDependencies,
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

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return failure("invalid_request", 400);
  }

  const input = parseEditableProjectMetadataInput(body);

  if (!input) {
    return failure("invalid_request", 400);
  }

  const validation = validateEditableProjectMetadata(input);

  if (!validation.valid) {
    return NextResponse.json(
      {
        ok: false,
        code: "invalid_metadata",
        fieldErrors: validation.errors,
      },
      {
        status: 400,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }

  try {
    const project = await dependencies.updateMetadata(
      projectId,
      session.publicKey,
      validation.normalized,
    );

    if (!project) {
      return failure("project_not_found", 404);
    }

    return NextResponse.json(
      {
        ok: true,
        projectId: project.projectId,
        updatedAt: project.updatedAt,
      },
      {
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch {
    return failure("database_failure", 500);
  }
}

function failure(code: UpdateProjectMetadataFailureCode, status: number) {
  return NextResponse.json(
    { ok: false, code },
    {
      status,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
