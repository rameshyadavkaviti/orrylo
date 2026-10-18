import assert from "node:assert/strict";
import test from "node:test";

import {
  Account,
  Asset,
  Keypair,
  Networks,
  Operation,
  Transaction,
  TransactionBuilder,
} from "@stellar/stellar-sdk";

import {
  PrivateRailwaySharedIssuerSigningPrimitive,
  PrivateRailwaySignerPrimitiveError,
} from "../lib/stellar/private-railway-signer";

const ISSUER_KEYPAIR = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 211));
const ISSUER = ISSUER_KEYPAIR.publicKey();
const WRONG_KEYPAIR = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 212));
const DESTINATION = Keypair.fromRawEd25519Seed(
  Buffer.alloc(32, 213),
).publicKey();
const AUTH = "b".repeat(48);
const PRIVATE_URL = "http://orrylo-testnet-signer.railway.internal:8080";

function health() {
  return {
    ok: true,
    ready: true,
    service: "orrylo-private-testnet-signer",
    network: "testnet",
    issuerPublicKey: ISSUER,
    signerPublicKey: WRONG_KEYPAIR.publicKey(),
  };
}

test("readiness checks exact identity and authentication without an envelope", async () => {
  const requests: string[] = [];
  const primitive = new PrivateRailwaySharedIssuerSigningPrimitive(
    {
      privateBaseUrl: PRIVATE_URL,
      requestAuthSecret: AUTH,
      issuerPublicKey: ISSUER,
      signerPublicKey: WRONG_KEYPAIR.publicKey(),
    },
    (async (url, init) => {
      requests.push(String(url));
      assert.equal(init?.redirect, "error");
      assert.ok(init?.signal);
      if (String(url).endsWith("/healthz")) return Response.json(health());
      assert.equal(init?.body, "{}");
      assert.equal(
        new Headers(init?.headers).get("authorization"),
        `Bearer ${AUTH}`,
      );
      return Response.json(
        { ok: false, code: "invalid_request" },
        { status: 400 },
      );
    }) as typeof fetch,
  );
  await primitive.assertReady();
  assert.deepEqual(requests, [
    `${PRIVATE_URL}/healthz`,
    `${PRIVATE_URL}/v1/sign`,
  ]);
});

test("readiness rejects mismatched identity before sending authentication", async () => {
  for (const change of [
    { issuerPublicKey: WRONG_KEYPAIR.publicKey() },
    { signerPublicKey: ISSUER },
    { network: "public" },
    { ready: false },
    { service: "other" },
  ]) {
    let calls = 0;
    const primitive = new PrivateRailwaySharedIssuerSigningPrimitive(
      {
        privateBaseUrl: PRIVATE_URL,
        requestAuthSecret: AUTH,
        issuerPublicKey: ISSUER,
        signerPublicKey: WRONG_KEYPAIR.publicKey(),
      },
      (async () => {
        calls++;
        return Response.json({ ...health(), ...change });
      }) as typeof fetch,
    );
    await assert.rejects(primitive.assertReady(), /signer_identity_mismatch/);
    assert.equal(calls, 1);
  }
});

test("readiness fails closed on auth rejection or unexpected success without retry", async () => {
  for (const status of [401, 200, 503]) {
    let calls = 0;
    const primitive = new PrivateRailwaySharedIssuerSigningPrimitive(
      {
        privateBaseUrl: PRIVATE_URL,
        requestAuthSecret: AUTH,
        issuerPublicKey: ISSUER,
        signerPublicKey: WRONG_KEYPAIR.publicKey(),
      },
      (async () =>
        ++calls === 1
          ? Response.json(health())
          : Response.json(
              { ok: false, code: "unauthorized", secret: "must never escape" },
              { status },
            )) as typeof fetch,
    );
    await assert.rejects(
      primitive.assertReady(),
      status === 401
        ? /^PrivateRailwaySignerPrimitiveError: signer_authentication_failed$/
        : /^PrivateRailwaySignerPrimitiveError: signer_unavailable$/,
    );
    assert.equal(calls, 2);
  }
});

test("adapter verifies the explicitly pinned separate signer without substituting issuer", async () => {
  const unsigned = transaction();
  const input = {
    transactionHash: Buffer.from(unsigned.hash()).toString("hex"),
    unsignedEnvelopeXdr: unsigned.toXDR(),
  };
  for (const key of [WRONG_KEYPAIR, ISSUER_KEYPAIR]) {
    const primitive = new PrivateRailwaySharedIssuerSigningPrimitive(
      {
        privateBaseUrl: PRIVATE_URL,
        requestAuthSecret: AUTH,
        issuerPublicKey: ISSUER,
        signerPublicKey: WRONG_KEYPAIR.publicKey(),
      },
      (async () => signedResponse(key)) as typeof fetch,
    );
    if (key === WRONG_KEYPAIR)
      assert.ok(
        (await primitive.signCanonicalEnvelope(input)).signedEnvelopeXdr,
      );
    else
      await assert.rejects(
        primitive.signCanonicalEnvelope(input),
        /signer_response_mismatch/,
      );
  }
});

