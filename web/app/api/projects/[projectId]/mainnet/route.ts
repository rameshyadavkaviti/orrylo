import { NextRequest, NextResponse } from "next/server";

import { SESSION_COOKIE_NAME } from "../../../../../lib/auth/constants";
import { isTrustedAuthOrigin } from "../../../../../lib/auth/origin";
import {
  getWalletAuthService,
  readServerAuthConfig,
} from "../../../../../lib/auth/runtime";
import type { AuthSession } from "../../../../../lib/auth/stores";
import { isValidProjectId } from "../../../../../lib/projects/project-profile";
import { createMainnetCreationRuntime } from "../../../../../lib/server/projects/mainnet-creation-runtime";
import { MainnetCreationServiceError } from "../../../../../lib/server/projects/mainnet-creation-service";

export const runtime = "nodejs";

interface Context {
  params: Promise<{ projectId: string }>;
}

export interface MainnetCreationRouteDependencies {
  authDomain: string;
  getSession(token: string | undefined): Promise<AuthSession | null>;
  getState(projectId: string, ownerPublicKey: string): Promise<unknown>;
  prepareTrustline(projectId: string, ownerPublicKey: string): Promise<unknown>;
  confirmTrustline(
    projectId: string,
    ownerPublicKey: string,
    transactionHash: string,
  ): Promise<unknown>;
  issue(projectId: string, ownerPublicKey: string): Promise<unknown>;
}

function dependencies(): MainnetCreationRouteDependencies {
  const auth = readServerAuthConfig();
  let service: ReturnType<typeof createMainnetCreationRuntime> | null = null;
  const getService = () => {
    service ??= createMainnetCreationRuntime();
    return service;
  };
  return {
    authDomain: auth.domain,
    getSession: (token) => getWalletAuthService().getSession(token),
    getState: (projectId, owner) => getService().getState(projectId, owner),
    prepareTrustline: (projectId, owner) =>
      getService().prepareTrustline(projectId, owner),
    confirmTrustline: (projectId, owner, hash) =>
      getService().confirmTrustline(projectId, owner, hash),
    issue: (projectId, owner) =>
      getService().issueOrReconcile(projectId, owner),
  };
}

export async function GET(request: NextRequest, context: Context) {
  try {
    return await handleMainnetCreationGet(request, context, dependencies());
  } catch (error) {
    return mapError(error);
  }
}

export async function POST(request: NextRequest, context: Context) {
  try {
    return await handleMainnetCreationPost(request, context, dependencies());
  } catch (error) {
    return mapError(error);
  }
}

async function authorize(
  request: NextRequest,
  context: Context,
  deps: MainnetCreationRouteDependencies,
) {
  const session = await deps.getSession(
    request.cookies.get(SESSION_COOKIE_NAME)?.value,
  );
  if (!session) return failure("unauthenticated", 401);
  const { projectId } = await context.params;
  if (!isValidProjectId(projectId)) return failure("invalid_request", 400);
  return { projectId, ownerPublicKey: session.publicKey };
}

export async function handleMainnetCreationGet(
  request: NextRequest,
  context: Context,
  deps: MainnetCreationRouteDependencies,
) {
  const authorized = await authorize(request, context, deps);
  if (authorized instanceof Response) return authorized;
  try {
    const order = await deps.getState(
      authorized.projectId,
      authorized.ownerPublicKey,
    );
    return NextResponse.json(
      { ok: true, order },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return mapError(error);
  }
}

export async function handleMainnetCreationPost(
  request: NextRequest,
  context: Context,
  deps: MainnetCreationRouteDependencies,
) {
  if (!isTrustedAuthOrigin(request.headers.get("origin"), deps.authDomain)) {
    return failure("untrusted_origin", 403);
  }
  const authorized = await authorize(request, context, deps);
  if (authorized instanceof Response) return authorized;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return failure("invalid_request", 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return failure("invalid_request", 400);
  }
  const value = body as Record<string, unknown>;
  const keys = Object.keys(value).sort().join(",");
  try {
    let result: unknown;
    if (value.action === "prepare_trustline" && keys === "action") {
      result = await deps.prepareTrustline(
        authorized.projectId,
        authorized.ownerPublicKey,
      );
    } else if (
      value.action === "confirm_trustline" &&
      keys === "action,transactionHash" &&
      typeof value.transactionHash === "string" &&
      /^[0-9a-f]{64}$/.test(value.transactionHash)
    ) {
      result = await deps.confirmTrustline(
        authorized.projectId,
        authorized.ownerPublicKey,
        value.transactionHash,
      );
    } else if (value.action === "issue" && keys === "action") {
      result = await deps.issue(
        authorized.projectId,
        authorized.ownerPublicKey,
      );
    } else {
      return failure("invalid_request", 400);
    }
    return NextResponse.json(
      { ok: true, result },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return mapError(error);
  }
}

function mapError(error: unknown) {
  const code =
    error && typeof error === "object" && "code" in error
      ? String(error.code)
      : error instanceof Error
        ? error.message
        : "mainnet_failure";
  if (
    code === "mainnet_disabled" ||
    code === "mainnet_configuration_unavailable" ||
    code === "treasury_identity_forbidden" ||
    code === "signer_unavailable" ||
    code === "signer_identity_mismatch" ||
    code === "mainnet_horizon_unavailable" ||
    code === "horizon_unavailable"
  ) {
    return failure(code, 503);
  }
  if (code === "order_not_found" || code === "project_not_found") {
    return failure(code, 404);
  }
  if (code === "invalid_request") return failure(code, 400);
  if (
    error instanceof MainnetCreationServiceError ||
    [
      "idempotency_conflict",
      "ineligible_project",
      "invalid_state_transition",
      "payment_already_consumed",
    ].includes(code)
  ) {
    return failure(code, 409);
  }
  return failure("mainnet_failure", 500);
}

function failure(code: string, status: number) {
  return NextResponse.json(
    { ok: false, code },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}
