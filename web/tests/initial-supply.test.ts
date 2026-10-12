import assert from "node:assert/strict";
import test from "node:test";

import {
  STELLAR_MAX_AMOUNT_STROOPS,
  validateInitialSupply,
} from "../lib/validation/initial-supply";

test("accepts exact initial supply without floating-point rounding", () => {
  assert.deepEqual(validateInitialSupply(" 00012.3400000 "), {
    valid: true,
    normalized: "12.34",
    stroops: 123400000n,
  });
  assert.deepEqual(validateInitialSupply("0.0000001"), {
    valid: true,
    normalized: "0.0000001",
    stroops: 1n,
  });
});

test("rejects invalid, negative, zero, overprecision and overflow amounts", () => {
  for (const value of [
    "",
    "0",
    "0.0000000",
    "-1",
    "1e3",
    "1,000",
    "1.",
    "1.00000001",
    "0.00000001",
    "Infinity",
    "1a",
    "922337203686",
  ]) {
    assert.equal(validateInitialSupply(value).valid, false, value);
  }
});

test("enforces the Stellar int64 amount boundary", () => {
  assert.deepEqual(validateInitialSupply("922337203685.4775807"), {
    valid: true,
    normalized: "922337203685.4775807",
    stroops: STELLAR_MAX_AMOUNT_STROOPS,
  });
  assert.equal(validateInitialSupply("922337203685.4775808").valid, false);
});
