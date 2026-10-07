import assert from "node:assert/strict";
import test from "node:test";

import { isTrustedAuthOrigin } from "../lib/auth/origin";

test("authentication origin is bound to the configured Orrylo domain", () => {
  assert.equal(
    isTrustedAuthOrigin(
      "https://app.orrylo.com",
      "app.orrylo.com",
      "production",
    ),
    true,
  );
  assert.equal(
    isTrustedAuthOrigin("https://evil.example", "app.orrylo.com", "production"),
    false,
  );
  assert.equal(
    isTrustedAuthOrigin(
      "http://app.orrylo.com",
      "app.orrylo.com",
      "production",
    ),
    false,
  );
  assert.equal(isTrustedAuthOrigin(null, "app.orrylo.com", "production"), false);
});

test("localhost HTTP is permitted outside production", () => {
  assert.equal(
    isTrustedAuthOrigin("http://localhost:3000", "localhost", "development"),
    true,
  );
});
