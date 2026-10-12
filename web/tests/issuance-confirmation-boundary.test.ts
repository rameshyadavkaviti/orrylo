import assert from "node:assert/strict";
import test from "node:test";

import {
  UnavailableSharedAssetConfirmationReader,
  type SharedAssetConfirmationReader,
} from "../lib/server/projects/shared-asset-provenance";
import {
  SharedIssuancePersistenceUnavailableError,
  UnavailableSharedIssuancePersistenceWriter,
  UnavailableTrustedLedgerConfirmationWriter,
} from "../lib/server/projects/shared-issuance-persistence";

test("the production confirmation reader is explicitly unavailable", async () => {
  const reader: SharedAssetConfirmationReader =
    new UnavailableSharedAssetConfirmationReader();

  assert.equal(
    await reader.findConfirmed(
      "00000000-0000-4000-8000-000000000001",
      "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    ),
    null,
  );
});

test("intent, attempt, and confirmation writers remain unavailable", async () => {
  const persistence = new UnavailableSharedIssuancePersistenceWriter();
  const confirmation = new UnavailableTrustedLedgerConfirmationWriter();
  const unavailable = (error: unknown) =>
    error instanceof SharedIssuancePersistenceUnavailableError;

  await assert.rejects(persistence.appendIntent({} as never), unavailable);
  await assert.rejects(persistence.appendAttempt({} as never), unavailable);
  await assert.rejects(
    confirmation.appendConfirmation({} as never),
    unavailable,
  );
});
