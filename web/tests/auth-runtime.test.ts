import assert from "node:assert/strict";
import test from "node:test";

import { readServerAuthConfig } from "../lib/auth/runtime";

test("production auth config requires an explicit public hostname", () => {
  assert.throws(
    () => readServerAuthConfig({}, "production"),
    /ORRYLO_AUTH_DOMAIN is required in production/,
  );
});

test("development auth config may default to localhost", () => {
  assert.deepEqual(readServerAuthConfig({}, "development"), {
    domain: "localhost",
    network: "testnet",
  });
});

test("configured auth domain is normalized without changing the hostname", () => {
  assert.deepEqual(
    readServerAuthConfig(
      {
        ORRYLO_AUTH_DOMAIN: "  orrylo-production.up.railway.app  ",
        NEXT_PUBLIC_STELLAR_NETWORK: "testnet",
      },
      "production",
    ),
    {
      domain: "orrylo-production.up.railway.app",
      network: "testnet",
    },
  );
});

test("auth config rejects URLs and invalid network names", () => {
  assert.throws(
    () =>
      readServerAuthConfig(
        { ORRYLO_AUTH_DOMAIN: "https://orrylo.com" },
        "production",
      ),
    /hostname only/,
  );

  assert.throws(
    () =>
      readServerAuthConfig(
        {
          ORRYLO_AUTH_DOMAIN: "orrylo.com",
          NEXT_PUBLIC_STELLAR_NETWORK: "invalid",
        },
        "production",
      ),
    /must be testnet or public/,
  );
});
