import assert from "node:assert/strict";
import test from "node:test";
import { Keypair } from "@stellar/stellar-sdk";

import {
  createPrivateMainnetSignerRuntime,
  handlePrivateMainnetSignerRequest,
  readPrivateMainnetSignerRuntime,
} from "../signer-service/private-mainnet-signer";

const key = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 172));
const issuer = key.publicKey();
const auth = "test-auth-secret-".repeat(4);

test("mainnet signer readiness proves key identity without issuing a signature", async () => {
  const runtime = createPrivateMainnetSignerRuntime({ issuerPublicKey: issuer, signer: key, requestAuthSecret: auth });
  const result = await handlePrivateMainnetSignerRequest({method: "GET", path: "/healthz", authorization: null, readBody: async () => { throw Error("must not read body"); }}, runtime);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, {ok: true, ready: true, service: "orrylo-private-mainnet-signer", network: "public", issuerPublicKey: issuer, signerPublicKey: issuer, signingEnabled: false});
});

test("mainnet signing endpoint is fail-closed, even with correct auth", async () => {
  const runtime = createPrivateMainnetSignerRuntime({ issuerPublicKey: issuer, signer: key, requestAuthSecret: auth });
  let reads = 0;
  for (const authorization of [null, "Bearer wrong", `Bearer ${auth}`]) {
    const result = await handlePrivateMainnetSignerRequest({method: "POST", path: "/v1/sign", authorization, readBody: async () => {reads++; return "{}";}}, runtime);
    assert.equal(result.status, authorization === `Bearer ${auth}` ? 503 : 401);
    assert.equal(result.body.ok, false);
  }
  assert.equal(reads, 0);
});

test("mainnet runtime rejects missing, malformed, weak and mismatched key configuration", () => {
  assert.throws(() => createPrivateMainnetSignerRuntime({issuerPublicKey: Keypair.random().publicKey(), signer: key, requestAuthSecret: auth}), /signer_key_mismatch/);
  assert.throws(() => createPrivateMainnetSignerRuntime({issuerPublicKey: issuer, signer: key, requestAuthSecret: "weak"}), /missing_configuration/);
  assert.throws(() => readPrivateMainnetSignerRuntime({NODE_ENV: "test", ORRYLO_MAINNET_SHARED_ISSUER_PUBLIC_KEY: issuer, ORRYLO_MAINNET_SHARED_ISSUER_SIGNER_SEED: "invalid", ORRYLO_MAINNET_SIGNER_REQUEST_AUTH_SECRET: auth}), /missing_configuration/);
});

test("different issuer and signer keys require an explicitly pinned signer public key", () => {
  const otherIssuer = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 173)).publicKey();
  assert.throws(() => createPrivateMainnetSignerRuntime({issuerPublicKey: otherIssuer, signer: key, requestAuthSecret: auth}), /signer_key_mismatch/);
  const runtime = createPrivateMainnetSignerRuntime({issuerPublicKey: otherIssuer, signerPublicKey: issuer, signer: key, requestAuthSecret: auth});
  assert.equal(runtime.issuerPublicKey, otherIssuer);
  assert.equal(runtime.signerPublicKey, issuer);
});
