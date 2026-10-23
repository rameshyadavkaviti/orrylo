import assert from "node:assert/strict";
import test from "node:test";

import { Keypair } from "@stellar/stellar-sdk";
import { NextRequest } from "next/server";

import {
  handleMainnetCreationGet,
  handleMainnetCreationPost,
  type MainnetCreationRouteDependencies,
} from "../app/api/projects/[projectId]/mainnet/route";

const owner = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 45)).publicKey();
const projectId = "10000000-0000-4000-8000-000000000021";
const context = { params: Promise.resolve({ projectId }) };

function dependencies(): MainnetCreationRouteDependencies & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    authDomain: "app.orrylo.com",
    getSession: async () => ({ publicKey: owner, createdAt: 1, expiresAt: 2 }),
    getState: async (project, wallet) => {
      calls.push(`get:${project}:${wallet}`);
      return null;
    },
    prepareTrustline: async (project, wallet) => {
      calls.push(`trustline:${project}:${wallet}`);
      return { status: "trustline_pending" };
    },
    confirmTrustline: async (project, wallet, hash) => {
      calls.push(`confirm_trustline:${project}:${wallet}:${hash}`);
      return { status: "trustline_confirmed" };
    },
    issue: async (project, wallet) => {
      calls.push(`issue:${project}:${wallet}`);
      return { status: "issued" };
    },
  };
}

function request(method: string, body?: unknown, origin = "https://app.orrylo.com") {
  return new NextRequest(`https://app.orrylo.com/api/projects/${projectId}/mainnet`, {
    method,
    headers: { origin, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

test("Mainnet route derives owner from session for read-only state", async () => {
  const deps = dependencies();
  const response = await handleMainnetCreationGet(request("GET"), context, deps);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, order: null });
  assert.deepEqual(deps.calls, [`get:${projectId}:${owner}`]);
});

test("Mainnet mutations require trusted origin and strict server-authority bodies", async () => {
  const deps = dependencies();
  const denied = await handleMainnetCreationPost(
    request("POST", { action: "issue" }, "https://evil.example"),
    context,
    deps,
  );
  assert.equal(denied.status, 403);
  assert.deepEqual(deps.calls, []);

  const injected = await handleMainnetCreationPost(
    request("POST", {
      action: "confirm_payment",
      transactionHash: "a".repeat(64),
      treasuryPublicKey: owner,
    }),
    context,
    deps,
  );
  assert.equal(injected.status, 400);
  assert.deepEqual(deps.calls, []);
});

test("trustline and issuance commands are owner-bound", async () => {
  const deps = dependencies();
  const preparation = await handleMainnetCreationPost(
    request("POST", { action: "prepare_trustline" }),
    context,
    deps,
  );
  assert.equal(preparation.status, 200);
  const trustline = await handleMainnetCreationPost(
    request("POST", { action: "confirm_trustline", transactionHash: "a".repeat(64) }),
    context,
    deps,
  );
  assert.equal(trustline.status, 200);
  const issue = await handleMainnetCreationPost(
    request("POST", { action: "issue" }),
    context,
    deps,
  );
  assert.equal(issue.status, 200);
  assert.deepEqual(deps.calls, [
    `trustline:${projectId}:${owner}`,
    `confirm_trustline:${projectId}:${owner}:${"a".repeat(64)}`,
    `issue:${projectId}:${owner}`,
  ]);
});
