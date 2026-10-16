import assert from "node:assert/strict";
import test from "node:test";

import { NextRequest } from "next/server";

import {
  handleConfirmTrustline,
  handleInspectTrustline,
  type CustomerTrustlineRouteDependencies,
} from "../app/api/projects/[projectId]/issuance/trustline/route";

const PROJECT = "00000000-0000-4000-8000-000000000101";
const OWNER = "GBJIM6BH2WYV3BLAFR4F6KW6Y7XZV36FBXZFICMWQ5Y7DVL4RGV2CYPB";
const ISSUER = "GBW4IKGPC5Q4YRKGRMNNXTVRZNQZ3DFWFHXSQUAMWLXES75MWTY3TWOV";
const HASH = "a".repeat(64);
const URL =
  "https://orrylo.com/api/projects/" + PROJECT + "/issuance/trustline";

const PROJECT_RECORD = {
  projectId: PROJECT,
  ownerPublicKey: OWNER,
  network: "testnet",
  issuerModel: "shared",
  issuerPublicKey: null,
  assetCode: "TESTNEW",
};

const READY = {
  status: "ready",
  network: "testnet",
  issuerPublicKey: ISSUER,
  destinationPublicKey: OWNER,
  assetCode: "TESTNEW",
  amount: "50",
  issuerFeeStroops: "100",
  customerFeeStroops: "0",
  customerFeeCapStroops: "200",
  additionalReserveStroops: "0",
} as const;

function deps(overrides?: {
  owned?: boolean;
  network?: "testnet" | "public";
  status?: "ready" | "signature_required";
}): CustomerTrustlineRouteDependencies {
  return {
    authDomain: "orrylo.com",
    getSession: async () => ({ publicKey: OWNER }) as never,
    getOwnedProject: async () =>
      overrides?.owned === false
        ? null
        : ({
            ...PROJECT_RECORD,
            network: overrides?.network ?? "testnet",
          } as never),
    inspect: async () => ({ ...READY, status: overrides?.status ?? "ready" }),
    confirm: async () => READY,
  };
}

const context = { params: Promise.resolve({ projectId: PROJECT }) };

test("readiness is scoped to authenticated owner and exact eligible Testnet project", async () => {
  const ok = await handleInspectTrustline(
    new NextRequest(URL + "?amount=50"),
    context,
    deps(),
  );
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).trustline.destinationPublicKey, OWNER);

  const notOwned = await handleInspectTrustline(
    new NextRequest(URL + "?amount=50"),
    context,
    deps({ owned: false }),
  );
  assert.equal(notOwned.status, 404);

  const publicNetwork = await handleInspectTrustline(
    new NextRequest(URL + "?amount=50"),
    context,
    deps({ network: "public" }),
  );
  assert.equal(publicNetwork.status, 409);
});

test("malformed or extra readiness fields cannot select arbitrary issuer or destination", async () => {
  for (const url of [
    URL + "?amount=0",
    URL + "?amount=hello",
    URL + "?amount=50&destination=" + OWNER,
    URL + "?amount=50&assetCode=WRONG",
  ]) {
    const response = await handleInspectTrustline(
      new NextRequest(url),
      context,
      deps(),
    );
    assert.equal(response.status, 400);
  }
});

test("trustline confirmation enforces same-origin, exact inputs, and verified readiness", async () => {
  const denied = await handleConfirmTrustline(
    new NextRequest(URL, {
      method: "POST",
      headers: { origin: "https://other.example" },
      body: JSON.stringify({ amount: "50", transactionHash: HASH }),
    }),
    context,
    deps(),
  );
  assert.equal(denied.status, 403);

  const valid = await handleConfirmTrustline(
    new NextRequest(URL, {
      method: "POST",
      headers: { origin: "https://orrylo.com" },
      body: JSON.stringify({ amount: "50", transactionHash: HASH }),
    }),
    context,
    deps(),
  );
  assert.equal(valid.status, 200);
  assert.equal((await valid.json()).trustline.status, "ready");

  const changed = await handleConfirmTrustline(
    new NextRequest(URL, {
      method: "POST",
      headers: { origin: "https://orrylo.com" },
      body: JSON.stringify({
        amount: "50",
        transactionHash: HASH,
        issuerPublicKey: ISSUER,
      }),
    }),
    context,
    deps(),
  );
  assert.equal(changed.status, 400);
});
