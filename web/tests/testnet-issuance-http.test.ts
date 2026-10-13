import assert from "node:assert/strict";
import { test } from "node:test";

import { Keypair } from "@stellar/stellar-sdk/base";
import { NextRequest } from "next/server";

import {
  handleGetIssuance,
  handleRequestIssuance,
  type IssuanceRouteDependencies,
} from "../app/api/projects/[projectId]/issuance/route";
import {
  handleStartOrResumeIssuance,
  type IssuanceExecutionRouteDependencies,
} from "../app/api/projects/[projectId]/issuance/execution/route";
import {
  SharedIssuerUnavailableError,
  UnavailableSharedIssuerExecutionAdapter,
} from "../lib/stellar/shared-issuer-execution";
import { TestnetIssuanceError } from "../lib/server/projects/testnet-issuance-service";
import { SHARED_ISSUER_TESTNET_PASSPHRASE } from "../lib/stellar/shared-issuer-issuance";

const OWNER = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 81)).publicKey();
const PROJECT_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const KEY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CONTEXT = { params: Promise.resolve({ projectId: PROJECT_ID }) };
const SESSION = { publicKey: OWNER, createdAt: 1, expiresAt: 10000 };
const ISSUANCE = {
  requestId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  projectId: PROJECT_ID,
  assetCode: "NOVA",
  network: "testnet" as const,
  status: "awaiting_issuer_integration" as const,
  reservationIssuerPublicKey: OWNER,
  reservationFingerprint: "1".repeat(64),
  issuerPublicKey: null,
  transactionHash: null,
  ledgerSequence: null,
  failureCode: null,
};

function dependencies(): IssuanceRouteDependencies {
  return {
    authDomain: "orrylo.com",
    getSession: async () => SESSION,
    getStatus: async () => null,
    requestIssuance: async () => ({ created: true, issuance: ISSUANCE }),
  };
}

