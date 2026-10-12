import { NextRequest, NextResponse } from "next/server";

import { SESSION_COOKIE_NAME } from "../../../../../lib/auth/constants";
import { isTrustedAuthOrigin } from "../../../../../lib/auth/origin";
import { getWalletAuthService, readServerAuthConfig } from "../../../../../lib/auth/runtime";
import type { AuthSession } from "../../../../../lib/auth/stores";
import { isValidProjectId } from "../../../../../lib/projects/project-profile";
import { getDatabaseClient } from "../../../../../lib/server/persistence/database";
import {
  TestnetIssuanceError,
  TestnetIssuanceService,
  type TestnetIssuanceRecord,
} from "../../../../../lib/server/projects/testnet-issuance-service";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ projectId: string }>;
}

export interface IssuanceRouteDependencies {
  authDomain: string;
  getSession(token: string | undefined): Promise<AuthSession | null>;
  getStatus(projectId: string, wallet: string): Promise<TestnetIssuanceRecord | null>;
  requestIssuance(input: {
    projectId: string;
    ownerPublicKey: string;
    idempotencyKey: string;
    expectedAssetCode: string;
  }): Promise<{ created: boolean; issuance: TestnetIssuanceRecord }>;
}

function dependencies(): IssuanceRouteDependencies {
  const config = readServerAuthConfig();
  const service = new TestnetIssuanceService(getDatabaseClient(), {
    network: config.network,
  });
  return {
    authDomain: config.domain,
    getSession: (token) => getWalletAuthService().getSession(token),
    getStatus: (projectId, wallet) => service.getOwnedStatus(projectId, wallet),
    requestIssuance: (input) => service.request(input),
  };
}

export async function GET(request: NextRequest, context: RouteContext) {
  return handleGetIssuance(request, context, dependencies());
}

export async function POST(request: NextRequest, context: RouteContext) {
  return handleRequestIssuance(request, context, dependencies());
}

export async function handleGetIssuance(
  request: NextRequest,
  context: RouteContext,
  deps: IssuanceRouteDependencies,
) {
  const session = await deps.getSession(request.cookies.get(SESSION_COOKIE_NAME)?.value);
  if (!session) return failure("unauthenticated", 401);
  const { projectId } = await context.params;
  if (!isValidProjectId(projectId)) return failure("invalid_request", 400);

  try {
    const issuance = await deps.getStatus(projectId, session.publicKey);
    return NextResponse.json(
      { ok: true, status: issuance?.status ?? "not_started", issuance },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return mapError(error);
  }
}

export async function handleRequestIssuance(
  request: NextRequest,
  context: RouteContext,
  deps: IssuanceRouteDependencies,
) {
  if (!isTrustedAuthOrigin(request.headers.get("origin"), deps.authDomain)) {
    return failure("untrusted_origin", 403);
  }
  const session = await deps.getSession(request.cookies.get(SESSION_COOKIE_NAME)?.value);
  if (!session) return failure("unauthenticated", 401);
  const { projectId } = await context.params;
  if (!isValidProjectId(projectId)) return failure("invalid_request", 400);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return failure("invalid_request", 400);
  }
  const parsed = parseRequest(body);
  if (!parsed) return failure("invalid_request", 400);

  try {
    const outcome = await deps.requestIssuance({
      projectId,
      ownerPublicKey: session.publicKey,
      ...parsed,
    });
    return NextResponse.json(
      { ok: true, created: outcome.created, issuance: outcome.issuance },
      {
        status: outcome.created ? 201 : 200,
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (error) {
    return mapError(error);
  }
}

function parseRequest(
  body: unknown,
): { idempotencyKey: string; expectedAssetCode: string } | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const fields = body as Record<string, unknown>;
  if (
    Object.keys(fields).sort().join(",") !== "expectedAssetCode,idempotencyKey" ||
    typeof fields.idempotencyKey !== "string" ||
    typeof fields.expectedAssetCode !== "string"
  ) return null;
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(fields.idempotencyKey) ||
    !/^[A-Z0-9]{1,12}$/.test(fields.expectedAssetCode)
  ) return null;
  return {
    idempotencyKey: fields.idempotencyKey,
    expectedAssetCode: fields.expectedAssetCode,
  };
}

function mapError(error: unknown) {
  if (error instanceof TestnetIssuanceError) {
    const code = error.code;
    if (code === "project_not_found") return failure(code, 404);
    if (code === "invalid_request" || code === "invalid_asset_configuration" ||
        code === "asset_code_mismatch") return failure(code, 400);
    if (code === "unsupported_network") return failure(code, 403);
    if (code === "ineligible_project" || code === "idempotency_conflict" ||
        code === "issuance_already_requested" || code === "asset_code_reserved") {
      return failure(code, 409);
    }
  }
  return failure("database_failure", 500);
}

function failure(code: string, status: number) {
  return NextResponse.json(
    { ok: false, code },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}