function transaction(): Transaction {
  return new TransactionBuilder(new Account(ISSUER, "123"), {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      Operation.payment({
        destination: DESTINATION,
        asset: new Asset("NOVA", ISSUER),
        amount: "25.0000000",
      }),
    )
    .setTimebounds(1_800_000_000, 1_800_000_300)
    .build();
}

function signedResponse(
  signer: Keypair,
  signerPublicKey = signer.publicKey(),
): Response {
  const signed = transaction();
  signed.sign(signer);
  return Response.json({
    ok: true,
    network: "testnet",
    signerPublicKey,
    signedEnvelopeXdr: signed.toXDR(),
  });
}

test("adapter sends exactly one authenticated private request and accepts the approved signature", async () => {
  let calls = 0;
  const unsigned = transaction();
  const hash = Buffer.from(unsigned.hash()).toString("hex");

  const primitive = new PrivateRailwaySharedIssuerSigningPrimitive(
    {
      privateBaseUrl: PRIVATE_URL,
      requestAuthSecret: AUTH,
      issuerPublicKey: ISSUER,
    },
    (async (input, init) => {
      calls += 1;
      assert.equal(String(input), `${PRIVATE_URL}/v1/sign`);
      assert.equal(init?.method, "POST");
      assert.equal(
        new Headers(init?.headers).get("authorization"),
        `Bearer ${AUTH}`,
      );
      assert.deepEqual(JSON.parse(String(init?.body)), {
        transactionHash: hash,
        unsignedEnvelopeXdr: unsigned.toXDR(),
      });
      return signedResponse(ISSUER_KEYPAIR);
    }) as typeof fetch,
  );

  const result = await primitive.signCanonicalEnvelope({
    transactionHash: hash,
    unsignedEnvelopeXdr: unsigned.toXDR(),
  });

  assert.ok(result.signedEnvelopeXdr);
  assert.equal(calls, 1);
});

test("public, TLS, credential-bearing, or portless endpoints are rejected", () => {
  for (const privateBaseUrl of [
    "https://example.com",
    "https://signer.railway.internal:8080",
    "http://railway.internal:8080",
    "http://signer.railway.internal",
    "http://user:pass@signer.railway.internal:8080",
  ]) {
    assert.throws(
      () =>
        new PrivateRailwaySharedIssuerSigningPrimitive({
          privateBaseUrl,
          requestAuthSecret: AUTH,
          issuerPublicKey: ISSUER,
        }),
      (error: unknown) =>
        error instanceof PrivateRailwaySignerPrimitiveError &&
        error.code === "invalid_configuration",
      privateBaseUrl,
    );
  }
});

test("wrong signer public key or signature is rejected", async () => {
  const unsigned = transaction();
  const input = {
    transactionHash: Buffer.from(unsigned.hash()).toString("hex"),
    unsignedEnvelopeXdr: unsigned.toXDR(),
  };

  for (const response of [
    signedResponse(ISSUER_KEYPAIR, WRONG_KEYPAIR.publicKey()),
    signedResponse(WRONG_KEYPAIR, ISSUER),
  ]) {
    const primitive = new PrivateRailwaySharedIssuerSigningPrimitive(
      {
        privateBaseUrl: PRIVATE_URL,
        requestAuthSecret: AUTH,
        issuerPublicKey: ISSUER,
      },
      (async () => response.clone()) as typeof fetch,
    );

    await assert.rejects(
      primitive.signCanonicalEnvelope(input),
      (error: unknown) =>
        error instanceof PrivateRailwaySignerPrimitiveError &&
        error.code === "signer_response_mismatch",
    );
  }
});

test("transport or signer-service failure is sanitized and never retried", async () => {
  let calls = 0;
  const unsigned = transaction();
  const primitive = new PrivateRailwaySharedIssuerSigningPrimitive(
    {
      privateBaseUrl: PRIVATE_URL,
      requestAuthSecret: AUTH,
      issuerPublicKey: ISSUER,
    },
    (async () => {
      calls += 1;
      throw new Error("private transport detail");
    }) as typeof fetch,
  );

  await assert.rejects(
    primitive.signCanonicalEnvelope({
      transactionHash: Buffer.from(unsigned.hash()).toString("hex"),
      unsignedEnvelopeXdr: unsigned.toXDR(),
    }),
    (error: unknown) =>
      error instanceof PrivateRailwaySignerPrimitiveError &&
      error.code === "signer_unavailable",
  );

  assert.equal(calls, 1);
});
