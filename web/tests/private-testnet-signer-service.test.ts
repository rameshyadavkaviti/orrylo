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
  KNOWN_RYLO_ISSUER_PUBLIC_KEYS,
  SHARED_ISSUER_CANDIDATE,
} from "../lib/product/constants";
import {
  PrivateTestnetSignerError,
  createPrivateTestnetSignerRuntime,
  handlePrivateTestnetSignerRequest,
} from "../signer-service/private-testnet-signer";

const ISSUER_KEYPAIR = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 201));
const ISSUER = ISSUER_KEYPAIR.publicKey();
const OTHER_KEYPAIR = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 202));
const DESTINATION = Keypair.fromRawEd25519Seed(
  Buffer.alloc(32, 203),
).publicKey();
const AUTH = "a".repeat(48);

function unsignedTransaction(
  source = ISSUER,
  networkPassphrase = Networks.TESTNET,
): Transaction {
  return new TransactionBuilder(new Account(source, "123"), {
    fee: "100",
    networkPassphrase,
  })
    .addOperation(
      Operation.payment({
        destination: DESTINATION,
        asset: new Asset("NOVA", source),
        amount: "25.0000000",
      }),
    )
    .setTimebounds(1_800_000_000, 1_800_000_300)
    .build();
}

function requestBody(transaction: Transaction, hash?: string) {
  return JSON.stringify({
    transactionHash: hash ?? Buffer.from(transaction.hash()).toString("hex"),
    unsignedEnvelopeXdr: transaction.toXDR(),
  });
}

test("valid canonical Testnet request signs exactly once", async () => {
  let signCalls = 0;
  const runtime = createPrivateTestnetSignerRuntime({
    issuerPublicKey: ISSUER,
    requestAuthSecret: AUTH,
    signer: ISSUER_KEYPAIR,
    signEnvelope(transaction, signer) {
      signCalls += 1;
      transaction.sign(signer);
    },
  });
  const transaction = unsignedTransaction();

  const result = await handlePrivateTestnetSignerRequest(
    {
      method: "POST",
      path: "/v1/sign",
      authorization: `Bearer ${AUTH}`,
      readBody: async () => requestBody(transaction),
    },
    runtime,
  );

  assert.equal(result.status, 200);
  assert.equal(result.body.network, "testnet");
  assert.equal(result.body.signerPublicKey, ISSUER);
  assert.equal(signCalls, 1);

  const signed = TransactionBuilder.fromXDR(
    String(result.body.signedEnvelopeXdr),
    Networks.TESTNET,
  );
  assert.ok(signed instanceof Transaction);
  assert.equal(signed.signatures.length, 1);
  assert.equal(
    Buffer.from(signed.signatures[0]!.hint.toBytes()).equals(
      Buffer.from(ISSUER_KEYPAIR.signatureHint()),
    ),
    true,
  );
  assert.equal(
    ISSUER_KEYPAIR.verify(signed.hash(), signed.signatures[0]!.signature),
    true,
  );
});

test("missing or invalid auth is rejected before body parsing and signing", async () => {
  let bodyReads = 0;
  let signCalls = 0;
  const runtime = createPrivateTestnetSignerRuntime({
    issuerPublicKey: ISSUER,
    requestAuthSecret: AUTH,
    signer: ISSUER_KEYPAIR,
    signEnvelope(transaction, signer) {
      signCalls += 1;
      transaction.sign(signer);
    },
  });

  for (const authorization of [null, "Bearer wrong"]) {
    const result = await handlePrivateTestnetSignerRequest(
      {
        method: "POST",
        path: "/v1/sign",
        authorization,
        readBody: async () => {
          bodyReads += 1;
          return requestBody(unsignedTransaction());
        },
      },
      runtime,
    );
    assert.equal(result.status, 401);
  }

  assert.equal(bodyReads, 0);
  assert.equal(signCalls, 0);
});

test("wrong network, wrong issuer, XDR/hash mismatch, and pre-signed envelopes fail before signing", async () => {
  let signCalls = 0;
  const runtime = createPrivateTestnetSignerRuntime({
    issuerPublicKey: ISSUER,
    requestAuthSecret: AUTH,
    signer: ISSUER_KEYPAIR,
    signEnvelope(transaction, signer) {
      signCalls += 1;
      transaction.sign(signer);
    },
  });

  const valid = unsignedTransaction();
  const publicNetworkTransaction = unsignedTransaction(ISSUER, Networks.PUBLIC);
  const wrongIssuer = unsignedTransaction(OTHER_KEYPAIR.publicKey());
  const presigned = unsignedTransaction();
  presigned.sign(ISSUER_KEYPAIR);

  const bodies = [
    requestBody(
      valid,
      Buffer.from(publicNetworkTransaction.hash()).toString("hex"),
    ),
    requestBody(valid, "f".repeat(64)),
    requestBody(wrongIssuer),
    requestBody(presigned),
  ];

  for (const body of bodies) {
    const result = await handlePrivateTestnetSignerRequest(
      {
        method: "POST",
        path: "/v1/sign",
        authorization: `Bearer ${AUTH}`,
        readBody: async () => body,
      },
      runtime,
    );
    assert.equal(result.status, 400);
  }

  assert.equal(signCalls, 0);
});

test("all known RYLO issuers and the reserved Shared Issuer candidate are rejected", () => {
  for (const issuerPublicKey of [
    ...KNOWN_RYLO_ISSUER_PUBLIC_KEYS,
    SHARED_ISSUER_CANDIDATE,
  ]) {
    assert.throws(
      () =>
        createPrivateTestnetSignerRuntime({
          issuerPublicKey,
          requestAuthSecret: AUTH,
          signer: ISSUER_KEYPAIR,
        }),
      (error: unknown) =>
        error instanceof PrivateTestnetSignerError &&
        error.code === "forbidden_issuer",
      issuerPublicKey,
    );
  }
});

test("configured issuer must equal the service-scoped signing key", () => {
  assert.throws(
    () =>
      createPrivateTestnetSignerRuntime({
        issuerPublicKey: ISSUER,
        requestAuthSecret: AUTH,
        signer: OTHER_KEYPAIR,
      }),
    (error: unknown) =>
      error instanceof PrivateTestnetSignerError &&
      error.code === "signer_key_mismatch",
  );
});

test("health endpoint proves readiness without invoking signing", async () => {
  let signCalls = 0;
  const runtime = createPrivateTestnetSignerRuntime({
    issuerPublicKey: ISSUER,
    requestAuthSecret: AUTH,
    signer: ISSUER_KEYPAIR,
    signEnvelope(transaction, signer) {
      signCalls += 1;
      transaction.sign(signer);
    },
  });

  const result = await handlePrivateTestnetSignerRequest(
    {
      method: "GET",
      path: "/healthz",
      authorization: null,
      readBody: async () => {
        throw new Error("health must not read a request body");
      },
    },
    runtime,
  );

  assert.equal(result.status, 200);
  assert.deepEqual(result.body, {
    ok: true,
    service: "orrylo-private-testnet-signer",
    network: "testnet",
    issuerPublicKey: ISSUER,
    ready: true,
  });
  assert.equal(signCalls, 0);
});
