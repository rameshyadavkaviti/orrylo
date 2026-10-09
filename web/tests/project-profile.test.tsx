import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { ManagedProjectView } from "../components/managed-project-view";
import { ProjectLandingPage } from "../components/project-landing-page";
import type { MetadataPublicationState } from "../lib/projects/metadata-publication";
import {
  isValidProjectSlug,
  projectPublicPath,
  type ManagedProjectProfile,
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
  assert.match(html, /Metadata context/);
  assert.match(html, /TOML status/);
  assert.match(html, /Not published/);
});

test("managed project view keeps ownership, routing, metadata, and on-chain state separate", () => {
  const managed: ManagedProjectProfile = {
    ...PROJECT,
    publicStatus: "draft",
    ownerPublicKey: "GA6HCMBLTZS5VQ3FPJ4SCA5PXI4D54ZZG6EXOWZOCN2H7P7PVOQC7F3Y",
  };
  const html = renderToStaticMarkup(<ManagedProjectView project={managed} />);

  assert.match(html, /Managed Project/i);
  assert.match(html, new RegExp(managed.projectId));
  assert.match(html, new RegExp(managed.ownerPublicKey));
  assert.match(html, /\/p\/nova/);
  assert.match(html, /Private draft/i);
  assert.match(html, /TOML publication.*Not published/is);
  assert.match(html, /Stellar asset.*Not created/is);
  assert.match(html, /Publish public landing page/i);
  assert.match(html, /Publication readiness/i);
  assert.match(html, /stellar\.toml/i);
  assert.match(html, /Explorer visibility/i);
  assert.match(html, /Not verified/i);
  assert.match(html, /Project image.*Missing/is);
  assert.match(html, /Issuer linkage.*Not linked/is);
  assert.match(html, /Generated stellar\.toml/i);
  assert.match(html, /Generated: yes.*Published: no.*Reachable: no/is);
  assert.match(html, /Save metadata/i);
  assert.doesNotMatch(html, /asset created successfully/i);
});

test("public landing page does not render unsafe persisted metadata URLs", () => {
  const html = renderToStaticMarkup(
    <ProjectLandingPage
      project={{
        ...PROJECT,
        logoUrl: "data:image/png;base64,AAAA",
        websiteUrl: "javascript:alert(1)",
        communityUrl: "file:///tmp/community",
        explorerUrl: "blob:https://orrylo.com/explorer",
      }}
    />,
  );

  assert.doesNotMatch(html, /javascript:alert/);
  assert.doesNotMatch(html, /data:image/);
  assert.doesNotMatch(html, /file:\/\/\//);
  assert.doesNotMatch(html, /blob:https/);
  assert.match(html, /project-public-logo-fallback/);
});

test("managed and public project views surface verified metadata publication without claiming asset creation", () => {
  const issuer =
    "GA6HCMBLTZS5VQ3FPJ4SCA5PXI4D54ZZG6EXOWZOCN2H7P7PVOQC7F3Y";
  const managed: ManagedProjectProfile = {
    ...PROJECT,
    issuerPublicKey: issuer,
    publicStatus: "draft",
    ownerPublicKey: issuer,
  };
  const publication: MetadataPublicationState = {
    projectId: managed.projectId,
    metadataHome: "assets.orrylo.com",
    network: "testnet",
    assetCode: managed.assetCode,
    issuerPublicKey: issuer,
    currencyToml:
      '[[CURRENCIES]]\ncode = "NOVA"\nissuer = "' +
      issuer +
      '"\nname = "Nova"\ndesc = "A community token for players, builders, and creators."\n',
    contentHash: "a".repeat(64),
    revision: 1,
    publishedAt: "2026-10-09T12:00:00.000Z",
    updatedAt: "2026-10-09T12:00:01.000Z",
    reachable: true,
    verifiedAt: "2026-10-09T12:00:01.000Z",
    lastVerificationAt: "2026-10-09T12:00:01.000Z",
    verificationErrorCode: null,
  };

  const managedHtml = renderToStaticMarkup(
    <ManagedProjectView project={managed} publication={publication} />,
  );
  assert.match(managedHtml, /Metadata verified/i);
  assert.match(managedHtml, /TOML publication.*Published/is);
  assert.match(managedHtml, /TOML reachability.*Verified/is);
  assert.match(managedHtml, /Stellar asset.*Not created/is);
  assert.match(managedHtml, /\/p\/nova/);
  assert.match(managedHtml, /assets\.orrylo\.com\/\.well-known\/stellar\.toml/);

  const publicHtml = renderToStaticMarkup(
    <ProjectLandingPage
      project={{ ...PROJECT, issuerPublicKey: issuer }}
      metadataPublication={publication}
    />,
  );
  assert.match(publicHtml, /Published and reachable/i);
  assert.doesNotMatch(publicHtml, /asset created successfully/i);
});
