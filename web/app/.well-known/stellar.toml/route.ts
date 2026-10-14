import { createHash } from "node:crypto";

import {
  renderSharedTestnetToml,
  type MetadataPublicationState,
} from "../../../lib/projects/metadata-publication";
import { SHARED_ASSET_DOMAIN } from "../../../lib/product/constants";
import {
  RYLO_TESTNET_HOME_DOMAIN,
  renderRyloTestnetToml,
} from "../../../lib/rylo/testnet-metadata";
import { getDatabaseClient } from "../../../lib/server/persistence/database";
import { PostgresMetadataPublicationRepository } from "../../../lib/server/persistence/metadata-publication-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface SharedTomlRouteDependencies {
  listPublications(): Promise<MetadataPublicationState[]>;
}

export async function GET(request: Request) {
  return handleStellarTomlRequest(request, {
    listPublications: () =>
      new PostgresMetadataPublicationRepository(
        getDatabaseClient(),
      ).listSharedTestnetPublications(),
  });
}

export async function handleStellarTomlRequest(
  request: Request,
  dependencies: SharedTomlRouteDependencies,
) {
  const host = new URL(request.url).hostname.toLowerCase();

  if (host === RYLO_TESTNET_HOME_DOMAIN) {
    return tomlResponse(renderRyloTestnetToml(), RYLO_TESTNET_HOME_DOMAIN);
  }

  if (host === SHARED_ASSET_DOMAIN) {
    return handleSharedTomlRequest(dependencies);
  }

  return new Response("Not found\n", {
    status: 404,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function handleSharedTomlRequest(
  dependencies: SharedTomlRouteDependencies,
) {
  const publications = await dependencies.listPublications();
  return tomlResponse(
    renderSharedTestnetToml(publications),
    SHARED_ASSET_DOMAIN,
  );
}

function tomlResponse(content: string, metadataHome: string) {
  const etag = createHash("sha256").update(content, "utf8").digest("hex");

  return new Response(content, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      "X-Content-Type-Options": "nosniff",
      ETag: `"${etag}"`,
      "X-Orrylo-Metadata-Home": metadataHome,
    },
  });
}
