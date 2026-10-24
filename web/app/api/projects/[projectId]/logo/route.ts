import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE_NAME } from "../../../../../lib/auth/constants";
import { isTrustedAuthOrigin } from "../../../../../lib/auth/origin";
import { getWalletAuthService, readServerAuthConfig } from "../../../../../lib/auth/runtime";
import { isValidProjectId } from "../../../../../lib/projects/project-profile";
import { getDatabaseClient } from "../../../../../lib/server/persistence/database";
import { PostgresProjectProfileRepository } from "../../../../../lib/server/persistence/project-profile-repository";
import { detectLogoType, logoObjectKey, storeLogo } from "../../../../../lib/server/projects/logo-storage";

export const runtime = "nodejs";
const MAX_BYTES = 2 * 1024 * 1024;

export async function POST(request: NextRequest, context: { params: Promise<{ projectId: string }> }) {
  const config = readServerAuthConfig();
  if (!isTrustedAuthOrigin(request.headers.get("origin"), config.domain)) {
    return NextResponse.json({ ok: false, code: "untrusted_origin" }, { status: 403 });
  }
  const session = await getWalletAuthService().getSession(request.cookies.get(SESSION_COOKIE_NAME)?.value);
  if (!session) return NextResponse.json({ ok: false, code: "unauthenticated" }, { status: 401 });
  const { projectId } = await context.params;
  if (!isValidProjectId(projectId)) return NextResponse.json({ ok: false, code: "invalid_project" }, { status: 400 });
  const repository = new PostgresProjectProfileRepository(getDatabaseClient());
  const owned = await repository.findOwnedById(projectId, session.publicKey);
  if (!owned) return NextResponse.json({ ok: false, code: "project_not_found" }, { status: 404 });

  if (Number(request.headers.get("content-length") ?? "0") > MAX_BYTES + 16384) {
    return NextResponse.json({ ok: false, code: "logo_too_large" }, { status: 413 });
  }
  let file: FormDataEntryValue | null;
  try {
    file = (await request.formData()).get("logo");
  } catch {
    return NextResponse.json({ ok: false, code: "invalid_upload" }, { status: 400 });
  }
  if (!(file instanceof File) || file.size === 0 || file.size > MAX_BYTES) {
    return NextResponse.json({ ok: false, code: "invalid_logo" }, { status: 400 });
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = detectLogoType(bytes);
  if (!type || file.type !== type) {
    return NextResponse.json({ ok: false, code: "invalid_logo_format" }, { status: 400 });
  }
  const hash = createHash("sha256").update(bytes).digest("hex");
  const key = logoObjectKey(projectId, hash, type);
  const publicUrl = `https://assets.orrylo.com/api/assets/${key}`;
  try {
    await storeLogo(key, bytes, type);
    const updated = await repository.updateOwnedLogoUrl(projectId, session.publicKey, publicUrl);
    if (!updated) return NextResponse.json({ ok: false, code: "project_not_found" }, { status: 404 });
    // For already-issued assets, the metadata publication must be reconciled
    // separately. Do not claim remote TOML is updated until verified.
    return NextResponse.json({ ok: true, logoUrl: publicUrl, metadataNeedsReconciliation: owned.publicStatus === "published" }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false, code: "logo_storage_unavailable" }, { status: 503 });
  }
}
