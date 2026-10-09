import assert from "node:assert/strict";
import test from "node:test";

import { buildMetadataReadiness } from "../lib/projects/metadata-readiness";
import type { ManagedProjectProfile } from "../lib/projects/project-profile";

const BASE: ManagedProjectProfile = {
  projectId: "c4a9fbd2-31b1-4bbd-b0cb-e7f0a6a9b610",
  slug: "nova",
  assetCode: "NOVA",
  displayName: "Nova",
  description: "A Stellar project managed by Orrylo.",
  category: null,
  logoUrl: null,
  websiteUrl: null,
  communityUrl: null,
  metadataHome: "assets.orrylo.com",
  issuerModel: "shared",
  network: "testnet",
  issuerPublicKey: null,
  explorerUrl: null,
  publicStatus: "draft",
  createdAt: "2026-10-09T00:00:00.000Z",
  updatedAt: "2026-10-09T00:00:00.000Z",
  ownerPublicKey: "GA6HCMBLTZS5VQ3FPJ4SCA5PXI4D54ZZG6EXOWZOCN2H7P7PVOQC7F3Y",
};

test("metadata readiness is truthful for a newly managed project", () => {
  const items = buildMetadataReadiness(BASE);
  const byKey = Object.fromEntries(items.map((item) => [item.key, item]));

  assert.equal(byKey.project_profile?.value, "Ready");
  assert.equal(byKey.public_landing?.value, "Private draft");
  assert.equal(byKey.metadata_host?.value, "assets.orrylo.com");
  assert.equal(byKey.toml_publication?.value, "Not published");
  assert.equal(byKey.project_image?.value, "Not hosted");
  assert.equal(byKey.issuer_linkage?.value, "Not linked");
  assert.equal(byKey.explorer_visibility?.value, "Unverified");
});

test("landing publication does not imply TOML or explorer verification", () => {
  const items = buildMetadataReadiness({
    ...BASE,
    publicStatus: "published",
    issuerPublicKey: "GB5V6M5EQGDWVDH66ZX6GF2NOJADUDU6ZWKEZJCZZNXUBSYLBHZIM2F3",
    explorerUrl: "https://stellar.expert/example",
  });
  const byKey = Object.fromEntries(items.map((item) => [item.key, item]));

  assert.equal(byKey.public_landing?.value, "Published");
  assert.equal(byKey.issuer_linkage?.value, "Issuer recorded");
  assert.equal(byKey.toml_publication?.value, "Not published");
  assert.equal(byKey.explorer_visibility?.value, "Unverified");
});