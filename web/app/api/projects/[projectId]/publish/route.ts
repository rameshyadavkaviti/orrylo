import { NextRequest, NextResponse } from "next/server";

import { SESSION_COOKIE_NAME } from "../../../../../lib/auth/constants";
import { isTrustedAuthOrigin } from "../../../../../lib/auth/origin";
import {
  getWalletAuthService,
  readServerAuthConfig,
} from "../../../../../lib/auth/runtime";
import type { AuthSession } from "../../../../../lib/auth/stores";
import type { PublishManagedProjectFailureCode } from "../../../../../lib/projects/managed-project-api";
import {
  isValidProjectId,
  projectPublicPath,
} from "../../../../../lib/projects/project-profile";
import { getDatabaseClient } from "../../../../../lib/server/persistence/database";
import { PostgresProjectProfileRepository } from "../../../../../lib/server/persistence/project-profile-repository";

export const runtime = "nodejs";

export interface PublishProjectRouteDependencies {
  authDomain: string;
  getSession(token: string | undefined): Promise<AuthSession | null>;
  publish(
    projectId: string,
    ownerPublicKey: string,
  ): Promise<{ slug: string; publicStatus: "draft" | "published" } | null>;
}

interface PublishContext {
  params: Promise<{ projectId: string }>;
}

export async function POST(request: NextRequest, context: PublishContext) {
  const config = readServerAuthConfig();
  const repository = new PostgresProjectProfileRepository(getDatabaseClient());

  return handlePublishManagedProject(request, context, {
    authDomain: config.domain,
    getSession: (token) => getWalletAuthService().getSession(token),
    publish: (projectId, ownerPublicKey) =>
      repository.publishOwned(projectId, ownerPublicKey),
  });
}

export async function handlePublishManagedProject(
  request: NextRequest,
  context: PublishContext,
  dependencies: PublishProjectRouteDependencies,
) {
  if (
    !isTrustedAuthOrigin(
      request.headers.get("origin"),
      dependencies.authDomain,
    )
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
    const project = await dependencies.publish(projectId, session.publicKey);

    if (!project) {
      return failure("project_not_found", 404);
    }

    return NextResponse.json(
      {
        ok: true,
        publicStatus: "published",
        publicPath: projectPublicPath(project.slug),
      },
      {
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch {
    return failure("database_failure", 500);
  }
}

function failure(code: PublishManagedProjectFailureCode, status: number) {
  return NextResponse.json(
    { ok: false, code },
    {
      status,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
