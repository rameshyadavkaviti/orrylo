import assert from "node:assert/strict";
import test from "node:test";

import { customerTrustlineReadinessMessage } from "../lib/projects/customer-trustline-readiness-error";

test("HTTP 409 trustline reasons remain actionable and fail closed", () => {
  assert.match(
    customerTrustlineReadinessMessage("insufficient_customer_xlm"),
    /spendable XLM.*trustline reserve/,
  );
  assert.match(
    customerTrustlineReadinessMessage("issuer_policy_mismatch"),
    /signer, flag, or threshold policy/,
  );
  assert.match(
    customerTrustlineReadinessMessage("trustline_fee_cap_exceeded"),
    /fee exceeds.*cap/,
  );
  assert.match(
    customerTrustlineReadinessMessage("insufficient_issuer_native_balance"),
    /operator attention/,
  );
  for (const code of [
    "destination_not_found",
    "trustline_capacity_exceeded",
    "trustline_unauthorized",
    "horizon_unavailable",
    "malformed_horizon_response",
    "trustline_configuration_unavailable",
    "unauthenticated",
    "project_not_found",
    "ineligible_project",
    "invalid_request",
  ]) {
    const message = customerTrustlineReadinessMessage(code);
    assert.ok(message.includes(`Code: ${code}`));
    assert.match(message, /No issuance was started/);
  }
});

test("unrecognized server responses cannot inject arbitrary error text into the UI", () => {
  const fallback = customerTrustlineReadinessMessage(undefined);
  assert.equal(
    fallback,
    "Could not verify the exact customer trustline. No issuance was started.",
  );
  for (const code of ["unknown", "<script>alert(1)</script>", "__proto__"]) {
    assert.equal(customerTrustlineReadinessMessage(code), fallback);
  }
});
