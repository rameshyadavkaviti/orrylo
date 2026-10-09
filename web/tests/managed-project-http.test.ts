import assert from "node:assert/strict";
import test from "node:test";

import { NextRequest } from "next/server";
import { Keypair } from "@stellar/stellar-sdk/base";

import {
  handleCreateManagedProject,
  type CreateProjectRouteDependencies,
} from "../app/api/projects/route";
import {
  handlePublishManagedProject,
  type PublishProjectRouteDependencies,
} from "../app/api/projects/[projectId]/publish/route";

const OWNER = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 41)).publicKey();
const OTHER = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 42)).publicKey();
const PROJECT_ID = "c4a9fbd2-31b1-4bbd-b0cb-e7f0a6a9b610";
const SESSION = {
  publicKey: OWNER,
  createdAt: Date.parse("2026-10-09T10:00:00.000Z"),
  expiresAt: Date.parse("2026-10-09T18:00:00.000Z"),
};

function createRequest(body: unknown) {
  return new NextRequest("https://app.orrylo.com/api/projects", {
    method: "POST",
    headers: {
      Origin: "https://app.orrylo.com",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

test("managed project creation rejects an unauthenticated session", async () => {
  let called = false;
  const dependencies: CreateProjectRouteDependencies = {
    authDomain: "app.orrylo.com",
    getSession: async () => null,
    createProject: async () => {
      called = true;
      throw new Error("must not run");
    },
  };

  const response = await handleCreateManagedProject(
    createRequest({
      idempotencyKey: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      code: "NOVA",
      displayName: "Nova",
      description: "Demo",
    }),
    dependencies,
  );

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {
    ok: false,
    code: "unauthenticated",
  });
  assert.equal(called, false);
});

test("managed project creation derives owner from the authenticated session", async () => {
  let observedOwner: string | null = null;
  const dependencies: CreateProjectRouteDependencies = {
    authDomain: "app.orrylo.com",
    getSession: async () => SESSION,
    createProject: async (ownerPublicKey) => {
      observedOwner = ownerPublicKey;
      return {
        created: true,
        project: {
          projectId: PROJECT_ID,
          slug: "nova",
          publicStatus: "draft",
        },
      };
    },
  };

  const response = await handleCreateManagedProject(
    createRequest({
      idempotencyKey: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      code: "NOVA",
      displayName: "Nova",
      description: "Demo",
      ownerPublicKey: OTHER,
    }),
    dependencies,
  );
  const payload = await response.json();

  assert.equal(response.status, 201);
  assert.equal(observedOwner, OWNER);
  assert.equal(payload.managePath, `/my-assets/${PROJECT_ID}`);
  assert.equal(payload.publicPath, "/p/nova");
  assert.equal(payload.publicStatus, "draft");
});

test("publish boundary also binds the operation to the authenticated owner", async () => {
  let observedOwner: string | null = null;
  let observedProjectId: string | null = null;
  const dependencies: PublishProjectRouteDependencies = {
    authDomain: "app.orrylo.com",
    getSession: async () => SESSION,
    publish: async (projectId, ownerPublicKey) => {
      observedProjectId = projectId;
      observedOwner = ownerPublicKey;
      return { slug: "nova", publicStatus: "published" };
    },
  };
  const request = new NextRequest(
    `https://app.orrylo.com/api/projects/${PROJECT_ID}/publish`,
    {
      method: "POST",
      headers: { Origin: "https://app.orrylo.com" },
    },
  );

  const response = await handlePublishManagedProject(
    request,
    { params: Promise.resolve({ projectId: PROJECT_ID }) },
    dependencies,
  );

  assert.equal(response.status, 200);
  assert.equal(observedOwner, OWNER);
  assert.equal(observedProjectId, PROJECT_ID);
  assert.deepEqual(await response.json(), {
    ok: true,
    publicStatus: "published",
    publicPath: "/p/nova",
  });
});
