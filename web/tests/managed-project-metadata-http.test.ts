import assert from "node:assert/strict";
import test from "node:test";

import { NextRequest } from "next/server";
import { Keypair } from "@stellar/stellar-sdk/base";

import {
  handleUpdateProjectMetadata,
  type UpdateProjectMetadataRouteDependencies,
} from "../app/api/projects/[projectId]/metadata/route";

const OWNER = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 63)).publicKey();
const OTHER = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 64)).publicKey();
const PROJECT_ID = "c4a9fbd2-31b1-4bbd-b0cb-e7f0a6a9b610";
const SESSION = {
  publicKey: OWNER,
  createdAt: Date.parse("2026-10-09T10:00:00.000Z"),
  expiresAt: Date.parse("2026-10-09T18:00:00.000Z"),
};

function request(body: unknown) {
  return new NextRequest(
    `https://app.orrylo.com/api/projects/${PROJECT_ID}/metadata`,
    {
      method: "PATCH",
      headers: {
        Origin: "https://app.orrylo.com",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
}

function context() {
  return { params: Promise.resolve({ projectId: PROJECT_ID }) };
}

const VALID = {
  displayName: "Nova",
  description: "Managed metadata.",
  logoUrl: "https://cdn.example.com/nova.png",
  websiteUrl: "https://example.com",
  communityUrl: "https://community.example.com",
};

test("metadata update rejects unauthenticated mutation before repository access", async () => {
  let called = false;
  const dependencies: UpdateProjectMetadataRouteDependencies = {
    authDomain: "app.orrylo.com",
    getSession: async () => null,
    updateMetadata: async () => {
      called = true;
      throw new Error("must not run");
    },
  };

  const response = await handleUpdateProjectMetadata(
    request(VALID),
    context(),
    dependencies,
  );

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {
    ok: false,
    code: "unauthenticated",
  });
  assert.equal(called, false);
});

test("metadata owner is derived only from the authenticated session", async () => {
  let observedOwner: string | null = null;
  const dependencies: UpdateProjectMetadataRouteDependencies = {
    authDomain: "app.orrylo.com",
    getSession: async () => SESSION,
    updateMetadata: async (projectId, ownerPublicKey) => {
      assert.equal(projectId, PROJECT_ID);
      observedOwner = ownerPublicKey;
      return {
        projectId,
        updatedAt: "2026-10-09T11:00:00.000Z",
      };
    },
  };

  const response = await handleUpdateProjectMetadata(
    request({ ...VALID, ownerPublicKey: OTHER }),
    context(),
    dependencies,
  );

  assert.equal(response.status, 200);
  assert.equal(observedOwner, OWNER);
});

test("unsafe metadata URL is rejected before repository access", async () => {
  let called = false;
  const dependencies: UpdateProjectMetadataRouteDependencies = {
    authDomain: "app.orrylo.com",
    getSession: async () => SESSION,
    updateMetadata: async () => {
      called = true;
      throw new Error("must not run");
    },
  };

  const response = await handleUpdateProjectMetadata(
    request({ ...VALID, logoUrl: "data:image/png;base64,AAAA" }),
    context(),
    dependencies,
  );
  const payload = await response.json();

  assert.equal(response.status, 400);
  assert.equal(payload.code, "invalid_metadata");
  assert.ok(payload.fieldErrors.logoUrl);
  assert.equal(called, false);
});

test("non-owner repository result is returned as project not found", async () => {
  const dependencies: UpdateProjectMetadataRouteDependencies = {
    authDomain: "app.orrylo.com",
    getSession: async () => ({ ...SESSION, publicKey: OTHER }),
    updateMetadata: async () => null,
  };

  const response = await handleUpdateProjectMetadata(
    request(VALID),
    context(),
    dependencies,
  );

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    ok: false,
    code: "project_not_found",
  });
});
