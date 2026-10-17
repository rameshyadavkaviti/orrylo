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

test("uncertain exact-hash reconciliation is authenticated, owner-scoped, and never silently unlocks", async () => {
  let called = 0;
  const supplied = deps();
  supplied.reconcile = async ({
    project,
    amount,
    transactionHash,
    unsignedXdr,
  }) => {
    called += 1;
    assert.equal(project.ownerPublicKey, OWNER);
    assert.equal(project.assetCode, "TESTNEW");
    assert.equal(amount, "50");
    assert.equal(transactionHash, HASH);
    assert.equal(unsignedXdr, "UNSIGNED_NONSECRET_XDR");
    return { status: "pending" };
  };
  const request = () =>
    new NextRequest(URL, {
      method: "POST",
      headers: { origin: "https://orrylo.com" },
      body: JSON.stringify({
        amount: "50",
        transactionHash: HASH,
        unsignedXdr: "UNSIGNED_NONSECRET_XDR",
      }),
    });
  const pending = await handleConfirmTrustline(request(), context, supplied);
  assert.equal(pending.status, 200);
  assert.equal((await pending.json()).reconciliation.status, "pending");
  assert.equal(called, 1);

  const wrongOwner = await handleConfirmTrustline(request(), context, {
    ...supplied,
    getOwnedProject: async () => null,
  });
  assert.equal(wrongOwner.status, 404);
  assert.equal(called, 1);
});

test("reconciliation rejects injected authority, forged origin, and malformed XDR", async () => {
  let called = false;
  const supplied = deps();
  supplied.reconcile = async () => {
    called = true;
    return { status: "terminal" };
  };
  for (const body of [
    { amount: "50", transactionHash: HASH, unsignedXdr: "X", issuer: ISSUER },
    { amount: "50", transactionHash: HASH, unsignedXdr: "" },
    { amount: "50", transactionHash: "nohash", unsignedXdr: "X" },
  ]) {
    const result = await handleConfirmTrustline(
      new NextRequest(URL, {
        method: "POST",
        headers: { origin: "https://orrylo.com" },
        body: JSON.stringify(body),
      }),
      context,
      supplied,
    );
    assert.equal(result.status, 400);
  }
  const crossOrigin = await handleConfirmTrustline(
    new NextRequest(URL, {
      method: "POST",
      headers: { origin: "https://evil.example" },
      body: JSON.stringify({
        amount: "50",
        transactionHash: HASH,
        unsignedXdr: "X",
      }),
    }),
    context,
    supplied,
  );
  assert.equal(crossOrigin.status, 403);
  assert.equal(called, false);
});

test("a second authenticated browser receives pending without a signable XDR", async () => {
  let claims = 0;
  const fixture = deps();
  const signable = {
    ...READY,
    status: "signature_required" as const,
    unsignedXdr: "SERVER-BOUND-ONE-TIME-XDR",
    transactionHash: HASH,
    validUntil: 1800000300,
  };
  fixture.inspect = async () => signable;
  fixture.reserve = async () => {
    claims += 1;
    return claims === 1
      ? { status: "claimed", plan: signable }
      : { status: "pending", transactionHash: HASH };
  };
  const first = await handleInspectTrustline(
    new NextRequest(URL + "?amount=50"),
    context,
    fixture,
  );
  assert.equal(first.status, 200);
  const firstResult = (await first.json()).trustline;
  assert.equal(firstResult.status, "signature_required");
  assert.equal(firstResult.unsignedXdr, signable.unsignedXdr);

  // Same authenticated wallet in another browser/server session.
  const second = await handleInspectTrustline(
    new NextRequest(URL + "?amount=50"),
    context,
    fixture,
  );
  assert.equal(second.status, 200);
  const secondResult = (await second.json()).trustline;
  assert.equal(secondResult.status, "pending");
  assert.equal(secondResult.transactionHash, HASH);
  assert.equal(secondResult.unsignedXdr, undefined);
  assert.equal(claims, 2);
});

test("durable pending hash is surfaced before a failing fresh preflight", async () => {
  let inspectCalls = 0;
  const fixture = {
    ...deps(),
    pending: async () => ({
      issuerPublicKey: ISSUER,
      destinationPublicKey: OWNER,
      assetCode: "TESTNEW",
      transactionHash: HASH,
    }),
    inspect: async () => {
      inspectCalls += 1;
      throw Object.assign(new Error("insufficient_customer_xlm"), {
        code: "insufficient_customer_xlm",
      });
    },
  } as CustomerTrustlineRouteDependencies;

  const response = await handleInspectTrustline(
    new NextRequest(URL + "?amount=75"),
    context,
    fixture,
  );
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).trustline, {
    status: "pending",
    network: "testnet",
    issuerPublicKey: ISSUER,
    destinationPublicKey: OWNER,
    assetCode: "TESTNEW",
    amount: "75",
    transactionHash: HASH,
  });
  assert.equal(inspectCalls, 0);
});
