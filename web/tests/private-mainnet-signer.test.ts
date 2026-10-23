import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { Keypair, Networks, Transaction, TransactionBuilder } from "@stellar/stellar-sdk";

import {
  MAINNET_SHARED_ISSUER_PUBLIC_KEY,
  buildMainnetIssuance,
} from "../lib/stellar/mainnet-creation";
import { PrivateMainnetSignerClient } from "../lib/stellar/private-mainnet-signer";
import {
  createPrivateMainnetSignerRuntime,
  handlePrivateMainnetSignerRequest,
  validateMainnetSignerEnvelope,
} from "../signer-service/private-mainnet-signer";

const owner = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 41)).publicKey();

function transaction() {
  return buildMainnetIssuance({
    issuerSequence: "70",
    destinationPublicKey: owner,
    assetCode: "ACME",
    amount: "25",
    feeStroops: "100",
    maxFeeStroops: "1000",
    ledgerClosedAt: "2026-10-23T10:00:00Z",
  });
}

test("signer policy accepts only the exact unsigned one-payment Mainnet envelope", () => {
  const built = transaction();
  const inspected = validateMainnetSignerEnvelope({
    unsignedEnvelopeXdr: built.unsignedXdr,
    transactionHash: built.transactionHash,
    issuerPublicKey: MAINNET_SHARED_ISSUER_PUBLIC_KEY,
    destinationPublicKey: owner,
    assetCode: "ACME",
    amount: "25",
    maxFeeStroops: "1000",
  });
  assert.equal(inspected.transactionHash, built.transactionHash);

  const parsed = TransactionBuilder.fromXDR(built.unsignedXdr, Networks.PUBLIC);
  assert.ok(parsed instanceof Transaction);
  parsed.sign(Keypair.random());
  assert.throws(
    () => validateMainnetSignerEnvelope({
      unsignedEnvelopeXdr: parsed.toXDR(),
      transactionHash: built.transactionHash,
      issuerPublicKey: MAINNET_SHARED_ISSUER_PUBLIC_KEY,
      destinationPublicKey: owner,
      assetCode: "ACME",
      amount: "25",
      maxFeeStroops: "1000",
    }),
    /pre_signed_envelope/,
  );
});

test("authenticated signer request delegates one exact transaction and exposes no secret", async () => {
  const built = transaction();
  let calls = 0;
  const response = await handlePrivateMainnetSignerRequest(
    new Request("https://mainnet-signer.internal/sign-and-submit", {
      method: "POST",
      headers: { authorization: "Bearer signer-token", "content-type": "application/json" },
      body: JSON.stringify({
        unsignedEnvelopeXdr: built.unsignedXdr,
        transactionHash: built.transactionHash,
        issuerPublicKey: MAINNET_SHARED_ISSUER_PUBLIC_KEY,
        destinationPublicKey: owner,
        assetCode: "ACME",
        amount: "25",
        maxFeeStroops: "1000",
      }),
    }),
    {
      authToken: "signer-token",
      issuerPublicKey: MAINNET_SHARED_ISSUER_PUBLIC_KEY,
      signerPublicKey: MAINNET_SHARED_ISSUER_PUBLIC_KEY,
      signingEnabled: true,
      maxFeeStroops: "1000",
      async signAndSubmit(input) {
        calls += 1;
        assert.equal(input.transactionHash, built.transactionHash);
        return {
          transactionHash: built.transactionHash,
          signedEnvelopeXdrSha256: createHash("sha256").update("signed").digest("hex"),
        };
      },
    },
  );
  assert.equal(response.status, 200);
  assert.equal(calls, 1);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(JSON.stringify(body).includes("signer-token"), false);
});

