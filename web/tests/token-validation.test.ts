import assert from "node:assert/strict";
import test from "node:test";

import {
  TOKEN_DESCRIPTION_MAX_LENGTH,
  validateSharedAssetDraft,
} from "../lib/validation/token";

test("normalizes a valid shared asset draft", () => {
  const result = validateSharedAssetDraft({
    code: "  demo9 ",
    displayName: "  Demo Asset ",
    description: "  A token for demo builders.  ",
  });

  assert.equal(result.valid, true);
  assert.deepEqual(result.normalized, {
    code: "DEMO9",
    displayName: "Demo Asset",
    description: "A token for demo builders.",
  });
});

test("description is optional but bounded for the preview", () => {
  assert.equal(
    validateSharedAssetDraft({
      code: "DEMO",
      displayName: "Demo Asset",
      description: "",
    }).valid,
    true,
  );

  const result = validateSharedAssetDraft({
    code: "DEMO",
    displayName: "Demo Asset",
    description: "x".repeat(TOKEN_DESCRIPTION_MAX_LENGTH + 1),
  });

  assert.equal(result.valid, false);
  assert.ok(result.errors.description);
});

test("rejects invalid asset code and display name", () => {
  const result = validateSharedAssetDraft({
    code: "bad-code-more-than-twelve",
    displayName: "x",
    description: "",
  });

  assert.equal(result.valid, false);
  assert.ok(result.errors.code);
  assert.ok(result.errors.displayName);
});

test("rejects empty and whitespace-only required draft fields", () => {
  for (const code of ["", "   "]) {
    const result = validateSharedAssetDraft({
      code,
      displayName: "   ",
      description: "Optional description",
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
      description: "",
    }).valid,
    true,
  );

  const tooLong = validateSharedAssetDraft({
    code: "ABCDEFGHIJKLM",
    displayName: "Boundary Asset",
    description: "",
  });
  assert.equal(tooLong.valid, false);
  assert.ok(tooLong.errors.code);
});

test("rejects punctuation and normalizes lowercase before validation", () => {
  const punctuation = validateSharedAssetDraft({
    code: "BAD-CODE",
    displayName: "Demo Asset",
    description: "",
  });
  assert.equal(punctuation.valid, false);
  assert.ok(punctuation.errors.code);

  const lowercase = validateSharedAssetDraft({
    code: "abc123",
    displayName: "Demo Asset",
    description: "",
  });
  assert.equal(lowercase.valid, true);
  assert.equal(lowercase.normalized.code, "ABC123");
});
