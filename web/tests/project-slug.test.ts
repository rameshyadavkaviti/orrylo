import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeProjectSlug,
  projectSlugCandidate,
} from "../lib/projects/project-slug";

test("project slug normalization is lowercase, URL-safe, and deterministic", () => {
  assert.equal(normalizeProjectSlug(" Nóva Community! ", "NOVA"), "nova-community");
  assert.equal(normalizeProjectSlug("***", "NOVA"), "nova");
  assert.equal(normalizeProjectSlug("NOVA___Builders", "NOVA"), "nova-builders");
});

test("project slug collision candidates use deterministic numeric suffixes", () => {
  const base = normalizeProjectSlug("Nova", "NOVA");

  assert.equal(projectSlugCandidate(base, 1), "nova");
  assert.equal(projectSlugCandidate(base, 2), "nova-2");
  assert.equal(projectSlugCandidate(base, 19), "nova-19");
  assert.ok(projectSlugCandidate("a".repeat(63), 200).length <= 63);
  assert.throws(() => projectSlugCandidate(base, 0), /positive integer/);
});
