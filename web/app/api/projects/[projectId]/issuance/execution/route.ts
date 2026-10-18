import { NextRequest, NextResponse } from "next/server";

import { SESSION_COOKIE_NAME } from "../../../../../../lib/auth/constants";
import { isTrustedAuthOrigin } from "../../../../../../lib/auth/origin";
import {
  getWalletAuthService,
  readServerAuthConfig,
} from "../../../../../../lib/auth/runtime";
import type { AuthSession } from "../../../../../../lib/auth/stores";
import { isValidProjectId } from "../../../../../../lib/projects/project-profile";
import type { SharedIssuanceOrchestrationResult } from "../../../../../../lib/server/projects/shared-issuance-orchestrator";
import { getServerSharedIssuanceOrchestrator } from "../../../../../../lib/server/projects/shared-issuance-runtime";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ projectId: string }>;
}

export interface IssuanceExecutionRouteDependencies {
  authDomain: string;
  getSession(token: string | undefined): Promise<AuthSession | null>;
  startOrResume(input: {
    requestId: string;
    projectId: string;
    ownerPublicKey: string;
  }): Promise<SharedIssuanceOrchestrationResult>;
}

function dependencies(): IssuanceExecutionRouteDependencies {
  const config = readServerAuthConfig();
  return {
    authDomain: config.domain,
    getSession: (token) => getWalletAuthService().getSession(token),
    async startOrResume(input) {
      const orchestrator = await getServerSharedIssuanceOrchestrator();
      return orchestrator.startOrResume(input);
    },
  };
}

export async function POST(request: NextRequest, context: RouteContext) {
  return handleStartOrResumeIssuance(request, context, dependencies());
}

export async function handleStartOrResumeIssuance(
  request: NextRequest,
  context: RouteContext,
  deps: IssuanceExecutionRouteDependencies,
) {
  if (!isTrustedAuthOrigin(request.headers.get("origin"), deps.authDomain)) {
    return failure("untrusted_origin", 403);
  }
  const session = await deps.getSession(
    request.cookies.get(SESSION_COOKIE_NAME)?.value,
  );
  if (!session) return failure("unauthenticated", 401);
  const { projectId } = await context.params;
  if (!isValidProjectId(projectId)) return failure("invalid_request", 400);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return failure("invalid_request", 400);
  }
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).join(",") !== "requestId" ||
    typeof (body as { requestId?: unknown }).requestId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      (body as { requestId: string }).requestId,
    )
  ) {
    return failure("invalid_request", 400);
  }

  try {
    const result = await deps.startOrResume({
      requestId: (body as { requestId: string }).requestId,
      projectId,
      ownerPublicKey: session.publicKey,
    });
    return NextResponse.json(
      { ok: true, execution: result },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String(error.code)
        : "execution_failure";
    if (code === "owner_intent_mismatch") return failure(code, 403);
    if (code === "intent_not_found") return failure(code, 404);
    if (code === "issuer_integration_unavailable") return failure(code, 503);
    if (
      [
        "signer_unavailable",
        "signer_identity_mismatch",
        "signer_authentication_failed",
      ].includes(code)
    )
      return failure(code, 503);
    return failure(code, 409);
  }
}

function failure(code: string, status: number) {
  return NextResponse.json(
    { ok: false, code },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}
