import assert from "node:assert/strict";
import test from "node:test";

import { Keypair, Networks } from "@stellar/stellar-sdk";

import {
  KNOWN_RYLO_ISSUER_PUBLIC_KEYS,
  SHARED_ISSUER_CANDIDATE,
} from "../lib/product/constants";
import {
  TestnetActivationVerificationError,
  verifyTestnetActivationReadiness,
  type TestnetActivationDatabaseReport,
} from "../lib/server/projects/testnet-activation-verifier";
import { SHARED_ISSUER_TESTNET_PASSPHRASE } from "../lib/stellar/shared-issuer-issuance";
import type { SharedIssuerTestnetPreflightResult } from "../lib/stellar/shared-issuer-testnet-preflight";

const ISSUER = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 131)).publicKey();
const DESTINATION = Keypair.fromRawEd25519Seed(
  Buffer.alloc(32, 132),
).publicKey();

const DATABASE_REPORT: TestnetActivationDatabaseReport = {
  applicationRole: "orrylo_app",
  confirmationWriterRole: "orrylo_confirmation_login",
  applicationCanInsertConfirmation: false,
  confirmationWriterCanInsertConfirmation: true,
  confirmationWriterCanReadIntentAndAttempt: true,
};

function preflight(
  overrides: Partial<
    SharedIssuerTestnetPreflightResult["preconditions"]["destinationTrustline"]
  > = {},
): SharedIssuerTestnetPreflightResult {
  return {
    network: "testnet",
    networkPassphrase: SHARED_ISSUER_TESTNET_PASSPHRASE,
    observedLedger: 500,
    observedLedgerClosedAt: "2026-10-13T13:00:00.000Z",
    baseFeeStroops: "100",
    baseReserveStroops: "5000000",
    preconditions: {
      assetCodeReservedForProject: true,
      issuerSequence: "123456",
      issuerSpendableNativeStroops: "25000000",
      feeStroops: "100",
      destinationTrustline: {
        network: "testnet",
        networkPassphrase: Networks.TESTNET,
        destinationPublicKey: DESTINATION,
        assetCode: "NOVA",
        issuerPublicKey: ISSUER,
        observedLedger: 500,
        exists: true,
        authorized: true,
        balance: "0.0000000",
        limit: "1000.0000000",
        buyingLiabilities: "0.0000000",
        ...overrides,
      },
    },
  };
}

function dependencies(result = preflight()) {
  let preflightCalls = 0;
  let databaseCalls = 0;
  return {
    deps: {
      async readPreflight() {
        preflightCalls += 1;
        return result;
      },
      async verifyDatabaseBoundaries() {
        databaseCalls += 1;
        return DATABASE_REPORT;
      },
    },
    counts: () => ({ preflightCalls, databaseCalls }),
  };
}

const INPUT = {
  issuerPublicKey: ISSUER,
  destinationPublicKey: DESTINATION,
  assetCode: "NOVA",
  amount: "25",
  feeStroops: "100",
};

test("read-only activation verifier proves stable account, trustline capacity, fee, and DB boundaries", async () => {
  const fx = dependencies();
  const report = await verifyTestnetActivationReadiness(INPUT, fx.deps);

  assert.equal(report.readOnly, true);
  assert.equal(report.network, "testnet");
  assert.equal(report.issuer.publicKey, ISSUER);
  assert.equal(report.issuer.policyVerified, true);
  assert.equal(report.issuer.currentSequence, "123456");
  assert.equal(report.issuer.spendableNativeStroops, "25000000");
  assert.equal(report.destination.publicKey, DESTINATION);
  assert.equal(report.destination.amount, "25.0000000");
  assert.equal(report.destination.capacityVerified, true);
  assert.deepEqual(report.database, DATABASE_REPORT);
  assert.deepEqual(fx.counts(), { preflightCalls: 1, databaseCalls: 1 });
});

test("every known RYLO issuer fails before Horizon or database access", async () => {
  for (const issuerPublicKey of KNOWN_RYLO_ISSUER_PUBLIC_KEYS) {
    const fx = dependencies();
    await assert.rejects(
      verifyTestnetActivationReadiness({ ...INPUT, issuerPublicKey }, fx.deps),
      (error: unknown) =>
        error instanceof TestnetActivationVerificationError &&
        error.code === "known_rylo_issuer",
      issuerPublicKey,
    );
    assert.deepEqual(fx.counts(), { preflightCalls: 0, databaseCalls: 0 });
  }
});

test("reserved Shared Issuer candidate fails before Horizon or database access", async () => {
  const fx = dependencies();
  await assert.rejects(
    verifyTestnetActivationReadiness(
      { ...INPUT, issuerPublicKey: SHARED_ISSUER_CANDIDATE },
      fx.deps,
    ),
    (error: unknown) =>
      error instanceof TestnetActivationVerificationError &&
      error.code === "reserved_shared_issuer_candidate",
  );
  assert.deepEqual(fx.counts(), { preflightCalls: 0, databaseCalls: 0 });
});

test("missing trustline and insufficient capacity fail before database validation", async () => {
  for (const result of [
    preflight({ exists: false, authorized: false, limit: "0.0000000" }),
    preflight({ limit: "20.0000000" }),
  ]) {
    const fx = dependencies(result);
    await assert.rejects(verifyTestnetActivationReadiness(INPUT, fx.deps));
    assert.deepEqual(fx.counts(), { preflightCalls: 1, databaseCalls: 0 });
  }
});

test("database boundary failure fails the read-only activation verifier closed", async () => {
  let databaseCalls = 0;
  await assert.rejects(
    verifyTestnetActivationReadiness(INPUT, {
      async readPreflight() {
        return preflight();
      },
      async verifyDatabaseBoundaries() {
        databaseCalls += 1;
        throw new TestnetActivationVerificationError(
          "database_privilege_mismatch",
          "writer unavailable",
        );
      },
    }),
    (error: unknown) =>
      error instanceof TestnetActivationVerificationError &&
      error.code === "database_privilege_mismatch",
  );
  assert.equal(databaseCalls, 1);
});
