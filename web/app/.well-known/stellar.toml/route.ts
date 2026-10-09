import { createHash } from "node:crypto";

import {
  renderSharedTestnetToml,
  type MetadataPublicationState,
} from "../../lib/projects/metadata-publication";
import { SHARED_ASSET_DOMAIN } from "../../lib/product/constants";
import { getDatabaseClient } from "../../lib/server/persistence/database";
import { PostgresMetadataPublicationRepository } from "../../lib/server/persistence/metadata-publication-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface SharedTomlRouteDependencies {
  listPublications(): Promise<MetadataPublicationState[]>;
}

export async function GET() {
  const repository = new PostgresMetadataPublicationRepository(
    getDatabaseClient(),
  );

  return handleSharedTomlRequest({
    listPublications: () => repository.listSharedTestnetPublications(),
  });
}

export async function handleSharedTomlRequest(
  dependencies: SharedTomlRouteDependencies,
) {
  const publications = await dependencies.listPublications();
  const content = renderSharedTestnetToml(publications);
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
