import assert from "node:assert/strict";
import test from "node:test";

import { describeAuthApiFailure } from "../lib/wallet/auth-messages";
import { classifyWalletIntentError } from "../lib/wallet/errors";

test("classifies explicit Albedo rejection", () => {
  assert.equal(classifyWalletIntentError({ code: -4 }), "rejected");
});

test("classifies common cancellation messages as rejection", () => {
  for (const message of [
    "User rejected request",
    "The popup was closed",
    "Cancelled by user",
  ]) {
    assert.equal(classifyWalletIntentError({ message }), "rejected");
  }
});

test("keeps unrelated wallet failures separate", () => {
  assert.equal(
    classifyWalletIntentError({ message: "Network unavailable" }),
    "wallet_error",
  );
  assert.equal(classifyWalletIntentError(new Error("boom")), "wallet_error");
});

test("explains deployed origin misconfiguration without blocking the builder", () => {
  const message = describeAuthApiFailure({
    code: "untrusted_origin",
    status: 403,
  });

  assert.match(message, /not configured for this site address/i);
  assert.match(message, /token builder without a wallet/i);
});

test("verification and service failures stay actionable but non-sensitive", () => {
  assert.match(
    describeAuthApiFailure({ code: "invalid_signature", status: 401 }),
    /could not be verified/i,
  );
  assert.match(
    describeAuthApiFailure({ status: 503 }),
    /temporarily unavailable/i,
  );
});
