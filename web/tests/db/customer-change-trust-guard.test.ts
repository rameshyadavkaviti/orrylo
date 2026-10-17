import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { before, after, beforeEach, test } from "node:test";
import {
  Account,
  Asset,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { createDatabaseClient } from "../../lib/server/persistence/database";
import { migrateDatabase } from "../../lib/server/persistence/migrations";
import { verifyDatabaseSchemaReadOnly } from "../../lib/server/persistence/schema-verification";
import { ManagedProjectService } from "../../lib/server/projects/managed-project-service";
import {
  PostgresCustomerTrustlineGuard,
  PostgresCustomerTrustlineResolutionWriter,
} from "../../lib/server/projects/customer-trustline-guard";
import type { CustomerTrustlinePlan } from "../../lib/server/projects/customer-testnet-trustline";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL?.trim();
const ISSUER = "GBW4IKGPC5Q4YRKGRMNNXTVRZNQZ3DFWFHXSQUAMWLXES75MWTY3TWOV";
const OWNER = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 213)).publicKey();

function roleUrl(base: string, role: string, password: string) {
  const url = new URL(base);
  url.username = role;
  url.password = password;
  return url.toString();
}

if (!TEST_DATABASE_URL) {
  test(
    "customer ChangeTrust interlock PostgreSQL suite",
    { skip: true },
    () => {},
  );
} else {
  const admin = createDatabaseClient(TEST_DATABASE_URL);
  const appA = createDatabaseClient(
    roleUrl(TEST_DATABASE_URL, "orrylo_app", "trustline-app-test"),
  );
  const appB = createDatabaseClient(
    roleUrl(TEST_DATABASE_URL, "orrylo_app", "trustline-app-test"),
  );
  const writerClient = createDatabaseClient(
    roleUrl(
      TEST_DATABASE_URL,
      "orrylo_trustline_writer_test",
      "trustline-writer-test",
    ),
  );
  const first = new PostgresCustomerTrustlineGuard(appA);
  const second = new PostgresCustomerTrustlineGuard(appB);
  const writer = new PostgresCustomerTrustlineResolutionWriter(writerClient);
  let projectId = "";

  before(async () => {
    if (!/test/i.test(new URL(TEST_DATABASE_URL).pathname.slice(1)))
      throw new Error("Test DB only.");
    await admin.unsafe("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
    await admin.unsafe(`
      DO $do$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'orrylo_app') THEN
          CREATE ROLE orrylo_app LOGIN PASSWORD 'trustline-app-test';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'orrylo_trustline_writer_test') THEN
          CREATE ROLE orrylo_trustline_writer_test LOGIN PASSWORD 'trustline-writer-test';
        END IF;
      END $do$;
      ALTER ROLE orrylo_app LOGIN PASSWORD 'trustline-app-test';
      ALTER ROLE orrylo_trustline_writer_test LOGIN PASSWORD 'trustline-writer-test';
    `);
    await migrateDatabase(admin, resolve(process.cwd(), "db/migrations"));
    await admin.unsafe(`
      REVOKE orrylo_confirmation_writer FROM orrylo_app;
      GRANT orrylo_confirmation_writer TO orrylo_trustline_writer_test;
      GRANT USAGE ON SCHEMA public TO orrylo_app, orrylo_trustline_writer_test;
      GRANT SELECT ON public.project_profiles, public.project_profile_owners TO orrylo_app;
      GRANT UPDATE (signed_envelope_xdr_sha256) ON TABLE
        public.project_issuance_transaction_attempts TO orrylo_app;
    `);
  });

  beforeEach(async () => {
    await admin.unsafe(`
      TRUNCATE project_customer_change_trust_resolutions,
        project_customer_change_trust_handoffs, project_issuance_ledger_confirmations,
        project_issuance_transaction_attempts, project_issuance_full_intents,
        project_issuance_intents, project_profile_owners, project_profiles,
        workflow_intents, audit_events CASCADE
    `);
    await admin`UPDATE audit_chain_heads SET last_sequence = 0,
      last_event_hash = NULL WHERE chain_id = 'application'`;
    const project = await new ManagedProjectService(admin, {
      network: "testnet",
    }).createManagedProject({
      ownerPublicKey: OWNER,
      idempotencyKey: randomUUID(),
      code: "TCROSS",
      displayName: "Cross Browser Trustline",
      description: "Durable ChangeTrust fixture",
    });
    projectId = project.project.projectId;
  });

  after(async () => {
    await Promise.all([
      appA.end({ timeout: 5 }),
      appB.end({ timeout: 5 }),
      writerClient.end({ timeout: 5 }),
      admin.end({ timeout: 5 }),
    ]);
  });

  function plan(sequence: string): CustomerTrustlinePlan {
    const now = Math.floor(Date.now() / 1000);
    const tx = new TransactionBuilder(new Account(OWNER, sequence), {
      fee: "100",
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(
        Operation.changeTrust({
          asset: new Asset("TCROSS", ISSUER),
          limit: "250.0000000",
        }),
      )
      .setTimebounds(now, now + 300)
      .build();
    return {
      status: "signature_required",
      network: "testnet",
      issuerPublicKey: ISSUER,
      destinationPublicKey: OWNER,
      assetCode: "TCROSS",
      amount: "250",
      issuerFeeStroops: "100",
      customerFeeStroops: "100",
      customerFeeCapStroops: "200",
      additionalReserveStroops: "5000000",
      unsignedXdr: tx.toXDR(),
      transactionHash: Buffer.from(tx.hash()).toString("hex"),
      validUntil: now + 300,
    };
  }

  test("concurrent authenticated browsers receive exactly one signable plan", async () => {
    const [a, b] = await Promise.all([
      first.reserve({ projectId, ownerPublicKey: OWNER, plan: plan("123") }),
      second.reserve({ projectId, ownerPublicKey: OWNER, plan: plan("124") }),
    ]);
    assert.deepEqual([a.status, b.status].sort(), ["claimed", "pending"]);
    const claimed = a.status === "claimed" ? a : b;
    const pending = a.status === "pending" ? a : b;
    if (claimed.status !== "claimed" || pending.status !== "pending") {
      throw new Error("Expected exactly one signable plan.");
    }
    assert.equal(pending.transactionHash, claimed.plan.transactionHash);
    const [{ total }] = await admin<{ total: number }[]>`
      SELECT count(*)::integer AS total FROM project_customer_change_trust_handoffs
    `;
    assert.equal(total, 1);
  });

  test("unresolved hash persists across other sessions and new proposed XDR", async () => {
    const original = plan("123");
    assert.equal(
      (
        await first.reserve({
          projectId,
          ownerPublicKey: OWNER,
          plan: original,
        })
      ).status,
      "claimed",
    );
    assert.equal(
      (await second.latest(projectId, OWNER))?.transactionHash,
      original.transactionHash,
    );
    const next = await second.reserve({
      projectId,
      ownerPublicKey: OWNER,
      plan: plan("124"),
    });
    assert.deepEqual(next, {
      status: "pending",
      transactionHash: original.transactionHash,
    });
  });

  test("app direct SQL cannot modify guard or forge reconciliation; failed exact hash may release", async () => {
    assert.equal(
      (
        await first.reserve({
          projectId,
          ownerPublicKey: OWNER,
          plan: plan("123"),
        })
      ).status,
      "claimed",
    );
    const handoff = await first.latest(projectId, OWNER);
    assert.ok(handoff);
    await assert.rejects(appA`
      DELETE FROM public.project_customer_change_trust_handoffs
      WHERE handoff_id = ${handoff.handoffId}::uuid
    `);
    await assert.rejects(appA`
      UPDATE public.project_customer_change_trust_handoffs
      SET valid_until = now() - interval '1 hour'
      WHERE handoff_id = ${handoff.handoffId}::uuid
    `);
    await assert.rejects(appA`
      INSERT INTO public.project_customer_change_trust_resolutions(
        handoff_id, transaction_hash, resolution, observed_ledger,
        observed_ledger_closed_at
      ) VALUES (${handoff.handoffId}::uuid, ${handoff.transactionHash},
        'failed', 901, now())
    `);
    assert.equal(
      (
        await second.reserve({
          projectId,
          ownerPublicKey: OWNER,
          plan: plan("124"),
        })
      ).status,
      "pending",
    );
    await writer.terminal({
      handoff,
      kind: "failed",
      observedLedger: 901,
      observedLedgerClosedAt: new Date().toISOString(),
    });
    assert.equal(
      (
        await second.reserve({
          projectId,
          ownerPublicKey: OWNER,
          plan: plan("124"),
        })
      ).status,
      "claimed",
    );
    const [{ handoffs, resolutions }] = await admin<
      { handoffs: number; resolutions: number }[]
    >`
      SELECT
        (SELECT count(*)::integer FROM project_customer_change_trust_handoffs) AS handoffs,
        (SELECT count(*)::integer FROM project_customer_change_trust_resolutions) AS resolutions
    `;
    assert.equal(handoffs, 2);
    assert.equal(resolutions, 1);
  });

  test("trusted exact-hash ready evidence durably releases the old amount before replanning", async () => {
    assert.equal(
      (
        await first.reserve({
          projectId,
          ownerPublicKey: OWNER,
          plan: plan("123"),
        })
      ).status,
      "claimed",
    );
    const handoff = await first.latest(projectId, OWNER);
    assert.ok(handoff);
    assert.equal(
      (await second.unresolved(projectId, OWNER))?.handoffId,
      handoff.handoffId,
    );
    await writer.terminal({
      handoff,
      kind: "ready",
      observedLedger: 901,
      observedLedgerClosedAt: new Date().toISOString(),
    });
    assert.equal(await second.unresolved(projectId, OWNER), null);
    assert.equal(
      (
        await second.reserve({
          projectId,
          ownerPublicKey: OWNER,
          plan: plan("124"),
        })
      ).status,
      "claimed",
    );
    assert.equal((await first.latest(projectId, OWNER))?.resolution, null);
  });

  test("historical hash lookup remains stable after a later handoff", async () => {
    const old = plan("123");
    assert.equal(
      (
        await first.reserve({
          projectId,
          ownerPublicKey: OWNER,
          plan: old,
        })
      ).status,
      "claimed",
    );
    const oldRow = await first.byHash(projectId, OWNER, old.transactionHash!);
    assert.ok(oldRow);
    await writer.terminal({
      handoff: oldRow,
      kind: "failed",
      observedLedger: 901,
      observedLedgerClosedAt: new Date().toISOString(),
    });

    const next = plan("124");
    assert.equal(
      (
        await second.reserve({
          projectId,
          ownerPublicKey: OWNER,
          plan: next,
        })
      ).status,
      "claimed",
    );
    const historical = await first.byHash(
      projectId,
      OWNER,
      old.transactionHash!,
    );
    const latest = await first.latest(projectId, OWNER);
    assert.equal(historical?.handoffId, oldRow.handoffId);
    assert.equal(historical?.transactionHash, old.transactionHash);
    assert.equal(historical?.amount, "250");
    assert.equal(historical?.resolution, "failed");
    assert.equal(latest?.transactionHash, next.transactionHash);
    assert.equal(latest?.resolution, null);
    assert.equal(
      (await second.unresolved(projectId, OWNER))?.transactionHash,
      next.transactionHash,
    );
    assert.equal(await second.byHash(projectId, OWNER, "f".repeat(64)), null);
    const alien = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 214)).publicKey();
    assert.equal(
      await second.byHash(projectId, alien, old.transactionHash!),
      null,
    );
  });

  test("post-expiry not-found proof requires later ledger and unchanged account sequence", async () => {
    await first.reserve({
      projectId,
      ownerPublicKey: OWNER,
      plan: plan("123"),
    });
    const handoff = await second.latest(projectId, OWNER);
    assert.ok(handoff);
    await assert.rejects(
      writer.terminal({
        handoff,
        kind: "expired_not_found",
        observedLedger: 902,
        observedLedgerClosedAt: new Date(
          handoff.validUntil * 1000 - 1000,
        ).toISOString(),
        observedSourceSequence: handoff.sourceSequence,
      }),
    );
    await assert.rejects(
      writer.terminal({
        handoff,
        kind: "expired_not_found",
        observedLedger: 902,
        observedLedgerClosedAt: new Date(
          handoff.validUntil * 1000 + 1000,
        ).toISOString(),
        observedSourceSequence: "999",
      }),
    );
    assert.equal(
      (
        await second.reserve({
          projectId,
          ownerPublicKey: OWNER,
          plan: plan("124"),
        })
      ).status,
      "pending",
    );
    await writer.terminal({
      handoff,
      kind: "expired_not_found",
      observedLedger: 903,
      observedLedgerClosedAt: new Date(
        handoff.validUntil * 1000 + 1000,
      ).toISOString(),
      observedSourceSequence: handoff.sourceSequence,
    });
    assert.equal(
      (
        await second.reserve({
          projectId,
          ownerPublicKey: OWNER,
          plan: plan("124"),
        })
      ).status,
      "claimed",
    );
  });

  test("forged owner fails claim; read-only schema verifier validates safe privileges", async () => {
    const badOwner = Keypair.fromRawEd25519Seed(
      Buffer.alloc(32, 214),
    ).publicKey();
    await assert.rejects(
      first.reserve({
        projectId,
        ownerPublicKey: badOwner,
        plan: { ...plan("123"), destinationPublicKey: badOwner },
      }),
    );
    await verifyDatabaseSchemaReadOnly(
      admin,
      resolve(process.cwd(), "db/migrations"),
    );
  });
}
