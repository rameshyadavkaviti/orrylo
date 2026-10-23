import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  Asset,
  Keypair,
  Networks,
  Transaction,
  TransactionBuilder,
} from "@stellar/stellar-sdk";

import {
  MAINNET_CREATION_PRICE_STROOPS,
  MAINNET_SHARED_ISSUER_PUBLIC_KEY,
  MAINNET_TREASURY_PUBLIC_KEY,
  MainnetCreationError,
  buildMainnetIssuance,
  buildMainnetPayment,
  buildMainnetTrustline,
  readMainnetCreationConfiguration,
  verifyMainnetIssuance,
} from "../lib/stellar/mainnet-creation";

const owner = Keypair.random().publicKey();
const treasury = MAINNET_TREASURY_PUBLIC_KEY;

test("Mainnet creation is disabled unless every explicit activation gate is present", () => {
  assert.throws(
    () => readMainnetCreationConfiguration({}),
    (error: unknown) =>
      error instanceof MainnetCreationError && error.code === "mainnet_disabled",
  );

  assert.throws(
    () =>
      readMainnetCreationConfiguration({
        NEXT_PUBLIC_STELLAR_NETWORK: "public",
        ORRYLO_MAINNET_CREATION_ENABLED: "true",
        ORRYLO_MAINNET_SHARED_ISSUER_PUBLIC_KEY:
          MAINNET_SHARED_ISSUER_PUBLIC_KEY,
        ORRYLO_MAINNET_TREASURY_PUBLIC_KEY: Keypair.random().publicKey(),
        ORRYLO_MAINNET_TREASURY_VERIFIED: "true",
        ORRYLO_MAINNET_ISSUER_FEE_STROOPS: "100",
        ORRYLO_MAINNET_CUSTOMER_TRUSTLINE_MAX_FEE_STROOPS: "1000",
      }),
    (error: unknown) =>
      error instanceof MainnetCreationError &&
      error.code === "treasury_identity_forbidden",
  );

  const configuration = readMainnetCreationConfiguration({
    NEXT_PUBLIC_STELLAR_NETWORK: "public",
    ORRYLO_MAINNET_CREATION_ENABLED: "true",
    ORRYLO_MAINNET_SHARED_ISSUER_PUBLIC_KEY:
      MAINNET_SHARED_ISSUER_PUBLIC_KEY,
    ORRYLO_MAINNET_TREASURY_PUBLIC_KEY: treasury,
    ORRYLO_MAINNET_TREASURY_VERIFIED: "true",
    ORRYLO_MAINNET_ISSUER_FEE_STROOPS: "100",
    ORRYLO_MAINNET_CUSTOMER_TRUSTLINE_MAX_FEE_STROOPS: "1000",
  });

  assert.equal(configuration.priceStroops, MAINNET_CREATION_PRICE_STROOPS);
  assert.equal(configuration.treasuryPublicKey, treasury);
  assert.equal(configuration.network, "public");
});

test("builds one exact owner-signed Mainnet trustline with ledger-clock time bounds", () => {
  const built = buildMainnetTrustline({
    ownerPublicKey: owner,
    ownerSequence: "40",
    assetCode: "ACME",
    amount: "25.0000000",
    feeStroops: "100",
    maxFeeStroops: "1000",
    ledgerClosedAt: "2026-10-23T10:00:00Z",
  });

  const transaction = TransactionBuilder.fromXDR(built.unsignedXdr, Networks.PUBLIC);
  assert.ok(transaction instanceof Transaction);
  assert.equal(transaction.source, owner);
  assert.equal(transaction.sequence, "41");
  assert.equal(transaction.fee, "100");
  assert.deepEqual(transaction.timeBounds, {
    minTime: "1792749600",
    maxTime: "1792749900",
  });
  assert.equal(transaction.operations.length, 1);
  assert.equal(transaction.operations[0]?.type, "changeTrust");
  if (transaction.operations[0]?.type !== "changeTrust") assert.fail();
  assert.ok(transaction.operations[0].line instanceof Asset);
  assert.equal(transaction.operations[0].line.getCode(), "ACME");
  assert.equal(transaction.operations[0].line.getIssuer(), MAINNET_SHARED_ISSUER_PUBLIC_KEY);
  assert.equal(transaction.operations[0].limit, "25.0000000");
  assert.equal(built.transactionHash, Buffer.from(transaction.hash()).toString("hex"));
});

test("builds one exact 10 XLM Treasury payment with the immutable order memo", () => {
  const built = buildMainnetPayment({
    ownerPublicKey: owner,
    ownerSequence: "40",
    treasuryPublicKey: MAINNET_TREASURY_PUBLIC_KEY,
    memo: "ORRYLO_AAAAAAAAAAAAAAAAAAAAA",
    feeStroops: "100",
    maxFeeStroops: "1000",
    ledgerClosedAt: "2026-10-23T10:00:00Z",
  });
  const transaction = TransactionBuilder.fromXDR(built.unsignedXdr, Networks.PUBLIC);
  assert.ok(transaction instanceof Transaction);
  assert.equal(transaction.source, owner);
  assert.equal(
    Buffer.from(transaction.memo.value as Uint8Array).toString("utf8"),
    "ORRYLO_AAAAAAAAAAAAAAAAAAAAA",
  );
  assert.equal(transaction.operations.length, 1);
  assert.equal(transaction.operations[0]?.type, "payment");
  if (transaction.operations[0]?.type !== "payment") assert.fail();
  assert.equal(transaction.operations[0].destination, MAINNET_TREASURY_PUBLIC_KEY);
  assert.equal(transaction.operations[0].asset.isNative(), true);
  assert.equal(transaction.operations[0].amount, "10.0000000");
});

