import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { Keypair } from "@stellar/stellar-sdk/base";

import {
  handleCreateManagedProject,
  type CreateProjectRouteDependencies,
} from "../app/api/projects/route";

const OWNER = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 41)).publicKey();
const DEFAULT = {
  idempotencyKey: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  code: "NOVA",
  displayName: "Nova",
  description: "A token builder example",
};

function request(body: unknown) {
  return new NextRequest("https://app.orrylo.com/api/projects", {
    method: "POST",
    headers: {
      Origin: "https://app.orrylo.com",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

test("project-only save refuses browser supply and cap fields before any write", async () => {
  let count = 0;
  const dependencies: CreateProjectRouteDependencies = {
    authDomain: "app.orrylo.com",
    getSession: async () => ({
      publicKey: OWNER,
      createdAt: 1,
      expiresAt: 2,
    }),
    createProject: async () => {
      count++;
      throw new Error("must not persist unsupported supply preferences");
    },
  };
  for (const extra of [
    { initialSupply: "100.25" },
    { initialSupplyStroops: "1002500000" },
    { maximumSupply: "1000" },
    { supplyMode: "fixed" },
  ]) {
    const response = await handleCreateManagedProject(
      request({ ...DEFAULT, ...extra }),
      dependencies,
    );
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { ok: false, code: "invalid_request" });
  }
  assert.equal(count, 0);
});

test("Project Profile request remains independent of unsupported browser supply", async () => {
  const dependencies: CreateProjectRouteDependencies = {
    authDomain: "app.orrylo.com",
    getSession: async () => null,
    createProject: async () => {
      throw new Error("unauthenticated clients cannot save");
    },
  };
  const response = await handleCreateManagedProject(request(DEFAULT), dependencies);
  assert.equal(response.status, 401);
});
