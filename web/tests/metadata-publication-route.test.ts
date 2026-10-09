import assert from "node:assert/strict";
import test from "node:test";

import { handleSharedTomlRequest } from "../app/.well-known/stellar.toml/route";
import type { MetadataPublicationState } from "../lib/projects/metadata-publication";

function publication(
  overrides: Partial<MetadataPublicationState> & {
    projectId: string;
    assetCode: string;
    currencyToml: string;
  },
): MetadataPublicationState {
  return {
    projectId: overrides.projectId,
    metadataHome: "assets.orrylo.com",
    network: "testnet",
    assetCode: overrides.assetCode,
    issuerPublicKey:
      overrides.issuerPublicKey ??
      "GA6HCMBLTZS5VQ3FPJ4SCA5PXI4D54ZZG6EXOWZOCN2H7P7PVOQC7F3Y",
    currencyToml: overrides.currencyToml,
    contentHash: overrides.contentHash ?? "a".repeat(64),
    revision: overrides.revision ?? 1,
    publishedAt: overrides.publishedAt ?? "2026-10-09T10:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-10-09T10:00:00.000Z",
    reachable: overrides.reachable ?? false,
    verifiedAt: overrides.verifiedAt ?? null,
    lastVerificationAt: overrides.lastVerificationAt ?? null,
    verificationErrorCode: overrides.verificationErrorCode ?? null,
    ...overrides,
  };
}

test("public shared TOML route aggregates only canonical Testnet publications deterministically", async () => {
  const alpha = publication({
    projectId: "00000000-0000-4000-8000-000000000001",
    assetCode: "ALPHA",
    currencyToml: '[[CURRENCIES]]\ncode = "ALPHA"\nname = "Alpha"\n',
  });
  const nova = publication({
    projectId: "00000000-0000-4000-8000-000000000002",
    assetCode: "NOVA",
    currencyToml: '[[CURRENCIES]]\ncode = "NOVA"\nname = "Nova"\n',
  });
  const wrongHost = publication({
    projectId: "00000000-0000-4000-8000-000000000003",
    assetCode: "WRONG",
    metadataHome: "other.example.com",
    currencyToml: '[[CURRENCIES]]\ncode = "WRONG"\nname = "Wrong"\n',
  });
  const mainnet = publication({
    projectId: "00000000-0000-4000-8000-000000000004",
    assetCode: "MAIN",
    network: "public",
    currencyToml: '[[CURRENCIES]]\ncode = "MAIN"\nname = "Main"\n',
  });

  const response = await handleSharedTomlRequest({
    listPublications: async () => [nova, wrongHost, mainnet, alpha],
  });
  const body = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/plain/);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  assert.equal(response.headers.get("x-orrylo-metadata-home"), "assets.orrylo.com");
  assert.equal(
    body,
    `${alpha.currencyToml}\n${nova.currencyToml}`,
  );
  assert.doesNotMatch(body, /WRONG|MAIN/);
});
