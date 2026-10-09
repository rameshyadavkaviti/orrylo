import assert from "node:assert/strict";
import test from "node:test";

import {
  prepareManagedProjectSave,
  withWalletContinuityAssertion,
} from "../lib/projects/pending-managed-project";

test("pending managed-project save freezes the normalized builder payload across authentication", () => {
  const idempotencyKey = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const draft = {
    code: " nova ",
    displayName: " Nova Community ",
    description: " Built before wallet connection. ",
  };

  const prepared = prepareManagedProjectSave(draft, idempotencyKey);

  assert.equal(prepared.ok, true);

  if (!prepared.ok) {
    return;
  }

  assert.deepEqual(prepared.pending.request, {
    idempotencyKey,
    code: "NOVA",
    displayName: "Nova Community",
    description: "Built before wallet connection.",
  });

  draft.code = "CHANGED";
  draft.displayName = "Changed after pending save";
  draft.description = "This must not alter the pending request.";

  assert.deepEqual(prepared.pending.request, {
    idempotencyKey,
    code: "NOVA",
    displayName: "Nova Community",
    description: "Built before wallet connection.",
  });
});

test("pending managed-project request never carries an owner wallet field", () => {
  const prepared = prepareManagedProjectSave(
    {
      code: "NOVA",
      displayName: "Nova",
      description: "",
    },
    "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  );

  assert.equal(prepared.ok, true);

  if (!prepared.ok) {
    return;
  }

  assert.equal("ownerPublicKey" in prepared.pending.request, false);
});

test("post-authentication retry carries the authenticated wallet only as a continuity assertion", () => {
  const prepared = prepareManagedProjectSave(
    {
      code: "NOVA",
      displayName: "Nova",
      description: "Frozen before authentication.",
    },
    "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  );

  assert.equal(prepared.ok, true);

  if (!prepared.ok) {
    return;
  }

  const walletA = "GA6HCMBLTZS5VQ3FPJ4SCA5PXI4D54ZZG6EXOWZOCN2H7P7PVOQC7F3Y";
  const asserted = withWalletContinuityAssertion(prepared.pending, walletA);

  assert.equal(asserted.request.authenticatedWalletAssertion, walletA);
  assert.equal("ownerPublicKey" in asserted.request, false);
  assert.equal(
    prepared.pending.request.authenticatedWalletAssertion,
    undefined,
  );
  assert.equal(
    asserted.request.idempotencyKey,
    prepared.pending.request.idempotencyKey,
  );
});
