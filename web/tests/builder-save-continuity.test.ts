import assert from "node:assert/strict";
import test from "node:test";

import { prepareManagedProjectSave } from "../lib/projects/pending-managed-project";

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
