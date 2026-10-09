import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { after, before, test } from "node:test";

import { createDatabaseClient } from "../../lib/server/persistence/database";
import { migrateDatabase } from "../../lib/server/persistence/migrations";
import { PostgresProjectProfileRepository } from "../../lib/server/persistence/project-profile-repository";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL?.trim();

if (!TEST_DATABASE_URL) {
  test("project profile PostgreSQL suite", { skip: true }, () => {});
} else {
  const databaseUrl = TEST_DATABASE_URL;
  const sql = createDatabaseClient(databaseUrl);
  const migrationsDirectory = resolve(process.cwd(), "db/migrations");

  before(async () => {
    const databaseName = new URL(databaseUrl).pathname.slice(1);
    if (!/test/i.test(databaseName)) {
      throw new Error(
        "TEST_DATABASE_URL must point to a database whose name contains 'test'.",
      );
    }

    await sql.unsafe("DROP SCHEMA public CASCADE");
    await sql.unsafe("CREATE SCHEMA public");
    await migrateDatabase(sql, migrationsDirectory);
  });

  after(async () => {
    await sql.end({ timeout: 5 });
  });

  test("project profile persists identity separately from public and metadata locations", async () => {
    const repository = new PostgresProjectProfileRepository(sql);
    const now = Date.parse("2026-10-09T08:30:00.000Z");
    const projectId = randomUUID();

    await repository.create({
      projectId,
      slug: "nova",
      assetCode: "nova",
      displayName: "Nova",
      description: "A Stellar project managed with Orrylo.",
      metadataHome: "assets.orrylo.com",
      issuerModel: "shared",
      network: "testnet",
      publicStatus: "published",
      now,
    });

    const project = await repository.findPublishedBySlug("nova");

    assert.ok(project);
    assert.equal(project.projectId, projectId);
    assert.equal(project.slug, "nova");
    assert.equal(project.assetCode, "NOVA");
    assert.equal(project.metadataHome, "assets.orrylo.com");
    assert.notEqual(project.projectId, project.slug);
  });

  test("draft projects are not exposed through the public landing lookup", async () => {
    const repository = new PostgresProjectProfileRepository(sql);

    await repository.create({
      projectId: randomUUID(),
      slug: "private-draft",
      assetCode: "DRAFT",
      displayName: "Private Draft",
      issuerModel: "shared",
      network: "testnet",
      now: Date.parse("2026-10-09T08:31:00.000Z"),
    });

    assert.equal(await repository.findPublishedBySlug("private-draft"), null);
  });
}