test("builds one exact issuer-sourced Mainnet payment and rejects excessive fees", () => {
  const built = buildMainnetIssuance({
    issuerSequence: "70",
    destinationPublicKey: owner,
    assetCode: "ACME",
    amount: "25.0000000",
    feeStroops: "100",
    maxFeeStroops: "1000",
    ledgerClosedAt: "2026-10-23T10:00:00Z",
  });
  const transaction = TransactionBuilder.fromXDR(built.unsignedXdr, Networks.PUBLIC);
  assert.ok(transaction instanceof Transaction);
  assert.equal(transaction.source, MAINNET_SHARED_ISSUER_PUBLIC_KEY);
  assert.equal(transaction.sequence, "71");
  assert.equal(transaction.operations.length, 1);
  assert.equal(transaction.operations[0]?.type, "payment");
  if (transaction.operations[0]?.type !== "payment") assert.fail();
  assert.equal(transaction.operations[0].destination, owner);
  assert.equal(transaction.operations[0].asset.code, "ACME");
  assert.equal(transaction.operations[0].asset.issuer, MAINNET_SHARED_ISSUER_PUBLIC_KEY);
  assert.equal(transaction.operations[0].amount, "25.0000000");
  assert.equal(built.unsignedXdrSha256, createHash("sha256").update(built.unsignedXdr).digest("hex"));

  assert.throws(
    () => buildMainnetIssuance({
      issuerSequence: "70",
      destinationPublicKey: owner,
      assetCode: "ACME",
      amount: "25.0000000",
      feeStroops: "1001",
      maxFeeStroops: "1000",
      ledgerClosedAt: "2026-10-23T10:00:00Z",
    }),
    (error: unknown) =>
      error instanceof MainnetCreationError && error.code === "fee_cap_exceeded",
  );
});

test("verifies exact successful Mainnet issuance identity from Horizon", async () => {
  const hash = "a".repeat(64);
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    if (url.endsWith(`/transactions/${hash}`)) {
      return Response.json({
        hash,
        successful: true,
        source_account: MAINNET_SHARED_ISSUER_PUBLIC_KEY,
        source_account_sequence: "71",
        fee_charged: "100",
        operation_count: 1,
        ledger: 123,
        created_at: "2026-10-23T10:00:05Z",
        envelope_xdr: "AAAA",
        result_xdr: "BBBB",
      });
    }
    if (url.includes("/operations")) {
      return Response.json({ _embedded: { records: [{
        type: "payment",
        source_account: MAINNET_SHARED_ISSUER_PUBLIC_KEY,
        from: MAINNET_SHARED_ISSUER_PUBLIC_KEY,
        to: owner,
        asset_type: "credit_alphanum4",
        asset_code: "ACME",
        asset_issuer: MAINNET_SHARED_ISSUER_PUBLIC_KEY,
        amount: "25.0000000",
      }] } });
    }
    return new Response(null, { status: 404 });
  };

  assert.deepEqual(
    await verifyMainnetIssuance({
      transactionHash: hash,
      destinationPublicKey: owner,
      assetCode: "ACME",
      amount: "25.0000000",
    }, fetchImpl),
    {
      status: "confirmed",
      transactionHash: hash,
      ledgerSequence: 123,
      ledgerClosedAt: "2026-10-23T10:00:05.000Z",
      sourceSequence: "71",
      envelopeXdrSha256: createHash("sha256").update("AAAA").digest("hex"),
      resultXdrSha256: createHash("sha256").update("BBBB").digest("hex"),
    },
  );
});

test("never treats missing or mismatched Mainnet issuance as confirmed", async () => {
  const hash = "b".repeat(64);
  const notFound: typeof fetch = async () => new Response(null, { status: 404 });
  assert.deepEqual(await verifyMainnetIssuance({
    transactionHash: hash,
    destinationPublicKey: owner,
    assetCode: "ACME",
    amount: "25.0000000",
  }, notFound), { status: "not_found" });

  const wrongDestination: typeof fetch = async (input) => {
    if (String(input).includes("/operations")) {
      return Response.json({ _embedded: { records: [{
        type: "payment",
        source_account: MAINNET_SHARED_ISSUER_PUBLIC_KEY,
        from: MAINNET_SHARED_ISSUER_PUBLIC_KEY,
        to: treasury,
        asset_type: "credit_alphanum4",
        asset_code: "ACME",
        asset_issuer: MAINNET_SHARED_ISSUER_PUBLIC_KEY,
        amount: "25.0000000",
      }] } });
    }
    return Response.json({
      hash,
      successful: true,
      source_account: MAINNET_SHARED_ISSUER_PUBLIC_KEY,
      source_account_sequence: "71",
      fee_charged: "100",
      operation_count: 1,
      ledger: 123,
      created_at: "2026-10-23T10:00:05Z",
      envelope_xdr: "AAAA",
      result_xdr: "BBBB",
    });
  };
  assert.deepEqual(await verifyMainnetIssuance({
    transactionHash: hash,
    destinationPublicKey: owner,
    assetCode: "ACME",
    amount: "25.0000000",
  }, wrongDestination), { status: "rejected" });
});
