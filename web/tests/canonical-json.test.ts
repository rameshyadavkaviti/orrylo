import assert from "node:assert/strict";
import test from "node:test";

import { canonicalJson, type JsonObject } from "../lib/persistence/json";

test("canonical JSON orders normal ASCII keys independent of insertion", () => {
  const forward: JsonObject = { a: 1, b: 2, c: 3 };
  const reverse: JsonObject = { c: 3, b: 2, a: 1 };

  assert.equal(canonicalJson(forward), canonicalJson(reverse));
  assert.equal(canonicalJson(forward), '{"a":1,"b":2,"c":3}');
});

test("canonical JSON orders composed and decomposed Unicode keys deterministically", () => {
  const composed = "\u00e9";
  const decomposed = "e\u0301";
  const first: JsonObject = {
    [composed]: "composed",
    [decomposed]: "decomposed",
  };
  const second: JsonObject = {
    [decomposed]: "decomposed",
    [composed]: "composed",
  };

  assert.notEqual(composed, decomposed);
  assert.equal(canonicalJson(first), canonicalJson(second));
});

test("canonical JSON recursively orders nested objects independent of insertion", () => {
  const first: JsonObject = {
    outer: {
      z: { beta: 2, alpha: 1 },
      a: { two: 2, one: 1 },
    },
  };
  const second: JsonObject = {
    outer: {
      a: { one: 1, two: 2 },
      z: { alpha: 1, beta: 2 },
    },
  };

  assert.equal(canonicalJson(first), canonicalJson(second));
});

test("canonical JSON preserves array order while ordering contained objects", () => {
  assert.equal(
    canonicalJson([{ b: 2, a: 1 }, { d: 4, c: 3 }]),
    '[{"a":1,"b":2},{"c":3,"d":4}]',
  );
});
