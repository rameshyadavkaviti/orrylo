import assert from "node:assert/strict";
import test from "node:test";

import { Keypair } from "@stellar/stellar-sdk/base";

import {
  AutomaticPublicationService,
  reconcilePublicationAfterConfirmedExecution,
  type AutomaticPublicationDependencies,
} from "../lib/server/projects/automatic-publication-service";
import type { DatabaseClient } from "../lib/server/persistence/database";
import { PostgresProjectProfileRepository } from "../lib/server/persistence/project-profile-repository";
import type { VerifiedSharedAssetProvenance } from "../lib/server/projects/shared-asset-provenance";

const OWNER = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 101)).publicKey();
const ISSUER = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 102)).publicKey();
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";

const CONFIRMATION: VerifiedSharedAssetProvenance = {
  confirmationId: "22222222-2222-4222-8222-222222222222",
  projectId: PROJECT_ID,
  ownerPublicKey: OWNER,
  network: "testnet",
  assetCode: "NOVA",
  issuerPublicKey: ISSUER,
  destinationPublicKey: OWNER,
  amount: "100.0000000",
  issuanceRequestId: "33333333-3333-4333-8333-333333333333",
  issuanceIntentFingerprint: "a".repeat(64),
  transactionHash: "b".repeat(64),
  signedEnvelopeXdrSha256: "c".repeat(64),
  ledgerSequence: 123,
};

function dependencies(
  overrides: Partial<AutomaticPublicationDependencies> = {},
): AutomaticPublicationDependencies {
  return {
    findConfirmation: async () => CONFIRMATION,
    publishLandingPage: async () => ({
      slug: "nova",
      publicStatus: "published",
    }),
    publishMetadata: async () => ({
      status: "verified",
      changed: true,
      publication: {
        projectId: PROJECT_ID,
        metadataHome: "assets.orrylo.com",
        network: "testnet",
        assetCode: "NOVA",
        issuerPublicKey: ISSUER,
        currencyToml: "[[CURRENCIES]]\n",
        contentHash: "d".repeat(64),
        revision: 1,
        publishedAt: "2026-10-20T10:00:00.000Z",
        updatedAt: "2026-10-20T10:00:01.000Z",
        reachable: true,
        verifiedAt: "2026-10-20T10:00:01.000Z",
        lastVerificationAt: "2026-10-20T10:00:01.000Z",
        verificationErrorCode: null,
      },
    }),
    ...overrides,
  };
}

test("draft projects remain private before authoritative issuance confirmation", async () => {
  let landingCalls = 0;
  let metadataCalls = 0;
  const service = new AutomaticPublicationService(
    dependencies({
      findConfirmation: async () => null,
      publishLandingPage: async () => {
        landingCalls += 1;
        throw new Error("must not publish");
      },
      publishMetadata: async () => {
        metadataCalls += 1;
        throw new Error("must not publish");
      },
    }),
  );

  const result = await service.reconcileConfirmedProject(PROJECT_ID, OWNER);

  assert.deepEqual(result, {
    status: "not_issued",
    landingPage: "draft",
    metadata: "not_published",
    errors: [],
  });
  assert.equal(landingCalls, 0);
  assert.equal(metadataCalls, 0);
});

test("public project lookup requires durable confirmed Testnet provenance", async () => {
  const queries: string[] = [];
  const sql = ((strings: TemplateStringsArray) => {
    queries.push(strings.join("?"));
    return Promise.resolve([]);
  }) as unknown as DatabaseClient;
  const repository = new PostgresProjectProfileRepository(sql);

  assert.equal(await repository.findPublishedBySlug("legacy-draft"), null);
  assert.match(
    queries[0] ?? "",
    /project_issuance_ledger_confirmations[\s\S]+result_success = true/,
  );
  assert.match(queries[0] ?? "", /p\.network = 'testnet'/);
  assert.match(queries[0] ?? "", /p\.issuer_model = 'shared'/);
});

