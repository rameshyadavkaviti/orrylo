import assert from "node:assert/strict";
import test from "node:test";

import { validateSharedAssetDraft } from "../lib/validation/token";

test("normalizes a valid shared asset draft", () => {
  const result = validateSharedAssetDraft({
    code: "  demo9 ",
    displayName: "  Demo Asset ",
  });

  assert.equal(result.valid, true);
  assert.deepEqual(result.normalized, {
    code: "DEMO9",
    displayName: "Demo Asset",
  });
});

test("rejects invalid asset code and display name", () => {
  const result = validateSharedAssetDraft({
    code: "bad-code-more-than-twelve",
    displayName: "x",
  });

  assert.equal(result.valid, false);
  assert.ok(result.errors.code);
  assert.ok(result.errors.displayName);
});
