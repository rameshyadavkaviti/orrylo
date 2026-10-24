import { NextResponse } from "next/server";
import { isValidProjectId } from "../../../../../../lib/projects/project-profile";
import { detectLogoType, readLogo } from "../../../../../../lib/server/projects/logo-storage";
import { getDatabaseClient } from "../../../../../../lib/server/persistence/database";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ projectId: string; filename: string }> }) {
  const { projectId, filename } = await context.params;
  if (!isValidProjectId(projectId) || !/^[a-f0-9]{64}\.(?:png|jpg|webp)$/.test(filename)) {
    return new Response("Not found", { status: 404 });
  }
  const url = `https://assets.orrylo.com/api/assets/logos/${projectId}/${filename}`;
  // Never expose unreferenced or deleted project uploads.
  const sql = getDatabaseClient();
  const rows = await sql<{ project_id: string }[]>`
    SELECT project_id FROM project_profiles
    WHERE project_id = ${projectId} AND logo_url = ${url}
      AND public_status = 'published' AND deleted_at IS NULL
    LIMIT 1
  `;
  if (!rows.length) return new Response("Not found", { status: 404 });
  try {
    const bytes = await readLogo(`logos/${projectId}/${filename}`);
    if (!bytes) return new Response("Not found", { status: 404 });
    const type = detectLogoType(bytes);
    if (!type || !filename.endsWith(type === "image/jpeg" ? ".jpg" : type === "image/png" ? ".png" : ".webp")) {
      return new Response("Not found", { status: 404 });
    }
    return new NextResponse(Buffer.from(bytes), {
      headers: { "Content-Type": type, "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" },
    });
  } catch {
    return new Response("Logo temporarily unavailable", { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
