import assert from "node:assert/strict";
import test from "node:test";

import { Keypair } from "@stellar/stellar-sdk/base";

import type { ProjectProfile } from "../lib/projects/project-profile";
import { generateProjectCurrencyToml } from "../lib/projects/stellar-toml";

const ISSUER = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 61)).publicKey();

function project(overrides: Partial<ProjectProfile> = {}): ProjectProfile {
  return {
    projectId: "c4a9fbd2-31b1-4bbd-b0cb-e7f0a6a9b610",
    slug: "nova",
    assetCode: "NOVA",
    displayName: "Nova",
    description: "A managed Stellar project.",
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
    ...overrides,
  };
}

test("stellar.toml preview is deterministic and omits unknown issuer and image", () => {
  const generated = generateProjectCurrencyToml(project());

  assert.ok(generated);
  assert.equal(
    generated.content,
    [
      "[[CURRENCIES]]",
      'code = "NOVA"',
      'name = "Nova"',
      'desc = "A managed Stellar project."',
      "",
    ].join("\n"),
  );
  assert.equal(generated.issuerIncluded, false);
  assert.equal(generated.imageIncluded, false);
});

test("stellar.toml includes a real issuer and durable HTTPS image when present", () => {
  const generated = generateProjectCurrencyToml(
    project({
      issuerPublicKey: ISSUER,
      logoUrl: "https://cdn.example.com/nova.png",
    }),
  );

  assert.ok(generated);
  assert.match(generated.content, new RegExp(`issuer = "${ISSUER}"`));
  assert.match(
    generated.content,
    /image = "https:\/\/cdn\.example\.com\/nova\.png"/,
  );
  assert.equal(generated.issuerIncluded, true);
  assert.equal(generated.imageIncluded, true);
});

test("stellar.toml never includes data or blob image URLs", () => {
  for (const logoUrl of [
    "data:image/png;base64,AAAA",
    "blob:https://orrylo.com/logo",
  ]) {
    const generated = generateProjectCurrencyToml(project({ logoUrl }));

    assert.ok(generated);
    assert.doesNotMatch(generated.content, /image =/);
    assert.equal(generated.imageIncluded, false);
  }
});

test("stellar.toml escapes project-controlled structure-breaking text", () => {
  const generated = generateProjectCurrencyToml(
    project({
      issuerPublicKey: ISSUER,
      displayName: 'Nova "Quoted" \\ Name',
      description:
        'line one\n[[CURRENCIES]]\r\ncode = "EVIL"\ttab\\backslash',
    }),
  );

  assert.ok(generated);
  assert.equal(
    generated.content
      .split("\n")
      .filter((line) => line === "[[CURRENCIES]]").length,
    1,
  );
  assert.doesNotMatch(generated.content, /\ncode = "EVIL"\n/);
  assert.match(generated.content, /\\n\[\[CURRENCIES\]\]\\r\\ncode/);
  assert.match(generated.content, /\\t/);
  assert.match(generated.content, /\\\\backslash/);
});

test("stellar.toml Unicode string serialization is NFC deterministic", () => {
  const decomposed = generateProjectCurrencyToml(
    project({
      displayName: "Cafe\u0301",
      description: "Re\u0301seau",
    }),
  );
  const composed = generateProjectCurrencyToml(
    project({
      displayName: "Café",
      description: "Réseau",
    }),
  );

  assert.ok(decomposed);
  assert.ok(composed);
  assert.equal(decomposed.content, composed.content);
});
