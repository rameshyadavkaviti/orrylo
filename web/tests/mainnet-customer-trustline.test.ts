import assert from "node:assert/strict";
import test from "node:test";
import { MAINNET_ISSUER } from "../lib/server/projects/mainnet-token-orders";
import { inspectMainnetCustomerTrustline, MainnetTrustlineError } from "../lib/stellar/mainnet-customer-trustline";

const destination = "GCLZ6AXEQ2U2KAI62AWDLLDI4EIHOUGRVFTNAHTT44S2MX3GWQAGTCHR";
const input = {destination, assetCode: "ORRYLO", initialSupply: "25"};
const account = (balances: unknown[]) => Response.json({account_id: destination, balances});
const asset = (extra = {}) => ({
  asset_type: "credit_alphanum12", asset_code: "ORRYLO", asset_issuer: MAINNET_ISSUER,
  balance: "0.0000000", limit: "100.0000000", is_authorized: true,
  ...extra,
});

test("Mainnet destination with no trustline requires customer signature; never skips it", async () => {
  const result = await inspectMainnetCustomerTrustline(input, async (url) => {
    assert.match(String(url), /^https:\/\/horizon\.stellar\.org\/accounts\//);
    return account([]);
  });
  assert.equal(result.status, "signature_required");
  assert.equal(result.network, "public");
});

test("exact Mainnet issuer/code trustline with sufficient capacity is ready", async () => {
  const result = await inspectMainnetCustomerTrustline(input, async () => account([asset()]));
  assert.equal(result.status, "ready");
});

test("wrong issuer, restricted authorization and insufficient capacity fail closed", async () => {
  const wrongIssuer = await inspectMainnetCustomerTrustline(input, async () => account([asset({asset_issuer: destination})]));
  assert.equal(wrongIssuer.status, "signature_required");
  for (const row of [asset({is_authorized: false}), asset({limit: "20.0000000"}), asset({balance: "80.0000000", buying_liabilities: "10.0000000"})]) {
    await assert.rejects(inspectMainnetCustomerTrustline(input, async () => account([row])),
      (error: unknown) => error instanceof MainnetTrustlineError &&
        ["trustline_not_authorized", "trustline_capacity_insufficient"].includes(error.code));
  }
});

test("unfunded destination is reported separately from absent trustline", async () => {
  await assert.rejects(inspectMainnetCustomerTrustline(input, async () => new Response(null, {status: 404})),
    (error: unknown) => error instanceof MainnetTrustlineError && error.code === "customer_account_not_funded");
});

test("malformed Horizon response and network errors never appear as ready", async () => {
  await assert.rejects(inspectMainnetCustomerTrustline(input, async () => Response.json({balances: []})), /invalid_horizon_response/);
  await assert.rejects(inspectMainnetCustomerTrustline(input, async () => { throw new Error("offline"); }), /horizon_unavailable/);
});
