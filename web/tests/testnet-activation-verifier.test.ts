import assert from "node:assert/strict";
import test from "node:test";

import { Keypair, Networks } from "@stellar/stellar-sdk";

import {
  KNOWN_RYLO_ISSUER_PUBLIC_KEYS,
  SHARED_ISSUER_CANDIDATE,
} from "../lib/product/constants";
import {
  TestnetActivationVerificationError,
  verifyTestnetActivationDatabaseBoundaries,
  verifyTestnetActivationReadiness,
  type TestnetActivationDatabaseReport,
} from "../lib/server/projects/testnet-activation-verifier";
import type { DatabaseClient } from "../lib/server/persistence/database";
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
  confirmationWriterCanReadConfirmation: true,
  confirmationWriterCanReadIntentAndAttempt: true,
  applicationCanSetRoleToSensitiveOwner: false,
  confirmationWriterCanSetRoleToSensitiveOwner: false,
  applicationReadOnlyTransactionVerified: true,
  confirmationWriterReadOnlyTransactionVerified: true,
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

test("confirmation writer forbidden evidence write authority fails closed", async () => {
  const forbiddenPrivileges = [
    "canInsertFullIntent",
    "canUpdateFullIntent",
    "canDeleteFullIntent",
    "canTruncateFullIntent",
    "canUpdateAnyFullIntentColumn",
    "canInsertAttempt",
    "canUpdateAttempt",
    "canDeleteAttempt",
    "canTruncateAttempt",
    "canUpdateAnyAttemptColumn",
  ] as const;

  for (const forbiddenPrivilege of forbiddenPrivileges) {
    const application = activationDatabase({
      roleName: "orrylo_app",
      isConfirmationWriter: false,
      canInsertConfirmation: false,
      transactionReadOnly: true,
    });
    const writer = activationDatabase({
      roleName: "orrylo_confirmation_login",
      isConfirmationWriter: true,
      canInsertConfirmation: true,
      transactionReadOnly: true,
      [forbiddenPrivilege]: true,
    });

    await assert.rejects(
      verifyTestnetActivationDatabaseBoundaries(
        application.database,
        writer.database,
      ),
      (error: unknown) =>
        error instanceof TestnetActivationVerificationError &&
        error.code === "database_privilege_mismatch",
      forbiddenPrivilege,
    );
  }
});

test("confirmation writer must retain confirmation SELECT authority", async () => {
  const application = activationDatabase({
    roleName: "orrylo_app",
    isConfirmationWriter: false,
    canInsertConfirmation: false,
    transactionReadOnly: true,
  });
  const writer = activationDatabase({
    roleName: "orrylo_confirmation_login",
    isConfirmationWriter: true,
    canInsertConfirmation: true,
    canReadConfirmation: false,
    transactionReadOnly: true,
  });

  await assert.rejects(
    verifyTestnetActivationDatabaseBoundaries(
      application.database,
      writer.database,
    ),
    (error: unknown) =>
      error instanceof TestnetActivationVerificationError &&
      error.code === "database_privilege_mismatch",
  );
});

test("database boundary inspection requires PostgreSQL to confirm READ ONLY transactions", async () => {
  const application = activationDatabase({
    roleName: "orrylo_app",
    isConfirmationWriter: false,
    canInsertConfirmation: false,
    transactionReadOnly: false,
  });
  const writer = activationDatabase({
    roleName: "orrylo_confirmation_login",
    isConfirmationWriter: true,
    canInsertConfirmation: true,
    transactionReadOnly: true,
  });

  await assert.rejects(
    verifyTestnetActivationDatabaseBoundaries(
      application.database,
      writer.database,
    ),
    (error: unknown) =>
      error instanceof TestnetActivationVerificationError &&
      error.code === "database_privilege_mismatch" &&
      /READ ONLY/.test(error.message),
  );
  assert.deepEqual(application.transactionModes, ["read only"]);
  assert.deepEqual(writer.transactionModes, ["read only"]);
  assert.ok(
    [...application.queries, ...writer.queries].every((query) =>
      /^(?:WITH|SELECT)\b/.test(query),
    ),
  );
});

function activationDatabase(input: {
  roleName: string;
  isConfirmationWriter: boolean;
  canInsertConfirmation: boolean;
  canReadConfirmation?: boolean;
  canInsertFullIntent?: boolean;
  canUpdateFullIntent?: boolean;
  canDeleteFullIntent?: boolean;
  canTruncateFullIntent?: boolean;
  canUpdateAnyFullIntentColumn?: boolean;
  canInsertAttempt?: boolean;
  canUpdateAttempt?: boolean;
  canDeleteAttempt?: boolean;
  canTruncateAttempt?: boolean;
  canUpdateAnyAttemptColumn?: boolean;
  transactionReadOnly: boolean;
}) {
  const transactionModes: string[] = [];
  const queries: string[] = [];
  const transaction = async (template: TemplateStringsArray) => {
    const query = template.join("?").replace(/\s+/g, " ").trim();
    queries.push(query);
    if (query.startsWith("WITH protected_namespace")) {
      return [
        {
          role_name: input.roleName,
          is_superuser: false,
          is_confirmation_writer: input.isConfirmationWriter,
          protected_namespace_count: 1,
          protected_table_count: 5,
          protected_function_count: 8,
          owns_sensitive_schema: false,
          owns_sensitive_table: false,
          owns_sensitive_function: false,
          can_set_role_to_sensitive_owner: false,
          can_use_sensitive_owner: false,
          can_administer_sensitive_owner: false,
          can_administer_any_role: false,
        },
      ];
    }
    if (query.startsWith("SELECT")) {
      return [
        {
          role_name: input.roleName,
          can_insert_confirmation: input.canInsertConfirmation,
          can_read_confirmation:
            input.canReadConfirmation ?? input.isConfirmationWriter,
          can_read_full_intent: input.isConfirmationWriter,
          can_read_attempt: input.isConfirmationWriter,
          can_insert_full_intent: input.canInsertFullIntent ?? false,
          can_update_full_intent: input.canUpdateFullIntent ?? false,
          can_delete_full_intent: input.canDeleteFullIntent ?? false,
          can_truncate_full_intent: input.canTruncateFullIntent ?? false,
          can_update_any_full_intent_column:
            input.canUpdateAnyFullIntentColumn ?? false,
          can_insert_attempt: input.canInsertAttempt ?? false,
          can_update_attempt: input.canUpdateAttempt ?? false,
          can_delete_attempt: input.canDeleteAttempt ?? false,
          can_truncate_attempt: input.canTruncateAttempt ?? false,
          can_update_any_attempt_column:
            input.canUpdateAnyAttemptColumn ?? false,
          transaction_read_only: input.transactionReadOnly,
        },
      ];
    }
    throw new Error(`Unexpected database inspection query: ${query}`);
  };
  const database = {
    async begin(
      mode: string,
      callback: (sql: typeof transaction) => Promise<unknown>,
    ) {
      transactionModes.push(mode);
      return callback(transaction);
    },
  } as unknown as DatabaseClient;
  return { database, transactionModes, queries };
}
