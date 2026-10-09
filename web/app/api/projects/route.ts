import { NextRequest, NextResponse } from "next/server";

import { SESSION_COOKIE_NAME } from "../../../lib/auth/constants";
import { isTrustedAuthOrigin } from "../../../lib/auth/origin";
import type { AuthSession } from "../../../lib/auth/stores";
import {
  getWalletAuthService,
  readServerAuthConfig,
} from "../../../lib/auth/runtime";
import {
  parseCreateManagedProjectRequest,
  type CreateManagedProjectFailureCode,
} from "../../../lib/projects/managed-project-api";
import {
  projectManagePath,
  projectPublicPath,
} from "../../../lib/projects/project-profile";
import { getDatabaseClient } from "../../../lib/server/persistence/database";
import {
  ManagedProjectCreationError,
  ManagedProjectService,
} from "../../../lib/server/projects/managed-project-service";

export const runtime = "nodejs";

export interface CreateProjectRouteDependencies {
  authDomain: string;
  getSession(token: string | undefined): Promise<AuthSession | null>;
  createProject(
    ownerPublicKey: string,
    input: {
      idempotencyKey: string;
      code: string;
      displayName: string;
      description: string;
    },
  ): Promise<{
    created: boolean;
    project: {
      projectId: string;
      slug: string;
      publicStatus: "draft" | "published";
    };
  }>;
}

export async function POST(request: NextRequest) {
  const config = readServerAuthConfig();
  const service = new ManagedProjectService(getDatabaseClient(), {
    network: config.network,
  });

  return handleCreateManagedProject(request, {
    authDomain: config.domain,
    getSession: (token) => getWalletAuthService().getSession(token),
    createProject: (ownerPublicKey, input) =>
      service.createManagedProject({ ownerPublicKey, ...input }),
  });
}

export async function handleCreateManagedProject(
  request: NextRequest,
  dependencies: CreateProjectRouteDependencies,
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

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return failure("invalid_request", 400);
  }

  const input = parseCreateManagedProjectRequest(body);

  if (!input) {
    return failure("invalid_request", 400);
  }

  try {
    const result = await dependencies.createProject(session.publicKey, input);

    return NextResponse.json(
      {
        ok: true,
        created: result.created,
        projectId: result.project.projectId,
        slug: result.project.slug,
        managePath: projectManagePath(result.project.projectId),
        publicPath: projectPublicPath(result.project.slug),
        publicStatus: result.project.publicStatus,
      },
      {
        status: result.created ? 201 : 200,
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (error) {
    if (error instanceof ManagedProjectCreationError) {
      if (
        error.code === "idempotency_conflict" ||
        error.code === "slug_unavailable"
      ) {
        return failure(error.code, 409);
      }

      if (
        error.code === "invalid_project" ||
        error.code === "invalid_idempotency_key"
      ) {
        return failure(error.code, 400);
      }
    }

    return failure("database_failure", 500);
  }
}

function failure(code: CreateManagedProjectFailureCode, status: number) {
  return NextResponse.json(
    { ok: false, code },
    {
      status,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
