import assert from "node:assert/strict";
import test from "node:test";

import {
  MainnetAutomaticPublicationService,
  type MainnetAutomaticPublicationDependencies,
} from "../lib/server/projects/mainnet-publication-service";

function dependencies(
  overrides: Partial<MainnetAutomaticPublicationDependencies> = {},
): MainnetAutomaticPublicationDependencies {
  return {
    hasConfirmation: async () => true,
    publishLandingPage: async () => true,
    publishMetadata: async () => ({ verified: true, errorCode: null }),
    recordStatus: async () => {},
    ...overrides,
  };
}

test("Mainnet drafts remain private without durable issuance confirmation", async () => {
  let publications = 0;
  const service = new MainnetAutomaticPublicationService(
    dependencies({
      hasConfirmation: async () => false,
      publishLandingPage: async () => { publications += 1; return true; },
      publishMetadata: async () => { publications += 1; return { verified: true, errorCode: null }; },
    }),
  );
  assert.deepEqual(await service.reconcile("project", "owner"), {
    status: "not_issued",
    landingPage: "draft",
    metadata: "pending",
    errors: [],
  });
  assert.equal(publications, 0);
});

test("publication failure is retryable and never changes confirmed issuance", async () => {
  let metadataCalls = 0;
  const statuses: Array<{ status: string; errorCode: string | null }> = [];
  const service = new MainnetAutomaticPublicationService(
    dependencies({
      publishMetadata: async () => {
        metadataCalls += 1;
        return metadataCalls === 1
          ? { verified: false, errorCode: "request_failed" }
          : { verified: true, errorCode: null };
      },
      recordStatus: async (_project, _owner, status, errorCode) => {
        statuses.push({ status, errorCode });
      },
    }),
  );
  const first = await service.reconcile("project", "owner");
  const retried = await service.reconcile("project", "owner");
  assert.equal(first.status, "pending");
  assert.equal(first.landingPage, "published");
  assert.equal(first.metadata, "failed");
  assert.equal(retried.status, "complete");
  assert.equal(metadataCalls, 2);
  assert.deepEqual(statuses, [
    { status: "failed", errorCode: "request_failed" },
    { status: "verified", errorCode: null },
  ]);
});
