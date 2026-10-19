import assert from "node:assert/strict";
import test from "node:test";
import { Keypair } from "@stellar/stellar-sdk";
import { checkPrivateSignerReadiness } from "../lib/server/projects/private-signer-readiness";

const issuer = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 221)).publicKey();
const env = {
  NODE_ENV: "test" as const,
  NEXT_PUBLIC_STELLAR_NETWORK: "testnet",
  ORRYLO_APPROVED_TESTNET_SHARED_ISSUER_PUBLIC_KEY: issuer,
  ORRYLO_TESTNET_SHARED_ISSUER_SIGNER_PUBLIC_KEY: issuer,
  ORRYLO_TESTNET_SIGNER_PRIVATE_URL: "http://signer.railway.internal:8080",
  ORRYLO_TESTNET_SIGNER_REQUEST_AUTH_SECRET:
    "synthetic-not-a-real-credential-".repeat(2),
};

test("startup diagnostic returns only bounded status and never discloses a thrown credential", async () => {
  const result = await checkPrivateSignerReadiness(env, (async () => {
    throw new Error(env.ORRYLO_TESTNET_SIGNER_REQUEST_AUTH_SECRET);
  }) as typeof fetch);
  assert.deepEqual(result, { ok: false, code: "signer_unavailable" });
});

test("startup diagnostic proves identity and auth using only health and empty input", async () => {
  let calls = 0;
  const result = await checkPrivateSignerReadiness(env, (async (_url, init) => {
    calls++;
    if (init?.method === "GET")
      return Response.json({
        ok: true,
        ready: true,
        service: "orrylo-private-testnet-signer",
        network: "testnet",
        issuerPublicKey: issuer,
        signerPublicKey: issuer,
      });
    assert.equal(init?.body, "{}");
    return Response.json(
      { ok: false, code: "invalid_request" },
      { status: 400 },
    );
  }) as typeof fetch);
  assert.deepEqual(result, { ok: true, code: "signer_ready" });
  assert.equal(calls, 2);
});

test("startup diagnostic never contacts a signer outside Testnet", async () => {
  const result = await checkPrivateSignerReadiness(
    { ...env, NEXT_PUBLIC_STELLAR_NETWORK: "public" },
    (async () => {
      assert.fail("must not contact signer");
    }) as typeof fetch,
  );
  assert.deepEqual(result, { ok: false, code: "invalid_configuration" });
});

test("startup diagnostic identifies the mismatched public identity field without exposing values", async () => {
  const result = await checkPrivateSignerReadiness(env, (async () =>
    Response.json({
      ok: true,
      ready: true,
      service: "orrylo-private-testnet-signer",
      network: "testnet",
      issuerPublicKey: Keypair.random().publicKey(),
      signerPublicKey: issuer,
    })) as typeof fetch);

  assert.deepEqual(result, {
    ok: false,
    code: "signer_identity_mismatch",
    mismatchField: "issuer_public_key",
  });
});
