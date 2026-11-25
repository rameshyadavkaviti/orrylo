import assert from "node:assert/strict";
import { test } from "node:test";
import { BONUS_RATE, BONUS_THRESHOLD_RYLO, bonusForQuantity } from "../lib/bonus.ts";

test("RYLO bonus V2 terms are 36% starting at 500 inclusive", () => {
  assert.equal(BONUS_RATE, 0.36);
  assert.equal(BONUS_THRESHOLD_RYLO, 500);
  assert.equal(bonusForQuantity(0), 0);
  assert.equal(bonusForQuantity(499), 0);
  assert.equal(bonusForQuantity(500), 180);
  assert.equal(bonusForQuantity(501), 180.36);
  assert.equal(bonusForQuantity(1000), 360);
  assert.equal(bonusForQuantity(1200), 432);
  assert.equal(bonusForQuantity(10000), 3600);
});
