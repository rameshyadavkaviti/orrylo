import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

test("package exposes a distinct read-only schema verification command", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  ) as { scripts: Record<string, string> };

  assert.equal(
    packageJson.scripts["db:verify"],
    "tsx scripts/verify-schema.ts",
  );
  assert.equal(
    packageJson.scripts["db:verify:read-only"],
    "tsx scripts/verify-schema-read-only.ts",
  );
});

test("read-only entrypoint exists without importing the migration helper", async () => {
  const entrypoint = new URL(
    "../scripts/verify-schema-read-only.ts",
    import.meta.url,
  );

  await assert.doesNotReject(access(entrypoint));
  const source = await readFile(entrypoint, "utf8");
  assert.doesNotMatch(source, /migrateDatabase|\.\/migrations/);
  assert.match(source, /verifyDatabaseSchemaReadOnly/);
  assert.match(source, /MIGRATION_DATABASE_URL/);
});

test("compatibility verifier remains migration-capable and reuses shared assertions", async () => {
  const source = await readFile(
    new URL("../scripts/verify-schema.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /migrateDatabase/);
  assert.match(source, /verifyDatabaseSchemaReadOnly/);
});

test("shared schema inspector exists without migration or mutating SQL dependencies", async () => {
  const inspector = new URL(
    "../lib/server/persistence/schema-verification.ts",
    import.meta.url,
  );

  await assert.doesNotReject(access(inspector));
  const source = await readFile(inspector, "utf8");
  assert.doesNotMatch(source, /migrateDatabase/);
  const sqlTemplates = [...source.matchAll(/`([\s\S]*?)`/g)]
    .map((match) => match[1])
    .join("\n");
  assert.doesNotMatch(
    sqlTemplates,
    /^\s*(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|GRANT|REVOKE)\b/im,
  );
});

test("SAFE READ-ONLY activation steps reference only the inspection-only schema command", async () => {
  const runbook = await readFile(
    new URL("../../docs/TESTNET_MVP_ACTIVATION_RUNBOOK.md", import.meta.url),
    "utf8",
  );
  const safeReadOnlyRows = runbook
    .split("\n")
    .filter((line) => /\|\s*SAFE READ-ONLY\s*\|/.test(line));
  const schemaRow = safeReadOnlyRows.find((line) => /^\|\s*10\s*\|/.test(line));
  const migrationRow = runbook
    .split("\n")
    .find((line) => /^\|\s*7\s*\|/.test(line));

  assert.match(schemaRow ?? "", /npm run db:verify:read-only/);
  assert.match(
    runbook,
    /export MIGRATION_DATABASE_URL='postgres:\/\/MIGRATION_OWNER:\.\.\.'/,
  );
  assert.doesNotMatch(
    safeReadOnlyRows.join("\n"),
    /npm run db:migrate|npm run db:verify(?:`|\s)/,
  );
  assert.match(migrationRow ?? "", /npm run db:migrate/);
  assert.match(
    migrationRow ?? "",
    /AUTOMATED LIVE ACTION requiring explicit authorization/,
  );
});

test("README labels compatibility verification as mutating and documents the read-only command", async () => {
  const readme = await readFile(
    new URL("../README.md", import.meta.url),
    "utf8",
  );

  assert.match(readme, /`npm run db:verify`[\s\S]{0,160}migration-capable/i);
  assert.match(readme, /`npm run db:verify:read-only`[\s\S]{0,160}read-only/i);
  assert.match(readme, /npm run db:verify:read-only/);
});

test("CI verifies the migrated schema through the read-only command", async () => {
  const workflow = await readFile(
    new URL("../../.github/workflows/web.yml", import.meta.url),
    "utf8",
  );

  assert.match(
    workflow,
    /- name: Verify schema read-only\s+run: npm run db:verify:read-only/,
  );
});
