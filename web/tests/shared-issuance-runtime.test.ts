import assert from "node:assert/strict";
import test from "node:test";

import { Keypair } from "@stellar/stellar-sdk";

import {
  SharedIssuanceRuntimeUnavailableError,
  createSharedIssuanceRuntimeSigningPrimitive,
  readSharedIssuanceRuntimeConfig,
} from "../lib/server/projects/shared-issuance-runtime";

const ISSUER = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 221)).publicKey();
const AUTH = "c".repeat(48);

const VALID_ENV: NodeJS.ProcessEnv = {
  NODE_ENV: "test",
  NEXT_PUBLIC_STELLAR_NETWORK: "testnet",
  ORRYLO_APPROVED_TESTNET_SHARED_ISSUER_PUBLIC_KEY: ISSUER,
  ORRYLO_TESTNET_SHARED_ISSUER_SIGNER_PUBLIC_KEY: Keypair.fromRawEd25519Seed(
    Buffer.alloc(32, 222),
  ).publicKey(),
  ORRYLO_TESTNET_SHARED_ISSUER_FEE_STROOPS: "100",
  ORRYLO_TESTNET_SIGNER_PRIVATE_URL:
    "http://orrylo-testnet-signer.railway.internal:8080",
  ORRYLO_TESTNET_SIGNER_REQUEST_AUTH_SECRET: AUTH,
  ORRYLO_CONFIRMATION_WRITER_DATABASE_URL:
    "postgres://writer:redacted@db.internal:5432/orrylo",
};

test("missing signer or confirmation-writer runtime config fails closed", () => {
  for (const key of [
    "ORRYLO_TESTNET_SIGNER_PRIVATE_URL",
    "ORRYLO_TESTNET_SIGNER_REQUEST_AUTH_SECRET",
    "ORRYLO_CONFIRMATION_WRITER_DATABASE_URL",
  ] as const) {
    assert.throws(
      () => readSharedIssuanceRuntimeConfig({ ...VALID_ENV, [key]: "" }),
      SharedIssuanceRuntimeUnavailableError,
      key,
    );
  }
});

test("runtime has no silent network, issuer, or fee activation defaults", () => {
  for (const env of [
    { ...VALID_ENV, NEXT_PUBLIC_STELLAR_NETWORK: "" },
    {
      ...VALID_ENV,
      ORRYLO_APPROVED_TESTNET_SHARED_ISSUER_PUBLIC_KEY: "",
    },
    { ...VALID_ENV, ORRYLO_TESTNET_SHARED_ISSUER_FEE_STROOPS: "" },
    { ...VALID_ENV, ORRYLO_TESTNET_SHARED_ISSUER_FEE_STROOPS: "0" },
  ]) {
    assert.throws(
      () => readSharedIssuanceRuntimeConfig(env),
      SharedIssuanceRuntimeUnavailableError,
    );
  }
});

test("valid production config constructs only the private Railway primitive", async () => {
  const config = readSharedIssuanceRuntimeConfig(VALID_ENV);
  assert.equal(config.issuerPublicKey, ISSUER);
  assert.equal(
    config.signerPublicKey,
    VALID_ENV.ORRYLO_TESTNET_SHARED_ISSUER_SIGNER_PUBLIC_KEY,
  );
  assert.equal(config.feeStroops, "100");

  let fetchCalls = 0;
  const primitive = createSharedIssuanceRuntimeSigningPrimitive(
    config,
    (async () => {
      fetchCalls += 1;
      return new Response(null, { status: 503 });
    }) as typeof fetch,
  );

  await assert.rejects(
    primitive.signCanonicalEnvelope({
      transactionHash: "0".repeat(64),
      unsignedEnvelopeXdr: "invalid",
    }),
  );
  assert.equal(fetchCalls, 1);
});
