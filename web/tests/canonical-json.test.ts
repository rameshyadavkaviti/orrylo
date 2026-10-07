import assert from "node:assert/strict";
import test from "node:test";

import { canonicalJson, type JsonObject } from "../lib/persistence/json";

test("canonical JSON is ASCII insertion-order independent", () => {
  const first: JsonObject = { a: 1, b: 2, c: 3 };
  const second: JsonObject = { c: 3, b: 2, a: 1 };

  assert.equal(canonicalJson(first), canonicalJson(second));
});

test("canonical JSON is Unicode insertion-order independent", () => {
  const composed = String.fromCodePoint(0x00e9);
  const decomposed = String.fromCodePoint(0x0065, 0x0301);
  const first: JsonObject = {};
  const second: JsonObject = {};

  first[composed] = "composed";
  first[decomposed] = "decomposed";
  second[decomposed] = "decomposed";
  second[composed] = "composed";

  assert.notEqual(composed, decomposed);
  assert.equal(canonicalJson(first), canonicalJson(second));
});

test("canonical JSON recursively orders nested objects", () => {
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

test("canonical JSON preserves array order", () => {
  const value: JsonObject[] = [
    { b: 2, a: 1 },
    { d: 4, c: 3 },
  ];

  assert.equal(
    canonicalJson(value),
    '[{"a":1,"b":2},{"c":3,"d":4}]',
  );
});
