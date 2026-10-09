import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { after, before, beforeEach, test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { Keypair } from "@stellar/stellar-sdk/base";
import { NextRequest } from "next/server";

import {
  handleCreateManagedProject,
  type CreateProjectRouteDependencies,
} from "../../app/api/projects/route";

import { ProjectLandingPage } from "../../components/project-landing-page";
import { createDatabaseClient } from "../../lib/server/persistence/database";
import { migrateDatabase } from "../../lib/server/persistence/migrations";
import { PostgresProjectProfileRepository } from "../../lib/server/persistence/project-profile-repository";
import {
  ManagedProjectCreationError,
  ManagedProjectService,
} from "../../lib/server/projects/managed-project-service";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL?.trim();

if (!TEST_DATABASE_URL) {
  test("project profile PostgreSQL suite", { skip: true }, () => {});
} else {
  const databaseUrl = TEST_DATABASE_URL;
  const sql = createDatabaseClient(databaseUrl);
  const migrationsDirectory = resolve(process.cwd(), "db/migrations");
  const OWNER = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 51)).publicKey();
  const OTHER = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 52)).publicKey();
  const NOW = Date.parse("2026-10-09T08:30:00.000Z");

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

  beforeEach(async () => {
    await sql.unsafe(
      "TRUNCATE project_profile_owners, project_profiles, workflow_intents CASCADE",
    );
  });

  after(async () => {
    await sql.end({ timeout: 5 });
  });

  test("project profile persists identity separately from public and metadata locations", async () => {
    const repository = new PostgresProjectProfileRepository(sql);
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
      now: NOW,
    });

    const project = await repository.findPublishedBySlug("nova");

    assert.ok(project);
    assert.equal(project.projectId, projectId);
    assert.equal(project.slug, "nova");
    assert.equal(project.assetCode, "NOVA");
    assert.equal(project.metadataHome, "assets.orrylo.com");
    assert.notEqual(project.projectId, project.slug);
  });

  test("authenticated project creation persists owner and a private managed profile", async () => {
    const service = new ManagedProjectService(sql, {
      network: "testnet",
      now: () => NOW,
    });
    const result = await service.createManagedProject({
      ownerPublicKey: OWNER,
      idempotencyKey: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      code: "nova",
      displayName: "Nova Community",
      description: "A managed Stellar project.",
    });

    assert.equal(result.created, true);
    assert.equal(result.project.ownerPublicKey, OWNER);
    assert.equal(result.project.assetCode, "NOVA");
    assert.equal(result.project.slug, "nova-community");
    assert.equal(result.project.publicStatus, "draft");
    assert.equal(result.project.logoUrl, null);
    assert.equal(result.project.metadataHome, "assets.orrylo.com");
    assert.notEqual(result.project.projectId, result.project.slug);

    const repository = new PostgresProjectProfileRepository(sql);
    assert.equal(
      await repository.findPublishedBySlug(result.project.slug),
      null,
    );
    assert.equal(
      (await repository.findOwnedById(result.project.projectId, OWNER))
        ?.projectId,
      result.project.projectId,
    );
  });

  test("only the owner can update presentation metadata without changing project identity or metadata host", async () => {
    const service = new ManagedProjectService(sql, {
      network: "testnet",
      now: () => NOW,
    });
    const repository = new PostgresProjectProfileRepository(sql);
    const created = await service.createManagedProject({
      ownerPublicKey: OWNER,
      idempotencyKey: "acacacac-acac-4cac-8cac-acacacacacac",
      code: "NOVA",
      displayName: "Nova",
      description: "Original metadata.",
    });

    const rejected = await repository.updateOwnedMetadata(
      created.project.projectId,
      OTHER,
      {
        displayName: "Hijacked",
        description: "Must not persist.",
        logoUrl: "https://evil.example/logo.png",
        websiteUrl: null,
        communityUrl: null,
      },
      NOW + 1,
    );

    assert.equal(rejected, null);

    const unchanged = await repository.findOwnedById(
      created.project.projectId,
      OWNER,
    );
    assert.ok(unchanged);
    assert.equal(unchanged.displayName, "Nova");
    assert.equal(unchanged.logoUrl, null);

    const updated = await repository.updateOwnedMetadata(
      created.project.projectId,
      OWNER,
      {
        displayName: "Nova Network",
        description: "Updated managed metadata.",
        logoUrl: "https://cdn.example.com/nova.png",
        websiteUrl: "https://example.com/",
        communityUrl: "https://community.example.com/nova",
      },
      NOW + 2,
    );

    assert.ok(updated);
    assert.equal(updated.displayName, "Nova Network");
    assert.equal(updated.description, "Updated managed metadata.");
    assert.equal(updated.logoUrl, "https://cdn.example.com/nova.png");
    assert.equal(updated.projectId, created.project.projectId);
    assert.equal(updated.slug, created.project.slug);
    assert.equal(updated.assetCode, created.project.assetCode);
    assert.equal(updated.metadataHome, "assets.orrylo.com");
    assert.equal(updated.issuerPublicKey, null);

    await repository.publishOwned(created.project.projectId, OWNER, NOW + 3);
    const publicProject = await repository.findPublishedBySlug(
      created.project.slug,
    );

    assert.ok(publicProject);
    assert.equal(publicProject.projectId, created.project.projectId);
    assert.equal(publicProject.displayName, "Nova Network");
    assert.equal(publicProject.websiteUrl, "https://example.com/");
    assert.equal(publicProject.metadataHome, "assets.orrylo.com");

    const html = renderToStaticMarkup(
      ProjectLandingPage({ project: publicProject }),
    );
    assert.match(html, /Nova Network/);
    assert.match(html, /Updated managed metadata/);
    assert.match(html, /https:\/\/example\.com\//);
  });

  test("wallet-session mismatch has zero project side effects and restored wallet A reuses the logical save", async () => {
    const service = new ManagedProjectService(sql, {
      network: "testnet",
      now: () => NOW,
    });
    const idempotencyKey = "abababab-abab-4bab-8bab-abababababab";
    const body = {
      idempotencyKey,
      code: "NOVA",
      displayName: "Nova Continuity",
      description: "Frozen after wallet A authentication.",
      authenticatedWalletAssertion: OWNER,
    };

    function request() {
      return new NextRequest("https://app.orrylo.com/api/projects", {
        method: "POST",
        headers: {
          Origin: "https://app.orrylo.com",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
    }

    function dependencies(
      sessionPublicKey: string,
    ): CreateProjectRouteDependencies {
      return {
        authDomain: "app.orrylo.com",
        getSession: async () => ({
          publicKey: sessionPublicKey,
          createdAt: NOW,
          expiresAt: NOW + 60_000,
        }),
        createProject: (ownerPublicKey, input) =>
          service.createManagedProject({ ownerPublicKey, ...input }),
      };
    }

    const mismatched = await handleCreateManagedProject(
      request(),
      dependencies(OTHER),
    );

    assert.equal(mismatched.status, 409);
    assert.deepEqual(await mismatched.json(), {
      ok: false,
      code: "wallet_session_changed",
    });

    const [{ projectsAfterMismatch }] = await sql<
      { projectsAfterMismatch: string }[]
    >`
      SELECT count(*)::text AS "projectsAfterMismatch"
      FROM project_profiles
    `;
    const [{ ownersAfterMismatch }] = await sql<
      { ownersAfterMismatch: string }[]
    >`
      SELECT count(*)::text AS "ownersAfterMismatch"
      FROM project_profile_owners
    `;
    const [{ workflowsAfterMismatch }] = await sql<
      { workflowsAfterMismatch: string }[]
    >`
      SELECT count(*)::text AS "workflowsAfterMismatch"
      FROM workflow_intents
      WHERE workflow_scope = 'project:managed-create'
    `;

    assert.equal(projectsAfterMismatch, "0");
    assert.equal(ownersAfterMismatch, "0");
    assert.equal(workflowsAfterMismatch, "0");

    const restored = await handleCreateManagedProject(
      request(),
      dependencies(OWNER),
    );
    const restoredPayload = await restored.json();

    assert.equal(restored.status, 201);
    assert.equal(restoredPayload.ok, true);

    const retried = await handleCreateManagedProject(
      request(),
      dependencies(OWNER),
    );
    const retriedPayload = await retried.json();

    assert.equal(retried.status, 200);
    assert.equal(retriedPayload.projectId, restoredPayload.projectId);

    const [{ projects }] = await sql<{ projects: string }[]>`
      SELECT count(*)::text AS projects
      FROM project_profiles
    `;
    const [{ owners }] = await sql<{ owners: string }[]>`
      SELECT count(*)::text AS owners
      FROM project_profile_owners
      WHERE owner_public_key = ${OWNER}
    `;
    const [{ workflows }] = await sql<{ workflows: string }[]>`
      SELECT count(*)::text AS workflows
      FROM workflow_intents
      WHERE workflow_scope = 'project:managed-create'
        AND subject_public_key = ${OWNER}
    `;

    assert.equal(projects, "1");
    assert.equal(owners, "1");
    assert.equal(workflows, "1");
  });

  test("concurrent retry of one logical save creates exactly one project", async () => {
    const service = new ManagedProjectService(sql, {
      network: "testnet",
      now: () => NOW,
    });
    const input = {
      ownerPublicKey: OWNER,
      idempotencyKey: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      code: "NOVA",
      displayName: "Nova",
      description: "One logical save.",
    };

    const results = await Promise.all(
      Array.from({ length: 8 }, () => service.createManagedProject(input)),
    );

    assert.equal(
      new Set(results.map((result) => result.project.projectId)).size,
      1,
    );
    assert.equal(results.filter((result) => result.created).length, 1);

    const [{ projects }] = await sql<{ projects: string }[]>`
      SELECT count(*)::text AS projects
      FROM project_profiles
    `;
    const [{ owners }] = await sql<{ owners: string }[]>`
      SELECT count(*)::text AS owners
      FROM project_profile_owners
    `;
    const [{ workflows }] = await sql<{ workflows: string }[]>`
      SELECT count(*)::text AS workflows
      FROM workflow_intents
      WHERE workflow_scope = 'project:managed-create'
    `;

    assert.equal(projects, "1");
    assert.equal(owners, "1");
    assert.equal(workflows, "1");
  });

  test("idempotency key reuse with changed normalized project data is rejected", async () => {
    const service = new ManagedProjectService(sql, {
      network: "testnet",
      now: () => NOW,
    });
    const base = {
      ownerPublicKey: OWNER,
      idempotencyKey: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      code: "NOVA",
      displayName: "Nova",
      description: "Original",
    };

    await service.createManagedProject(base);

    await assert.rejects(
      service.createManagedProject({
        ...base,
        description: "Changed",
      }),
      (error: unknown) =>
        error instanceof ManagedProjectCreationError &&
        error.code === "idempotency_conflict",
    );
  });

  test("slug collisions use deterministic suffixes while preserving unique project identities", async () => {
    const service = new ManagedProjectService(sql, {
      network: "testnet",
      now: () => NOW,
    });
    const first = await service.createManagedProject({
      ownerPublicKey: OWNER,
      idempotencyKey: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      code: "NOVA1",
      displayName: "Nova",
      description: "",
    });
    const second = await service.createManagedProject({
      ownerPublicKey: OWNER,
      idempotencyKey: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      code: "NOVA2",
      displayName: "Nova",
      description: "",
    });

    assert.equal(first.project.slug, "nova");
    assert.equal(second.project.slug, "nova-2");
    assert.notEqual(first.project.projectId, second.project.projectId);
  });

  test("only the owner can manage/publish and public lookup renders persisted profile data", async () => {
    const service = new ManagedProjectService(sql, {
      network: "testnet",
      now: () => NOW,
    });
    const repository = new PostgresProjectProfileRepository(sql);
    const created = await service.createManagedProject({
      ownerPublicKey: OWNER,
      idempotencyKey: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      code: "NOVA",
      displayName: "Nova",
      description: "Persisted public project data.",
    });

    assert.equal(
      await repository.findOwnedById(created.project.projectId, OTHER),
      null,
    );
    assert.equal(
      await repository.publishOwned(created.project.projectId, OTHER, NOW + 1),
      null,
    );
    assert.equal(
      await repository.findPublishedBySlug(created.project.slug),
      null,
    );

    const published = await repository.publishOwned(
      created.project.projectId,
      OWNER,
      NOW + 2,
    );
    assert.ok(published);
    assert.equal(published.publicStatus, "published");

    const publicProject = await repository.findPublishedBySlug(
      created.project.slug,
    );
    assert.ok(publicProject);
    assert.equal(publicProject.projectId, created.project.projectId);
    assert.equal(publicProject.displayName, "Nova");

    const html = renderToStaticMarkup(
      ProjectLandingPage({ project: publicProject }),
    );
    assert.match(html, /Persisted public project data/);
    assert.match(html, /\/p\/nova/);
    assert.match(html, /TOML status/i);
    assert.match(html, /Not published/i);
  });
}