test("every confirmed execution entry point runs safe publication reconciliation", async () => {
  let calls = 0;
  const complete = await reconcilePublicationAfterConfirmedExecution(
    { status: "confirmed" },
    async () => {
      calls += 1;
      return {
        status: "complete",
        landingPage: "published",
        metadata: "verified",
        errors: [],
      };
    },
  );
  const skipped = await reconcilePublicationAfterConfirmedExecution(
    { status: "confirming" },
    async () => {
      calls += 1;
      throw new Error("must not run");
    },
  );

  assert.equal(complete?.status, "complete");
  assert.equal(skipped, undefined);
  assert.equal(calls, 1);
});

test("publication reconciliation failure preserves confirmed execution", async () => {
  const result = await reconcilePublicationAfterConfirmedExecution(
    { status: "confirmed" },
    async () => {
      throw Object.assign(new Error("offline"), {
        code: "metadata_endpoint_unreachable",
      });
    },
  );

  assert.deepEqual(result, {
    status: "pending",
    landingPage: "failed",
    metadata: "failed",
    errors: ["metadata_endpoint_unreachable"],
  });
});

test("confirmed issuance automatically publishes the landing page and verifies metadata", async () => {
  const calls: string[] = [];
  const service = new AutomaticPublicationService(
    dependencies({
      publishLandingPage: async (_projectId, _owner, confirmation) => {
        calls.push(`landing:${confirmation.transactionHash}`);
        return { slug: "nova", publicStatus: "published" };
      },
      publishMetadata: async () => {
        calls.push("metadata");
        return dependencies().publishMetadata(PROJECT_ID, OWNER);
      },
    }),
  );

  const result = await service.reconcileConfirmedProject(PROJECT_ID, OWNER);

  assert.equal(result.status, "complete");
  assert.equal(result.landingPage, "published");
  assert.equal(result.metadata, "verified");
  assert.deepEqual(result.errors, []);
  assert.deepEqual(calls, [
    `landing:${CONFIRMATION.transactionHash}`,
    "metadata",
  ]);
});

test("publication failure is recoverable without creating another issuance", async () => {
  let confirmationReads = 0;
  let landingCalls = 0;
  let metadataCalls = 0;
  const service = new AutomaticPublicationService(
    dependencies({
      findConfirmation: async () => {
        confirmationReads += 1;
        return CONFIRMATION;
      },
      publishLandingPage: async () => {
        landingCalls += 1;
        return { slug: "nova", publicStatus: "published" };
      },
      publishMetadata: async () => {
        metadataCalls += 1;
        if (metadataCalls === 1)
          throw Object.assign(new Error("offline"), { code: "request_failed" });
        return dependencies().publishMetadata(PROJECT_ID, OWNER);
      },
    }),
  );

  const first = await service.reconcileConfirmedProject(PROJECT_ID, OWNER);
  const recovered = await service.reconcileConfirmedProject(PROJECT_ID, OWNER);

  assert.equal(first.status, "pending");
  assert.equal(first.landingPage, "published");
  assert.equal(first.metadata, "failed");
  assert.deepEqual(first.errors, ["request_failed"]);
  assert.equal(recovered.status, "complete");
  assert.equal(recovered.metadata, "verified");
  assert.equal(confirmationReads, 2);
  assert.equal(landingCalls, 2);
  assert.equal(metadataCalls, 2);
});

test("landing-page failure never blocks an independent metadata publication attempt", async () => {
  let metadataCalls = 0;
  const service = new AutomaticPublicationService(
    dependencies({
      publishLandingPage: async () => {
        throw Object.assign(new Error("database unavailable"), {
          code: "landing_page_publication_failed",
        });
      },
      publishMetadata: async () => {
        metadataCalls += 1;
        return dependencies().publishMetadata(PROJECT_ID, OWNER);
      },
    }),
  );

  const result = await service.reconcileConfirmedProject(PROJECT_ID, OWNER);

  assert.equal(result.status, "pending");
  assert.equal(result.landingPage, "failed");
  assert.equal(result.metadata, "verified");
  assert.equal(metadataCalls, 1);
});
