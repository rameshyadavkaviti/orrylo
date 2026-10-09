import assert from "node:assert/strict";
import test from "node:test";

import { Keypair } from "@stellar/stellar-sdk/base";

import { buildMetadataReadiness } from "../lib/projects/metadata-readiness";
import type { ManagedProjectProfile } from "../lib/projects/project-profile";

const ISSUER = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 62)).publicKey();

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

test("readiness marks missing issuer while keeping generated/published/reachable separate", () => {
  const readiness = buildMetadataReadiness(BASE);
  const byKey = Object.fromEntries(
    readiness.items.map((item) => [item.key, item]),
  );

  assert.equal(readiness.metadataConfigured, true);
  assert.equal(readiness.publicationReady, false);
  assert.deepEqual(readiness.blockers, ["issuer_linkage"]);
  assert.equal(readiness.toml.generatable, true);
  assert.equal(readiness.toml.generated, true);
  assert.equal(readiness.toml.published, false);
  assert.equal(readiness.toml.reachable, false);
  assert.equal(byKey.issuer_linkage?.value, "Not linked");
  assert.equal(byKey.toml_generated?.value, "Generated locally");
  assert.equal(byKey.toml_published?.value, "No");
  assert.equal(byKey.toml_reachable?.value, "No");
  assert.equal(byKey.explorer_visibility?.state, "unverified");
});

test("landing-page publication remains separate from TOML publication", () => {
  const readiness = buildMetadataReadiness({
    ...BASE,
    publicStatus: "published",
    issuerPublicKey: ISSUER,
    logoUrl: "https://cdn.example.com/nova.png",
  });
  const byKey = Object.fromEntries(
    readiness.items.map((item) => [item.key, item]),
  );

  assert.equal(readiness.publicationReady, true);
  assert.equal(readiness.publicLanding.published, true);
  assert.equal(readiness.publicLanding.path, "/p/nova");
  assert.equal(byKey.public_landing?.value, "Published");
  assert.equal(readiness.toml.generated, true);
  assert.equal(readiness.toml.published, false);
  assert.equal(readiness.toml.reachable, false);
  assert.equal(readiness.explorerVisibility.verified, false);
  assert.equal(readiness.sacVisibility.verified, false);
});

test("Shared Issuer readiness requires the canonical metadata host context", () => {
  const readiness = buildMetadataReadiness({
    ...BASE,
    issuerPublicKey: ISSUER,
    metadataHome: "wrong.example.com",
  });

  assert.equal(readiness.metadataConfigured, false);
  assert.equal(readiness.publicationReady, false);
  assert.ok(readiness.blockers.includes("metadata_home"));
});
