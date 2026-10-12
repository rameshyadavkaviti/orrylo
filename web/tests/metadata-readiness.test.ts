import assert from "node:assert/strict";
import test from "node:test";

import { Keypair } from "@stellar/stellar-sdk/base";

import type { MetadataPublicationState } from "../lib/projects/metadata-publication";
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
  assert.equal(byKey.toml_generated?.value, "Yes");
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

test("optional description and image are reported without becoming invented publication blockers", () => {
  const readiness = buildMetadataReadiness({
    ...BASE,
    description: null,
    logoUrl: null,
    issuerPublicKey: ISSUER,
  });

  assert.equal(readiness.metadataConfigured, true);
  assert.equal(readiness.publicationReady, true);
  assert.equal(readiness.blockers.includes("description"), false);
  assert.equal(readiness.blockers.includes("image_reference"), false);

  const byKey = Object.fromEntries(
    readiness.items.map((item) => [item.key, item]),
  );
  assert.equal(byKey.description?.value, "Missing");
  assert.equal(byKey.image_reference?.value, "Missing");
});

const PUBLISHED: MetadataPublicationState = {
  projectId: BASE.projectId,
  metadataHome: "assets.orrylo.com",
  network: "testnet",
  assetCode: "NOVA",
  issuerPublicKey: ISSUER,
  currencyToml:
    '[[CURRENCIES]]\ncode = "NOVA"\nissuer = "' +
    ISSUER +
    '"\nname = "Nova"\ndesc = "A Stellar project managed by Orrylo."\n',
  contentHash: "a".repeat(64),
  revision: 1,
  publishedAt: "2026-10-09T11:00:00.000Z",
  updatedAt: "2026-10-09T11:00:01.000Z",
  reachable: true,
  verifiedAt: "2026-10-09T11:00:01.000Z",
  lastVerificationAt: "2026-10-09T11:00:01.000Z",
  verificationErrorCode: null,
};

test("readiness reflects real published and verified metadata evidence", () => {
  const project = { ...BASE, issuerPublicKey: ISSUER };
  const readiness = buildMetadataReadiness(project, PUBLISHED);

  assert.equal(readiness.toml.published, true);
  assert.equal(readiness.toml.reachable, true);
  assert.equal(readiness.toml.verifiedAt, PUBLISHED.verifiedAt);
  assert.equal(readiness.toml.publishedContentCurrent, true);
  assert.equal(readiness.explorerVisibility.verified, false);

  const byKey = Object.fromEntries(
    readiness.items.map((item) => [item.key, item]),
  );
  assert.equal(byKey.toml_published?.value, "Yes");
  assert.equal(byKey.toml_reachable?.value, "Yes");
  assert.equal(byKey.stellar_asset?.value, "Not created");
});

test("readiness keeps an older reachable publication truthful after Project Profile edits", () => {
  const project = {
    ...BASE,
    issuerPublicKey: ISSUER,
    displayName: "Nova Updated",
  };
  const readiness = buildMetadataReadiness(project, PUBLISHED);

  assert.equal(readiness.toml.published, true);
  assert.equal(readiness.toml.reachable, true);
  assert.equal(readiness.toml.publishedContentCurrent, false);

  const published = readiness.items.find(
    (item) => item.key === "toml_published",
  );
  assert.equal(published?.value, "Yes · update available");
});

test("Dedicated Issuer and Mainnet projects are explicit publication blockers", () => {
  const dedicated = buildMetadataReadiness({
    ...BASE,
    issuerModel: "dedicated",
    metadataHome: null,
    issuerPublicKey: ISSUER,
  });
  assert.equal(dedicated.publicationReady, false);
  assert.ok(dedicated.blockers.includes("issuer_model"));

  const mainnet = buildMetadataReadiness({
    ...BASE,
    network: "public",
    issuerPublicKey: ISSUER,
  });
  assert.equal(mainnet.publicationReady, false);
  assert.ok(mainnet.blockers.includes("network"));
});