test("private signer owns the fee ceiling and rejects a web-supplied override", async () => {
  const built = transaction();
  let calls = 0;
  const response = await handlePrivateMainnetSignerRequest(
    new Request("http://mainnet-signer.railway.internal:8080/v1/sign-and-submit", {
      method: "POST",
      headers: { authorization: "Bearer signer-token", "content-type": "application/json" },
      body: JSON.stringify({
        unsignedEnvelopeXdr: built.unsignedXdr,
        transactionHash: built.transactionHash,
        issuerPublicKey: MAINNET_SHARED_ISSUER_PUBLIC_KEY,
        destinationPublicKey: owner,
        assetCode: "ACME",
        amount: "25",
        maxFeeStroops: "1001",
      }),
    }),
    {
      authToken: "signer-token",
      issuerPublicKey: MAINNET_SHARED_ISSUER_PUBLIC_KEY,
      signerPublicKey: MAINNET_SHARED_ISSUER_PUBLIC_KEY,
      signingEnabled: true,
      maxFeeStroops: "1000",
      async signAndSubmit() {
        calls += 1;
        throw new Error("must_not_sign");
      },
    },
  );
  assert.equal(response.status, 409);
  assert.equal(calls, 0);
});

test("production signer runtime rejects a seed that is not the pinned issuer", () => {
  assert.throws(
    () => createPrivateMainnetSignerRuntime({
      ORRYLO_MAINNET_SIGNER_ENABLED: "true",
      ORRYLO_MAINNET_SIGNER_REQUEST_AUTH_SECRET: "a".repeat(32),
      ORRYLO_MAINNET_ISSUER_MAX_FEE_STROOPS: "1000",
      ORRYLO_MAINNET_SHARED_ISSUER_SIGNER_SEED: Keypair.random().secret(),
      ORRYLO_MAINNET_SHARED_ISSUER_PUBLIC_KEY:
        MAINNET_SHARED_ISSUER_PUBLIC_KEY,
    }),
    /signer_identity_mismatch/,
  );
});

test("production signer remains ready but signing-disabled without activation", () => {
  const runtime = createPrivateMainnetSignerRuntime({
    ORRYLO_MAINNET_SIGNER_REQUEST_AUTH_SECRET: "a".repeat(32),
    ORRYLO_MAINNET_SHARED_ISSUER_PUBLIC_KEY: MAINNET_SHARED_ISSUER_PUBLIC_KEY,
  });
  assert.equal(runtime.signingEnabled, false);
});

test("web client accepts only the private Railway signer and exact response identity", async () => {
  assert.throws(
    () => new PrivateMainnetSignerClient({
      privateBaseUrl: "https://signer.example.com",
      requestAuthSecret: "a".repeat(32),
    }),
    /invalid_configuration/,
  );
  const built = transaction();
  let calls = 0;
  const client = new PrivateMainnetSignerClient(
    {
      privateBaseUrl: "http://mainnet-signer.railway.internal:8080",
      requestAuthSecret: "a".repeat(32),
    },
    async (_input, init) => {
      calls += 1;
      assert.equal(init?.headers && (init.headers as Record<string, string>).authorization, `Bearer ${"a".repeat(32)}`);
      return Response.json({
        ok: true,
        transactionHash: built.transactionHash,
        signedEnvelopeXdrSha256: createHash("sha256").update("signed").digest("hex"),
      });
    },
  );
  const result = await client.signAndSubmit({
    unsignedEnvelopeXdr: built.unsignedXdr,
    transactionHash: built.transactionHash,
    issuerPublicKey: MAINNET_SHARED_ISSUER_PUBLIC_KEY,
    destinationPublicKey: owner,
    assetCode: "ACME",
    amount: "25",
    maxFeeStroops: "1000",
  });
  assert.equal(result.transactionHash, built.transactionHash);
  assert.equal(calls, 1);
});

test("web client verifies exact private signer readiness before an issuance claim", async () => {
  const client = new PrivateMainnetSignerClient(
    {
      privateBaseUrl: "http://mainnet-signer.railway.internal:8080",
      requestAuthSecret: "a".repeat(32),
    },
    async (input) => {
      assert.equal(String(input), "http://mainnet-signer.railway.internal:8080/healthz");
      return Response.json({
        ok: true,
        ready: true,
        service: "orrylo-mainnet-signer",
        network: "public",
        issuerPublicKey: MAINNET_SHARED_ISSUER_PUBLIC_KEY,
        signerPublicKey: MAINNET_SHARED_ISSUER_PUBLIC_KEY,
        signingEnabled: true,
      });
    },
  );
  await client.checkReady();
});
