import assert from "node:assert/strict";
import { resolve } from "node:path";
import { after, beforeEach, test } from "node:test";

import { createDatabaseClient } from "../../lib/server/persistence/database";
import { migrateDatabase } from "../../lib/server/persistence/migrations";
import { PostgresMainnetCreationStore } from "../../lib/server/projects/mainnet-creation-store";
import {
  MAINNET_ISSUER,
  MAINNET_TREASURY,
} from "../../lib/server/projects/mainnet-token-orders";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL?.trim();
const PROJECT_ID = "10000000-0000-4000-8000-000000000016";
const ORDER_ID = "20000000-0000-4000-8000-000000000016";
const OWNER = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

function roleUrl(databaseUrl: string, role: string, password: string): string {
  const url = new URL(databaseUrl);
  url.username = role;
  url.password = password;
  return url.toString();
}

if (!TEST_DATABASE_URL) {
  test(
    "Mainnet issuance PostgreSQL concurrency suite",
    { skip: true },
    () => {},
  );
} else {
  const databaseUrl = TEST_DATABASE_URL;
  const admin = createDatabaseClient(databaseUrl);
  const appUrl = roleUrl(databaseUrl, "orrylo_app", "mainnet-app-test");

  beforeEach(async () => {
    if (!/test/i.test(new URL(databaseUrl).pathname.slice(1))) {
      throw new Error(
        "TEST_DATABASE_URL must identify an isolated test database.",
      );
    }
    await admin.unsafe("DROP SCHEMA public CASCADE");
    await admin.unsafe("CREATE SCHEMA public");
    await admin.unsafe(`
      DO $role$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'orrylo_app') THEN
          CREATE ROLE orrylo_app LOGIN PASSWORD 'mainnet-app-test';
        END IF;
      END;
      $role$;
      ALTER ROLE orrylo_app LOGIN PASSWORD 'mainnet-app-test';
      GRANT USAGE ON SCHEMA public TO orrylo_app;
    `);
    await migrateDatabase(admin, resolve(process.cwd(), "db/migrations"));
    await admin`
      INSERT INTO project_profiles (
        project_id, slug, asset_code, display_name, issuer_model, network,
        issuer_public_key, public_status, created_at, updated_at
      ) VALUES (
        ${PROJECT_ID}, 'mainnet-db-concurrency', 'DBCONCUR',
        'Mainnet DB Concurrency', 'shared', 'public', ${MAINNET_ISSUER},
        'draft', now(), now()
      )
    `;
    await admin`
      INSERT INTO mainnet_token_orders (
        order_id, project_id, owner_public_key, issuer_public_key,
        treasury_public_key, asset_code, destination_public_key,
        initial_supply, price_stroops, memo, state,
        payment_transaction_hash, payment_ledger, paid_at,
        created_at, expires_at, publication_status, updated_at
      ) VALUES (
        ${ORDER_ID}, ${PROJECT_ID}, ${OWNER}, ${MAINNET_ISSUER},
        ${MAINNET_TREASURY}, 'DBCONCUR', ${OWNER}, '1000.0000000',
        100000000, 'o000000000000000000000000016', 'trustline_confirmed',
        ${"c".repeat(64)}, 16, now(), now() - interval '1 minute',
        now() + interval '1 day', 'pending', now()
      )
    `;
  });

  after(async () => {
    await admin.end({ timeout: 5 });
  });

  test("concurrent issuance reservations and signing claims have one durable winner", async () => {
    const appA = createDatabaseClient(appUrl);
    const appB = createDatabaseClient(appUrl);
    try {
      const storeA = new PostgresMainnetCreationStore(appA);
      const storeB = new PostgresMainnetCreationStore(appB);
      const order = await storeA.getOwned(PROJECT_ID, OWNER);
      assert.ok(order);
      const transaction = {
        unsignedXdr: "acceptance-mainnet-xdr",
        unsignedXdrSha256: "d".repeat(64),
        transactionHash: "a".repeat(64),
        sourceSequence: "1",
        feeStroops: "100",
        validFrom: 1,
        validUntil: 301,
      };

      await Promise.all([
        storeA.reserveIssuance({
          order,
          attemptId: "30000000-0000-4000-8000-000000000016",
          transaction,
          now: Date.now(),
        }),
        storeB.reserveIssuance({
          order,
          attemptId: "40000000-0000-4000-8000-000000000016",
          transaction,
          now: Date.now(),
        }),
      ]);

      const [{ attempts }] = await admin<{ attempts: string }[]>`
        SELECT count(*)::text AS attempts
        FROM mainnet_issuance_attempts WHERE order_id = ${ORDER_ID}
      `;
      assert.equal(attempts, "1");

      const claims = await Promise.all([
        storeA.claimIssuanceForSigning({
          orderId: ORDER_ID,
          transactionHash: transaction.transactionHash,
          now: Date.now(),
        }),
        storeB.claimIssuanceForSigning({
          orderId: ORDER_ID,
          transactionHash: transaction.transactionHash,
          now: Date.now(),
        }),
      ]);
      assert.deepEqual(claims.sort(), [false, true]);

      const [state] = await admin<{ state: string; status: string }[]>`
        SELECT orders.state, attempts.status
        FROM mainnet_token_orders AS orders
        JOIN mainnet_issuance_attempts AS attempts USING (order_id)
        WHERE orders.order_id = ${ORDER_ID}
      `;
      assert.deepEqual(state, { state: "reconciling", status: "signing" });
    } finally {
      await Promise.all([appA.end({ timeout: 5 }), appB.end({ timeout: 5 })]);
    }
  });

  test("database policy rejects order-identity and prepared-XDR mutation", async () => {
    const app = createDatabaseClient(appUrl);
    try {
      await assert.rejects(app`
        UPDATE mainnet_token_orders SET treasury_public_key = ${OWNER}
        WHERE order_id = ${ORDER_ID}
      `);
      await assert.rejects(
        admin`
        UPDATE mainnet_token_orders SET asset_code = 'MUTATED'
        WHERE order_id = ${ORDER_ID}
      `,
        /immutable Mainnet order identity/,
      );

      const store = new PostgresMainnetCreationStore(app);
      const order = await store.getOwned(PROJECT_ID, OWNER);
      assert.ok(order);
      await store.reserveIssuance({
        order,
        attemptId: "50000000-0000-4000-8000-000000000016",
        transaction: {
          unsignedXdr: "immutable-xdr",
          unsignedXdrSha256: "e".repeat(64),
          transactionHash: "b".repeat(64),
          sourceSequence: "2",
          feeStroops: "100",
          validFrom: 1,
          validUntil: 301,
        },
        now: Date.now(),
      });
      await assert.rejects(app`
        UPDATE mainnet_issuance_attempts SET unsigned_xdr = 'tampered'
        WHERE order_id = ${ORDER_ID}
      `);
    } finally {
      await app.end({ timeout: 5 });
    }
  });
}
