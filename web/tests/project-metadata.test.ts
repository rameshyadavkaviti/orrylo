import assert from "node:assert/strict";
import test from "node:test";

import {
  safeHttpsUrl,
  validateEditableProjectMetadata,
} from "../lib/projects/project-metadata";

test("managed metadata accepts and normalizes durable HTTPS URLs", () => {
  const result = validateEditableProjectMetadata({
    displayName: " Nova ",
    description: " A managed project. ",
    logoUrl: "https://cdn.example.com/nova.png",
    websiteUrl: "https://example.com",
    communityUrl: "https://community.example.com/nova",
  });

  assert.equal(result.valid, true);
  assert.equal(result.normalized.displayName, "Nova");
  assert.equal(result.normalized.description, "A managed project.");
  assert.equal(result.normalized.logoUrl, "https://cdn.example.com/nova.png");
  assert.equal(result.normalized.websiteUrl, "https://example.com/");
  assert.equal(
    result.normalized.communityUrl,
    "https://community.example.com/nova",
  );
});

test("unsafe and browser-local URL schemes are rejected", () => {
  for (const unsafe of [
    "javascript:alert(1)",
    "data:image/png;base64,AAAA",
    "blob:https://orrylo.com/id",
    "file:///tmp/logo.png",
    "http://example.com/logo.png",
  ]) {
    const result = validateEditableProjectMetadata({
      displayName: "Nova",
      description: "",
      logoUrl: unsafe,
      websiteUrl: "",
      communityUrl: "",
    });

    assert.equal(result.valid, false, unsafe);
    assert.ok(result.errors.logoUrl, unsafe);
    assert.equal(safeHttpsUrl(unsafe), null);
  }
});

test("HTTPS metadata URLs with embedded credentials are rejected", () => {
  const result = validateEditableProjectMetadata({
    displayName: "Nova",
    description: "",
    logoUrl: "",
    websiteUrl: "https://user:password@example.com",
    communityUrl: "",
  });

  assert.equal(result.valid, false);
  assert.ok(result.errors.websiteUrl);
});
