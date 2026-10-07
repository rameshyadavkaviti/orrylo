import assert from "node:assert/strict";
import test from "node:test";

import { classifyWalletIntentError } from "../lib/wallet/errors";

test("Albedo rejection and cancellation are presented as rejected", () => {
  assert.equal(classifyWalletIntentError({ code: -4 }), "rejected");
  assert.equal(
    classifyWalletIntentError({ message: "User cancelled wallet request" }),
    "rejected",
  );
});

test("unexpected wallet errors remain verification failures", () => {
  assert.equal(
    classifyWalletIntentError({ code: -1, message: "Unhandled" }),
    "wallet_error",
  );
  assert.equal(classifyWalletIntentError(new Error("network")), "wallet_error");
});
