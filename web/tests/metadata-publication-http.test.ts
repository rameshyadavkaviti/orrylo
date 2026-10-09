import assert from "node:assert/strict";
import test from "node:test";

import { NextRequest } from "next/server";
import { Keypair } from "@stellar/stellar-sdk/base";

import {
  handlePublishMetadata,
  type PublishMetadataRouteDependencies,
} from "../app/api/projects/[projectId]/metadata/publish/route";
import type { MetadataPublicationState } from "../lib/projects/metadata-publication";
import { MetadataPublicationError } from "../lib/server/projects/metadata-publication-service";

const OWNER = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 71)).publicKey();
const OTHER = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 72)).publicKey();
const PROJECT_ID = "c4a9fbd2-31b1-4bbd-b0cb-e7f0a6a9b610";
const SESSION = {
  publicKey: OWNER,
  createdAt: Date.parse("2026-10-09T10:00:00.000Z"),
  expiresAt: Date.parse("2026-10-09T18:00:00.000Z"),
};

const PUBLICATION: MetadataPublicationState = {
  projectId: PROJECT_ID,
  metadataHome: "assets.orrylo.com",
  network: "testnet",
  assetCode: "NOVA",
  issuerPublicKey: Keypair.fromRawEd25519Seed(Buffer.alloc(32, 73)).publicKey(),
  currencyToml: '[[CURRENCIES]]\ncode = "NOVA"\nname = "Nova"\n',
  contentHash: "a".repeat(64),
  revision: 1,
  publishedAt: "2026-10-09T10:00:00.000Z",
  updatedAt: "2026-10-09T10:00:01.000Z",
  reachable: true,
  verifiedAt: "2026-10-09T10:00:01.000Z",
  lastVerificationAt: "2026-10-09T10:00:01.000Z",
  verificationErrorCode: null,
};

function request(body?: unknown) {
  return new NextRequest(
    `https://app.orrylo.com/api/projects/${PROJECT_ID}/metadata/publish`,
    {
      method: "POST",
      headers: {
        Origin: "https://app.orrylo.com",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
  );
}

function context() {
  return { params: Promise.resolve({ projectId: PROJECT_ID }) };
}

test("metadata publication rejects unauthenticated requests before publication", async () => {
  let called = false;
  const dependencies: PublishMetadataRouteDependencies = {
    authDomain: "app.orrylo.com",
    getSession: async () => null,
    publish: async () => {
      called = true;
      throw new Error("must not run");
    },
  };

  const response = await handlePublishMetadata(
    request(),
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

test("metadata publication derives owner only from the authenticated session", async () => {
  let observedOwner: string | null = null;
  const dependencies: PublishMetadataRouteDependencies = {
    authDomain: "app.orrylo.com",
    getSession: async () => SESSION,
    publish: async (_projectId, ownerPublicKey) => {
      observedOwner = ownerPublicKey;
      return {
        status: "verified",
        changed: true,
        publication: PUBLICATION,
      };
    },
  };

  const response = await handlePublishMetadata(
    request({ ownerPublicKey: OTHER }),
    context(),
    dependencies,
  );
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(observedOwner, OWNER);
  assert.equal(payload.ok, true);
  assert.equal(payload.published, true);
  assert.equal(payload.reachable, true);
});

test("verification failure is retryable and remains truthfully published but unreachable", async () => {
  const dependencies: PublishMetadataRouteDependencies = {
    authDomain: "app.orrylo.com",
    getSession: async () => SESSION,
    publish: async () => ({
      status: "published_not_reachable",
      changed: true,
      publication: {
        ...PUBLICATION,
        reachable: false,
        verifiedAt: null,
        verificationErrorCode: "request_failed",
      },
    }),
  };

  const response = await handlePublishMetadata(
    request(),
    context(),
    dependencies,
  );
  const payload = await response.json();

  assert.equal(response.status, 502);
  assert.equal(payload.code, "verification_failed");
  assert.equal(payload.published, true);
  assert.equal(payload.reachable, false);
  assert.equal(payload.verificationErrorCode, "request_failed");
});

test("Dedicated Issuer publication remains unavailable instead of falling back to Shared Issuer", async () => {
  const dependencies: PublishMetadataRouteDependencies = {
    authDomain: "app.orrylo.com",
    getSession: async () => SESSION,
    publish: async () => {
      throw new MetadataPublicationError("unsupported_issuer_model");
    },
  };

  const response = await handlePublishMetadata(
    request(),
    context(),
    dependencies,
  );

  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    ok: false,
    code: "unsupported_issuer_model",
  });
});