function request(body: unknown, origin = "https://orrylo.com") {
  return new NextRequest(
    `https://orrylo.com/api/projects/${PROJECT_ID}/issuance`,
    {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}
const VALID = {
  idempotencyKey: KEY,
  expectedAssetCode: "NOVA",
  initialSupply: "2.5000000",
};

test("unauthenticated requests cannot see or create issuance intents", async () => {
  const deps = dependencies();
  deps.getSession = async () => null;
  deps.getStatus = async () => {
    throw new Error("must not read");
  };
  deps.requestIssuance = async () => {
    throw new Error("must not write");
  };
  assert.equal(
    (await handleGetIssuance(request(VALID), CONTEXT, deps)).status,
    401,
  );
  assert.equal(
    (await handleRequestIssuance(request(VALID), CONTEXT, deps)).status,
    401,
  );
});

test("request boundary binds owner to session, not browser body", async () => {
  let subject: string | null = null;
  const deps = dependencies();
  deps.requestIssuance = async (input) => {
    subject = input.ownerPublicKey;
    assert.equal(input.projectId, PROJECT_ID);
    assert.equal(input.initialSupply, "2.5000000");
    return { created: true, issuance: ISSUANCE };
  };
  const accepted = await handleRequestIssuance(request(VALID), CONTEXT, deps);
  assert.equal(accepted.status, 201);
  assert.equal(subject, OWNER);

  for (const added of [
    { ownerPublicKey: OWNER },
    { destinationPublicKey: OWNER },
    { initialSupplyStroops: "25000000" },
    { network: "public" },
    { issuerPublicKey: OWNER },
    { transactionHash: "0".repeat(64) },
    { status: "confirmed" },
  ]) {
    const denied = await handleRequestIssuance(
      request({ ...VALID, ...added }),
      CONTEXT,
      deps,
    );
    assert.equal(denied.status, 400);
  }
});

test("origin and payload validation happen before service mutation", async () => {
  const deps = dependencies();
  deps.requestIssuance = async () => {
    throw new Error("unexpected write");
  };
  assert.equal(
    (
      await handleRequestIssuance(
        request(VALID, "https://evil.example"),
        CONTEXT,
        deps,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await handleRequestIssuance(
        request({ idempotencyKey: KEY }),
        CONTEXT,
        deps,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await handleRequestIssuance(
        request({ ...VALID, expectedAssetCode: "novA" }),
        CONTEXT,
        deps,
      )
    ).status,
    400,
  );
});

test("service authorization and state errors map to actionable HTTP statuses", async () => {
  for (const [code, status] of [
    ["project_not_found", 404],
    ["unsupported_network", 403],
    ["ineligible_project", 409],
    ["asset_code_reserved", 409],
    ["issuer_configuration_mismatch", 409],
    ["issuer_integration_unavailable", 503],
    ["issuance_already_requested", 409],
    ["idempotency_conflict", 409],
    ["invalid_asset_configuration", 400],
    ["asset_code_mismatch", 400],
    ["invalid_initial_supply", 400],
  ] as const) {
    const deps = dependencies();
    deps.requestIssuance = async () => {
      throw new TestnetIssuanceError(code);
    };
    const response = await handleRequestIssuance(request(VALID), CONTEXT, deps);
    assert.equal(response.status, status, code);
    assert.equal((await response.json()).code, code);
  }
});

test("owner sees only recorded issuance evidence or not_started", async () => {
  const deps = dependencies();
  const response = await handleGetIssuance(request(VALID), CONTEXT, deps);
  assert.deepEqual(await response.json(), {
    ok: true,
    status: "not_started",
    issuance: null,
  });
  deps.getStatus = async () => ISSUANCE;
  const awaiting = await handleGetIssuance(request(VALID), CONTEXT, deps);
  assert.deepEqual((await awaiting.json()).issuance, ISSUANCE);
});

test("execution boundary derives owner and project from authenticated server context", async () => {
  let received: unknown;
  const deps: IssuanceExecutionRouteDependencies = {
    authDomain: "orrylo.com",
    getSession: async () => SESSION,
    startOrResume: async (input) => {
      received = input;
      return { status: "confirming", transactionHash: "a".repeat(64) };
    },
  };
  const response = await handleStartOrResumeIssuance(
    request({ requestId: ISSUANCE.requestId }),
    CONTEXT,
    deps,
  );
  assert.equal(response.status, 200);
  assert.deepEqual(received, {
    requestId: ISSUANCE.requestId,
    projectId: PROJECT_ID,
    ownerPublicKey: OWNER,
  });
});

test("execution boundary rejects browser authority and unavailable runtime fails closed", async () => {
  const deps: IssuanceExecutionRouteDependencies = {
    authDomain: "orrylo.com",
    getSession: async () => SESSION,
    startOrResume: async () => {
      const error = new Error("unavailable") as Error & { code: string };
      error.code = "issuer_integration_unavailable";
      throw error;
    },
  };
  const override = await handleStartOrResumeIssuance(
    request({ requestId: ISSUANCE.requestId, ownerPublicKey: OWNER }),
    CONTEXT,
    deps,
  );
  assert.equal(override.status, 400);

  const unavailable = await handleStartOrResumeIssuance(
    request({ requestId: ISSUANCE.requestId }),
    CONTEXT,
    deps,
  );
  assert.equal(unavailable.status, 503);
  assert.equal(
    (await unavailable.json()).code,
    "issuer_integration_unavailable",
  );
});

test("unavailable reviewed Stellar execution adapter rejects signing, submission and lookup", async () => {
  const adapter = new UnavailableSharedIssuerExecutionAdapter();
  await assert.rejects(
    adapter.signCanonicalEnvelope({
      policyVersion: "shared-issuer-testnet-v1",
      issuerPublicKey: OWNER,
      network: "testnet",
      networkPassphrase: SHARED_ISSUER_TESTNET_PASSPHRASE,
      transactionHash: "0".repeat(64),
      unsignedEnvelopeXdr: "unused",
    }),
    SharedIssuerUnavailableError,
  );
  await assert.rejects(
    adapter.submitSignedEnvelope("unused"),
    SharedIssuerUnavailableError,
  );
  await assert.rejects(
    adapter.lookupTransaction("0".repeat(64)),
    SharedIssuerUnavailableError,
  );
});

test("API denies malformed supply, missing amount, and browser-chosen destination", async () => {
  let called = false;
  const deps = dependencies();
  deps.requestIssuance = async () => {
    called = true;
    throw new Error("must not run");
  };
  for (const payload of [
    { idempotencyKey: KEY, expectedAssetCode: "NOVA" },
    { ...VALID, initialSupply: 100 },
    { ...VALID, initialSupply: "1".repeat(41) },
    { ...VALID, destinationPublicKey: OWNER },
    { ...VALID, issuerPublicKey: OWNER },
    { ...VALID, ownerPublicKey: OWNER },
    { ...VALID, network: "public" },
  ]) {
    assert.equal(
      (await handleRequestIssuance(request(payload), CONTEXT, deps)).status,
      400,
    );
  }
  assert.equal(called, false);
});
