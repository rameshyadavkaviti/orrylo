import assert from "node:assert/strict";
import test from "node:test";

import {
  Keypair,
  Networks,
  Transaction,
  TransactionBuilder,
} from "@stellar/stellar-sdk";

import {
  MAINNET_SHARED_ISSUER_PUBLIC_KEY,
  buildMainnetTrustline,
} from "../lib/stellar/mainnet-creation";
import {
  confirmMainnetTrustline,
  prepareMainnetPayment,
  prepareMainnetIssuance,
  prepareMainnetTrustline,
} from "../lib/stellar/mainnet-horizon";

const ownerKeypair = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 44));
const owner = ownerKeypair.publicKey();
const ledger = {
  sequence: 500,
  closed_at: "2026-10-23T10:00:00Z",
  base_fee_in_stroops: 100,
  base_reserve_in_stroops: 5_000_000,
};
const issuerAccount = {
  account_id: MAINNET_SHARED_ISSUER_PUBLIC_KEY,
  sequence: "70",
  subentry_count: 0,
  num_sponsoring: 0,
  num_sponsored: 0,
  thresholds: { low_threshold: 1, med_threshold: 1, high_threshold: 1 },
  signers: [{ key: MAINNET_SHARED_ISSUER_PUBLIC_KEY, weight: 1, type: "ed25519_public_key" }],
  balances: [{ asset_type: "native", balance: "3.1999802", selling_liabilities: "0.0000000" }],
};
const ownerAccount = {
  account_id: owner,
  sequence: "40",
  subentry_count: 0,
  num_sponsoring: 0,
  num_sponsored: 0,
  thresholds: { low_threshold: 1, med_threshold: 1, high_threshold: 1 },
  signers: [{ key: owner, weight: 1, type: "ed25519_public_key" }],
  balances: [{ asset_type: "native", balance: "20.0000000", selling_liabilities: "0.0000000" }],
};

function horizon(overrides: { trustline?: boolean; envelopeXdr?: string; transactionHash?: string } = {}): typeof fetch {
  return async (input) => {
    const url = String(input);
    if (url.includes("/ledgers?")) {
      return Response.json({ _embedded: { records: [ledger] } });
    }
    if (url.endsWith(`/accounts/${MAINNET_SHARED_ISSUER_PUBLIC_KEY}`)) {
      return Response.json(issuerAccount);
    }
    if (url.endsWith(`/accounts/${owner}`)) {
      return Response.json({
        ...ownerAccount,
        subentry_count: overrides.trustline ? 1 : 0,
        balances: overrides.trustline
          ? [...ownerAccount.balances, {
              asset_type: "credit_alphanum4",
              asset_code: "ACME",
              asset_issuer: MAINNET_SHARED_ISSUER_PUBLIC_KEY,
              balance: "0.0000000",
              buying_liabilities: "0.0000000",
              limit: "25.0000000",
              is_authorized: true,
            }]
          : ownerAccount.balances,
      });
    }
    if (overrides.envelopeXdr && url.endsWith(`/transactions/${overrides.transactionHash}`)) {
      return Response.json({
        hash: overrides.transactionHash,
        successful: true,
        ledger: 501,
        envelope_xdr: overrides.envelopeXdr,
      });
    }
    return new Response(null, { status: 404 });
  };
}

test("prepares one affordable Mainnet trustline or reports an existing exact trustline", async () => {
  const prepared = await prepareMainnetTrustline({
    ownerPublicKey: owner,
    assetCode: "ACME",
    amount: "25",
    maxFeeStroops: "1000",
  }, horizon());
  assert.equal(prepared.status, "signature_required");
  if (prepared.status !== "signature_required") assert.fail();
  assert.equal(prepared.transaction.feeStroops, "100");
  assert.equal(prepared.transaction.validFrom, Date.parse(ledger.closed_at) / 1000);

  const ready = await prepareMainnetTrustline({
    ownerPublicKey: owner,
    assetCode: "ACME",
    amount: "25",
    maxFeeStroops: "1000",
  }, horizon({ trustline: true }));
  assert.deepEqual(ready, { status: "ready", ledgerSequence: 500 });
});

test("prepares one durable exact-hash Treasury payment envelope", async () => {
  const prepared = await prepareMainnetPayment({
    ownerPublicKey: owner,
    treasuryPublicKey: "GAABHXPQQB3EBT6FZJKGR6C6DT7XJEUEBGVPK2G2AQDKBIVXCBKXDBR7",
    memo: "ORRYLO_AAAAAAAAAAAAAAAAAAAAA",
    maxFeeStroops: "1000",
  }, horizon());
  assert.equal(prepared.sourceSequence, "41");
  assert.equal(prepared.feeStroops, "100");
});

test("confirms only the exact successful ChangeTrust hash and current capacity", async () => {
  const built = buildMainnetTrustline({
    ownerPublicKey: owner,
    ownerSequence: "40",
    assetCode: "ACME",
    amount: "25",
    feeStroops: "100",
    maxFeeStroops: "1000",
    ledgerClosedAt: ledger.closed_at,
  });
  const signed = TransactionBuilder.fromXDR(built.unsignedXdr, Networks.PUBLIC);
  assert.ok(signed instanceof Transaction);
  signed.sign(ownerKeypair);
  assert.deepEqual(await confirmMainnetTrustline({
    transactionHash: built.transactionHash,
    ownerPublicKey: owner,
    assetCode: "ACME",
    amount: "25",
    maxFeeStroops: "1000",
  }, horizon({
    trustline: true,
    envelopeXdr: signed.toXDR(),
    transactionHash: built.transactionHash,
  })), { transactionHash: built.transactionHash, ledgerSequence: 501 });
});

test("issuance preflight pins the configured issuer policy and exact destination capacity", async () => {
  const prepared = await prepareMainnetIssuance({
    destinationPublicKey: owner,
    assetCode: "ACME",
    amount: "25",
    feeStroops: "100",
    maxFeeStroops: "1000",
  }, horizon({ trustline: true }));
  assert.equal(prepared.transactionHash.length, 64);
  assert.equal(prepared.sourceSequence, "71");

  const changedIssuer = { ...issuerAccount, thresholds: { low_threshold: 1, med_threshold: 2, high_threshold: 1 } };
  const fetchImpl: typeof fetch = async (input) => {
    if (String(input).endsWith(`/accounts/${MAINNET_SHARED_ISSUER_PUBLIC_KEY}`)) {
      return Response.json(changedIssuer);
    }
    return horizon({ trustline: true })(input);
  };
  await assert.rejects(
    prepareMainnetIssuance({
      destinationPublicKey: owner,
      assetCode: "ACME",
      amount: "25",
      feeStroops: "100",
      maxFeeStroops: "1000",
    }, fetchImpl),
    /issuer_policy_mismatch/,
  );
});
