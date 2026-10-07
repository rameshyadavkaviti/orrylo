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

test("rejects empty and whitespace-only draft fields", () => {
  for (const code of ["", "   "]) {
    const result = validateSharedAssetDraft({
      code,
      displayName: "   ",
    });

    assert.equal(result.valid, false);
    assert.ok(result.errors.code);
    assert.ok(result.errors.displayName);
  }
});

test("accepts the 12-character code boundary and rejects 13 characters", () => {
  assert.equal(
    validateSharedAssetDraft({
      code: "ABCDEFGHIJKL",
      displayName: "Boundary Asset",
    }).valid,
    true,
  );

  const tooLong = validateSharedAssetDraft({
    code: "ABCDEFGHIJKLM",
    displayName: "Boundary Asset",
  });
  assert.equal(tooLong.valid, false);
  assert.ok(tooLong.errors.code);
});

test("rejects punctuation and normalizes lowercase before validation", () => {
  const punctuation = validateSharedAssetDraft({
    code: "BAD-CODE",
    displayName: "Demo Asset",
  });
  assert.equal(punctuation.valid, false);
  assert.ok(punctuation.errors.code);

  const lowercase = validateSharedAssetDraft({
    code: "abc123",
    displayName: "Demo Asset",
  });
  assert.equal(lowercase.valid, true);
  assert.equal(lowercase.normalized.code, "ABC123");
});
