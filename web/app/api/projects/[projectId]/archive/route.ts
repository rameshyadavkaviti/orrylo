import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE_NAME } from "../../../../../lib/auth/constants";
import { isTrustedAuthOrigin } from "../../../../../lib/auth/origin";
import { getWalletAuthService, readServerAuthConfig } from "../../../../../lib/auth/runtime";
import { isValidProjectId } from "../../../../../lib/projects/project-profile";
import { getDatabaseClient } from "../../../../../lib/server/persistence/database";
import { PostgresProjectProfileRepository } from "../../../../../lib/server/persistence/project-profile-repository";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) {
  const config = readServerAuthConfig();
  if (!isTrustedAuthOrigin(request.headers.get("origin"), config.domain))
    return response("untrusted_origin", 403);
  const session = await getWalletAuthService().getSession(
    request.cookies.get(SESSION_COOKIE_NAME)?.value,
  );
  if (!session) return response("unauthenticated", 401);
  const { projectId } = await context.params;
  if (!isValidProjectId(projectId)) return response("invalid_project", 400);
  try {
    const repo = new PostgresProjectProfileRepository(getDatabaseClient());
    const archived = await repo.archiveOwnedDraft(projectId, session.publicKey);
    if (!archived) return response("not_deletable", 409);
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return response("archive_unavailable", 503);
  }
}
function response(code: string, status: number) {
  return NextResponse.json({ ok: false, code }, { status, headers: { "Cache-Control": "no-store" } });
}
