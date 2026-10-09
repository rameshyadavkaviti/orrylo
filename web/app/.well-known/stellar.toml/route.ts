import { createHash } from "node:crypto";

import { SHARED_ASSET_DOMAIN } from "../../lib/product/constants";
import { getDatabaseClient } from "../../lib/server/persistence/database";
import { PostgresMetadataPublicationRepository } from "../../lib/server/persistence/metadata-publication-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const repository = new PostgresMetadataPublicationRepository(
    getDatabaseClient(),
  );
  const publications = await repository.listSharedTestnetPublications();
  const content = publications.map((item) => item.currencyToml).join("\n");
  const etag = createHash("sha256").update(content, "utf8").digest("hex");

  return new Response(content, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      "X-Content-Type-Options": "nosniff",
      ETag: `"${etag}"`,
      "X-Orrylo-Metadata-Home": SHARED_ASSET_DOMAIN,
    },
  });
}
