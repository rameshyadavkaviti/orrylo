import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { ProjectLandingPage } from "../components/project-landing-page";
import {
  isValidProjectSlug,
  projectPublicPath,
  type ProjectProfile,
} from "../lib/projects/project-profile";

const PROJECT: ProjectProfile = {
  projectId: "c4a9fbd2-31b1-4bbd-b0cb-e7f0a6a9b610",
  slug: "nova",
  assetCode: "NOVA",
  displayName: "Nova",
  description: "A community token for players, builders, and creators.",
  category: "Gaming & community",
  logoUrl: null,
  websiteUrl: "https://example.com",
  communityUrl: "https://example.com/community",
  metadataHome: "assets.orrylo.com",
  issuerModel: "shared",
  network: "testnet",
  issuerPublicKey: null,
  explorerUrl: "https://stellar.expert",
  publicStatus: "published",
  createdAt: "2026-10-09T00:00:00.000Z",
  updatedAt: "2026-10-09T00:00:00.000Z",
};

test("project identity stays separate from the public slug path", () => {
  assert.equal(isValidProjectSlug("nova"), true);
  assert.equal(isValidProjectSlug("nova-token"), true);
  assert.equal(isValidProjectSlug("Nova Token"), false);
  assert.equal(projectPublicPath("nova"), "/p/nova");
  assert.notEqual(PROJECT.projectId, PROJECT.slug);
});

test("free landing template renders from Project Profile data", () => {
  const html = renderToStaticMarkup(<ProjectLandingPage project={PROJECT} />);

  assert.match(html, /Nova/);
  assert.match(html, /NOVA/);
  assert.match(html, /Gaming &amp; community/);
  assert.match(html, /Orrylo Shared Issuer/);
  assert.match(html, /assets\.orrylo\.com/);
  assert.match(html, /\/p\/nova/);
  assert.match(html, /Built on Stellar/);
  assert.match(html, /Metadata publication/);
});
