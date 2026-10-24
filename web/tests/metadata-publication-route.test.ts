import assert from "node:assert/strict";
import test from "node:test";

import {
  handleSharedTomlRequest,
  handleStellarTomlRequest,
} from "../app/.well-known/stellar.toml/route";
import type { MetadataPublicationState } from "../lib/projects/metadata-publication";
import {
  RYLO_ABANDONED_TESTNET_ISSUER,
  RYLO_ISSUER_CANDIDATE,
  RYLO_TESTNET_ISSUER,
} from "../lib/product/constants";
import {
  ORRYLO_METADATA_LOGO_URL,
  RYLO_MAINNET_IMAGE_URL,
  RYLO_MAINNET_NETWORK_PASSPHRASE,
} from "../lib/rylo/testnet-metadata";

function publication(
  overrides: Partial<MetadataPublicationState> & {
    projectId: string;
    assetCode: string;
    currencyToml: string;
  },
): MetadataPublicationState {
  return {
    ...overrides,
    projectId: overrides.projectId,
    metadataHome: overrides.metadataHome ?? "assets.orrylo.com",
    network: overrides.network ?? "testnet",
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
  };
}

test("public shared TOML route aggregates canonical Testnet and Mainnet publications deterministically", async () => {
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
  assert.equal(
    response.headers.get("x-orrylo-metadata-home"),
    "assets.orrylo.com",
  );
  assert.equal(body, `${alpha.currencyToml}\n${mainnet.currencyToml}\n${nova.currencyToml}`);
  assert.doesNotMatch(body, /WRONG/);
});

test("root-domain TOML publishes only the canonical RYLO Mainnet identity", async () => {
  let sharedReads = 0;
  const response = await handleStellarTomlRequest(
    new Request("https://orrylo.com/.well-known/stellar.toml"),
    {
      listPublications: async () => {
        sharedReads += 1;
        return [
          publication({
            projectId: "00000000-0000-4000-8000-000000000099",
            assetCode: "NOVA",
            currencyToml: '[[CURRENCIES]]\ncode = "NOVA"\nname = "Nova"\n',
          }),
        ];
      },
    },
  );
  const body = await response.text();

  assert.equal(response.status, 200);
  assert.equal(sharedReads, 0);
  assert.match(response.headers.get("content-type") ?? "", /^text\/plain/);
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  assert.equal(response.headers.get("x-orrylo-metadata-home"), "orrylo.com");
  assert.match(
    body,
    new RegExp(`NETWORK_PASSPHRASE = "${RYLO_MAINNET_NETWORK_PASSPHRASE}"`),
  );
  assert.match(body, new RegExp(`ACCOUNTS = \\["${RYLO_TESTNET_ISSUER}"\\]`));
  assert.match(body, new RegExp(`issuer = "${RYLO_TESTNET_ISSUER}"`));
  assert.equal((body.match(/\[\[CURRENCIES\]\]/g) ?? []).length, 1);
  assert.equal((body.match(/code = "RYLO"/g) ?? []).length, 1);
  assert.match(body, /display_decimals = 7/);
  assert.match(body, /is_asset_anchored = false/);
  assert.doesNotMatch(body, /status = "test"/);
  assert.match(body, new RegExp(`ORG_LOGO = "${ORRYLO_METADATA_LOGO_URL}"`));
  assert.match(body, new RegExp(`image = "${RYLO_MAINNET_IMAGE_URL}"`));
  assert.doesNotMatch(body, new RegExp(RYLO_ABANDONED_TESTNET_ISSUER));
  assert.doesNotMatch(body, new RegExp(RYLO_TESTNET_ISSUER));
  assert.doesNotMatch(
    body,
    /CAPB6JBF466Y6TY4UBAQDSN24KTILN2R2CLINBGJSIGS5BTTEEDW3GMI/,
  );
  assert.doesNotMatch(body, /NOVA/);
});

test("root RYLO and Shared Issuer TOML hosts cannot contaminate each other", async () => {
  const alpha = publication({
    projectId: "00000000-0000-4000-8000-000000000021",
    assetCode: "ALPHA",
    currencyToml: '[[CURRENCIES]]\ncode = "ALPHA"\nname = "Alpha"\n',
  });

  const sharedResponse = await handleStellarTomlRequest(
    new Request("https://assets.orrylo.com/.well-known/stellar.toml"),
    { listPublications: async () => [alpha] },
  );
  const sharedBody = await sharedResponse.text();

  assert.equal(sharedResponse.status, 200);
  assert.equal(
    sharedResponse.headers.get("x-orrylo-metadata-home"),
    "assets.orrylo.com",
  );
  assert.equal(sharedBody, alpha.currencyToml);
  assert.doesNotMatch(sharedBody, new RegExp(RYLO_TESTNET_ISSUER));
  assert.doesNotMatch(sharedBody, /ORG_NAME = "Orrylo"/);

  const rootResponse = await handleStellarTomlRequest(
    new Request("https://orrylo.com/.well-known/stellar.toml"),
    {
      listPublications: async () => {
        throw new Error("root RYLO metadata must not read Shared Issuer state");
      },
    },
  );
  const rootBody = await rootResponse.text();

  assert.equal(rootResponse.status, 200);
  assert.match(rootBody, /code = "RYLO"/);
  assert.doesNotMatch(rootBody, /ALPHA/);
});

test("unknown hosts fail closed instead of receiving either metadata namespace", async () => {
  let sharedReads = 0;
  const response = await handleStellarTomlRequest(
    new Request("https://example.com/.well-known/stellar.toml"),
    {
      listPublications: async () => {
        sharedReads += 1;
        return [];
      },
    },
  );

  assert.equal(response.status, 404);
  assert.equal(sharedReads, 0);
});


test("proxy-rewritten URL uses public Host for shared TOML without crossing domains", async () => {
  const sample = publication({
    projectId: "00000000-0000-4000-8000-000000000042",
    assetCode: "PROXY",
    currencyToml: '[[CURRENCIES]]\\ncode = "PROXY"\\n',
  });
  const response = await handleStellarTomlRequest(
    new Request("https://orrylo-production.up.railway.app/.well-known/stellar.toml", {
      headers: { host: "assets.orrylo.com" },
    }),
    { listPublications: async () => [sample] },
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-orrylo-metadata-home"), "assets.orrylo.com");
  assert.equal(await response.text(), sample.currencyToml);

  const unknown = await handleStellarTomlRequest(
    new Request("https://assets.orrylo.com/.well-known/stellar.toml", {
      headers: { host: "untrusted.example" },
    }),
    { listPublications: async () => { throw Error("Unknown host must not query publications"); } },
  );
  assert.equal(unknown.status, 404);
});
