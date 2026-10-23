import assert from "node:assert/strict";
import test from "node:test";

import { MAINNET_SHARED_ISSUER_PUBLIC_KEY } from "../lib/stellar/mainnet-creation";
import {
  createPrivateMainnetSignerRuntime,
  handlePrivateMainnetSignerRequest,
} from "../signer-service/private-mainnet-signer";

const auth = "test-auth-secret-".repeat(4);

function disabledRuntime() {
  return createPrivateMainnetSignerRuntime({
    ORRYLO_MAINNET_SHARED_ISSUER_PUBLIC_KEY: MAINNET_SHARED_ISSUER_PUBLIC_KEY,
    ORRYLO_MAINNET_SIGNER_REQUEST_AUTH_SECRET: auth,
  });
}

test("disabled signer remains identifiable without loading a signing seed", () => {
  const runtime = disabledRuntime();
  assert.equal(runtime.issuerPublicKey, MAINNET_SHARED_ISSUER_PUBLIC_KEY);
  assert.equal(runtime.signerPublicKey, MAINNET_SHARED_ISSUER_PUBLIC_KEY);
  assert.equal(runtime.signingEnabled, false);
});

test("disabled signer rejects authenticated signing before parsing a transaction", async () => {
  const response = await handlePrivateMainnetSignerRequest(
    new Request("http://signer.railway.internal:8080/v1/sign-and-submit", {
      method: "POST",
      headers: { authorization: `Bearer ${auth}` },
      body: "not-json",
    }),
    disabledRuntime(),
  );
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { ok: false, code: "signing_disabled" });
});
