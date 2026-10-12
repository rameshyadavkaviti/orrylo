import assert from "node:assert/strict";
import test from "node:test";

import {
  SHARED_METADATA_TOML_ENDPOINT,
  type MetadataPublicationState,
} from "../lib/projects/metadata-publication";
import { FixedSharedMetadataVerifier } from "../lib/server/projects/metadata-publication-verifier";

const PUBLICATION: Pick<
  MetadataPublicationState,
  "assetCode" | "issuerPublicKey" | "currencyToml" | "contentHash"
> = {
  assetCode: "NOVA",
  issuerPublicKey: "GA6HCMBLTZS5VQ3FPJ4SCA5PXI4D54ZZG6EXOWZOCN2H7P7PVOQC7F3Y",
  currencyToml:
    '[[CURRENCIES]]\ncode = "NOVA"\nissuer = "GA6HCMBLTZS5VQ3FPJ4SCA5PXI4D54ZZG6EXOWZOCN2H7P7PVOQC7F3Y"\nname = "Nova"\n',
  contentHash: "a".repeat(64),
};

test("shared metadata verifier uses only the fixed canonical HTTPS endpoint", async () => {
  let observedUrl = "";
  let observedRedirect: RequestRedirect | undefined;
  const verifier = new FixedSharedMetadataVerifier(async (input, init) => {
    observedUrl = input.toString();
    observedRedirect = init?.redirect;

    return new Response(PUBLICATION.currencyToml, {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }, 1_000);

  assert.deepEqual(await verifier.verify(PUBLICATION), { ok: true });
  assert.match(observedUrl, new RegExp(`^${SHARED_METADATA_TOML_ENDPOINT}`));
  assert.match(observedUrl, /\?v=a{64}$/);
  assert.equal(observedRedirect, "error");
});

test("verification rejects stale or mismatched published content", async () => {
  const verifier = new FixedSharedMetadataVerifier(async () => {
    return new Response(
      '[[CURRENCIES]]\ncode = "NOVA"\nissuer = "GA6HCMBLTZS5VQ3FPJ4SCA5PXI4D54ZZG6EXOWZOCN2H7P7PVOQC7F3Y"\nname = "Old Nova"\n',
      {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      },
    );
  });

  assert.deepEqual(await verifier.verify(PUBLICATION), {
    ok: false,
    code: "content_mismatch",
  });
});

test("verification rejects non-success and wrong content type responses", async () => {
  const notFound = new FixedSharedMetadataVerifier(async () => {
    return new Response("missing", { status: 404 });
  });
  assert.deepEqual(await notFound.verify(PUBLICATION), {
    ok: false,
    code: "unexpected_status",
  });

  const html = new FixedSharedMetadataVerifier(async () => {
    return new Response(PUBLICATION.currencyToml, {
      status: 200,
      headers: { "Content-Type": "text/html" },
    });
  });
  assert.deepEqual(await html.verify(PUBLICATION), {
    ok: false,
    code: "unexpected_content_type",
  });
});
