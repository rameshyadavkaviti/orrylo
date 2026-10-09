import assert from "node:assert/strict";
import { resolve } from "node:path";
import { after, before, beforeEach, test } from "node:test";

import { Keypair } from "@stellar/stellar-sdk/base";

import {
  renderSharedTestnetToml,
  type MetadataPublicationState,
} from "../../lib/projects/metadata-publication";
import { createDatabaseClient } from "../../lib/server/persistence/database";
import { migrateDatabase } from "../../lib/server/persistence/migrations";
import { PostgresMetadataPublicationRepository } from "../../lib/server/persistence/metadata-publication-repository";
import { PostgresProjectProfileRepository } from "../../lib/server/persistence/project-profile-repository";
import {
  MetadataPublicationError,
  MetadataPublicationService,
} from "../../lib/server/projects/metadata-publication-service";
import type {
  MetadataPublicationVerifier,
  MetadataVerificationResult,
} from "../../lib/server/projects/metadata-publication-verifier";
import { ManagedProjectService } from "../../lib/server/projects/managed-project-service";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL?.trim();

if (!TEST_DATABASE_URL) {
  test("metadata publication PostgreSQL suite", { skip: true }, () => {});
} else {
  const databaseUrl = TEST_DATABASE_URL;
  const sql = createDatabaseClient(databaseUrl);
  const migrationsDirectory = resolve(process.cwd(), "db/migrations");
  const OWNER = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 81)).publicKey();
  const OTHER = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 82)).publicKey();
  const ISSUER = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 83)).publicKey();
  const NOW = Date.parse("2026-10-09T12:00:00.000Z");
  let clock = NOW;

  const successVerifier: MetadataPublicationVerifier = {
    verify: async () => ({ ok: true }),
  };

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
    clock = NOW;
    await sql.unsafe(
      "TRUNCATE project_metadata_publications, project_profile_owners, project_profiles, workflow_intents CASCADE",
    );
  });

  after(async () => {
    await sql.end({ timeout: 5 });
  });

  test("owner publishes an eligible Shared Issuer Testnet snapshot without publishing the landing page", async () => {
    const project = await createEligibleProject({
      code: "NOVA",
      displayName: "Nova",
      idempotencyKey: "11111111-1111-4111-8111-111111111111",
    });
    const service = publicationService(successVerifier);
    const result = await service.publishOwnedProject(project.projectId, OWNER);

    assert.equal(result.status, "verified");
    assert.equal(result.changed, true);
    assert.equal(result.publication.reachable, true);
    assert.ok(result.publication.verifiedAt);
    assert.equal(result.publication.revision, 1);

    const projectRepository = new PostgresProjectProfileRepository(sql);
    const managed = await projectRepository.findOwnedById(
      project.projectId,
      OWNER,
    );
    assert.equal(managed?.publicStatus, "draft");

    const publicationRepository = new PostgresMetadataPublicationRepository(
      sql,
    );
    const publications =
      await publicationRepository.listSharedTestnetPublications();
    assert.equal(publications.length, 1);
    assert.equal(publications[0]?.projectId, project.projectId);
  });

  test("non-owner cannot publish and creates no publication row", async () => {
    const project = await createEligibleProject({
      code: "NOVA",
      displayName: "Nova",
      idempotencyKey: "22222222-2222-4222-8222-222222222222",
    });
    const service = publicationService(successVerifier);

    await assert.rejects(
      service.publishOwnedProject(project.projectId, OTHER),
      (error: unknown) =>
        error instanceof MetadataPublicationError &&
        error.code === "project_not_found",
    );

    const [{ count }] = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count
      FROM project_metadata_publications
    `;
    assert.equal(count, "0");
  });

  test("unpublished project metadata is absent from the public Shared Issuer aggregate", async () => {
    await createEligibleProject({
      code: "NOVA",
      displayName: "Nova",
      idempotencyKey: "33333333-3333-4333-8333-333333333333",
    });

    const repository = new PostgresMetadataPublicationRepository(sql);
    assert.deepEqual(await repository.listSharedTestnetPublications(), []);
    assert.equal(renderSharedTestnetToml([]), "");
  });

  test("eight concurrent identical publications are idempotent at revision one", async () => {
    const project = await createEligibleProject({
      code: "NOVA",
      displayName: "Nova",
      idempotencyKey: "44444444-4444-4444-8444-444444444444",
    });
    const service = publicationService(successVerifier);

    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        service.publishOwnedProject(project.projectId, OWNER),
      ),
    );

    assert.equal(results.filter((result) => result.changed).length, 1);
    assert.equal(
      new Set(results.map((result) => result.publication.contentHash)).size,
      1,
    );

    const repository = new PostgresMetadataPublicationRepository(sql);
    const publication = await repository.getByProjectId(project.projectId);
    assert.ok(publication);
    assert.equal(publication.revision, 1);
    assert.equal(publication.reachable, true);

    const [{ count }] = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count
      FROM project_metadata_publications
      WHERE project_id = ${project.projectId}
    `;
    assert.equal(count, "1");
  });

  test("two Shared Issuer projects publish concurrently without losing either TOML entry", async () => {
    const alpha = await createEligibleProject({
      code: "ALPHA",
      displayName: "Alpha",
      idempotencyKey: "55555555-5555-4555-8555-555555555555",
    });
    const nova = await createEligibleProject({
      code: "NOVA",
      displayName: "Nova",
      idempotencyKey: "66666666-6666-4666-8666-666666666666",
    });
    const service = publicationService(successVerifier);

    await Promise.all([
      service.publishOwnedProject(nova.projectId, OWNER),
      service.publishOwnedProject(alpha.projectId, OWNER),
    ]);

    const repository = new PostgresMetadataPublicationRepository(sql);
    const publications =
      await repository.listSharedTestnetPublications();

    assert.equal(publications.length, 2);
    assert.deepEqual(
      publications.map((item) => item.assetCode),
      ["ALPHA", "NOVA"],
    );

    const content = renderSharedTestnetToml(publications);
    assert.match(content, /code = "ALPHA"/);
    assert.match(content, /code = "NOVA"/);
    assert.equal(
      content.split("\n").filter((line) => line === "[[CURRENCIES]]").length,
      2,
    );
  });

  test("metadata edits do not alter the published snapshot until republish and republish preserves other assets", async () => {
    const alpha = await createEligibleProject({
      code: "ALPHA",
      displayName: "Alpha",
      idempotencyKey: "77777777-7777-4777-8777-777777777777",
    });
    const nova = await createEligibleProject({
      code: "NOVA",
      displayName: "Nova",
      idempotencyKey: "88888888-8888-4888-8888-888888888888",
    });
    const service = publicationService(successVerifier);

    await service.publishOwnedProject(alpha.projectId, OWNER);
    await service.publishOwnedProject(nova.projectId, OWNER);

    const publicationRepository = new PostgresMetadataPublicationRepository(
      sql,
    );
    const before = await publicationRepository.getByProjectId(alpha.projectId);
    assert.ok(before);

    const profileRepository = new PostgresProjectProfileRepository(sql);
    clock += 10;
    await profileRepository.updateOwnedMetadata(
      alpha.projectId,
      OWNER,
      {
        displayName: "Alpha Updated",
        description: "New canonical metadata.",
        logoUrl: null,
        websiteUrl: null,
        communityUrl: null,
      },
      clock,
    );

    const stillPublished =
      await publicationRepository.getByProjectId(alpha.projectId);
    assert.equal(stillPublished?.currencyToml, before.currencyToml);
    assert.doesNotMatch(stillPublished?.currencyToml ?? "", /Alpha Updated/);

    clock += 10;
    const republished = await service.publishOwnedProject(
      alpha.projectId,
      OWNER,
    );
    assert.equal(republished.changed, true);
    assert.equal(republished.publication.revision, 2);
    assert.match(republished.publication.currencyToml, /Alpha Updated/);

    const all = await publicationRepository.listSharedTestnetPublications();
    assert.equal(all.length, 2);
    assert.match(renderSharedTestnetToml(all), /code = "NOVA"/);
  });

  test("verification failure leaves a durable published but unreachable snapshot and retry verifies it without a new revision", async () => {
    const project = await createEligibleProject({
      code: "NOVA",
      displayName: "Nova",
      idempotencyKey: "99999999-9999-4999-8999-999999999999",
    });
    const failureVerifier = verifierResult({
      ok: false,
      code: "request_failed",
    });
    const failed = await publicationService(failureVerifier).publishOwnedProject(
      project.projectId,
      OWNER,
    );

    assert.equal(failed.status, "published_not_reachable");
    assert.equal(failed.publication.reachable, false);
    assert.equal(failed.publication.verifiedAt, null);
    assert.equal(failed.publication.verificationErrorCode, "request_failed");
    assert.equal(failed.publication.revision, 1);

    clock += 10;
    const retried = await publicationService(
      successVerifier,
    ).publishOwnedProject(project.projectId, OWNER);

    assert.equal(retried.status, "verified");
    assert.equal(retried.changed, false);
    assert.equal(retried.publication.revision, 1);
    assert.equal(retried.publication.reachable, true);
    assert.ok(retried.publication.verifiedAt);
  });

  test("same Shared Issuer asset identity cannot be claimed by two projects", async () => {
    const first = await createEligibleProject({
      code: "NOVA",
      displayName: "First Nova",
      idempotencyKey: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
    });
    const second = await createEligibleProject({
      code: "NOVA",
      displayName: "Second Nova",
      idempotencyKey: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
    });
    const service = publicationService(successVerifier);

    await service.publishOwnedProject(first.projectId, OWNER);

    await assert.rejects(
      service.publishOwnedProject(second.projectId, OWNER),
      (error: unknown) =>
        error instanceof MetadataPublicationError &&
        error.code === "asset_identity_conflict",
    );

    const repository = new PostgresMetadataPublicationRepository(sql);
    assert.equal((await repository.listSharedTestnetPublications()).length, 1);
  });

  test("Dedicated Issuer and Mainnet projects are never routed through the Shared Issuer Testnet publisher", async () => {
    const dedicated = await createEligibleProject({
      code: "DED",
      displayName: "Dedicated",
      idempotencyKey: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
    });
    await sql`
      UPDATE project_profiles
      SET issuer_model = 'dedicated', metadata_home = NULL
      WHERE project_id = ${dedicated.projectId}
    `;

    const publicNetwork = await createEligibleProject({
      code: "MAIN",
      displayName: "Mainnet",
      idempotencyKey: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2",
      network: "public",
    });

    const service = publicationService(successVerifier);

    await assert.rejects(
      service.publishOwnedProject(dedicated.projectId, OWNER),
      (error: unknown) =>
        error instanceof MetadataPublicationError &&
        error.code === "unsupported_issuer_model",
    );
    await assert.rejects(
      service.publishOwnedProject(publicNetwork.projectId, OWNER),
      (error: unknown) =>
        error instanceof MetadataPublicationError &&
        error.code === "unsupported_network",
    );

    const repository = new PostgresMetadataPublicationRepository(sql);
    assert.deepEqual(await repository.listSharedTestnetPublications(), []);
  });

  test("stale verification hash cannot mark a newer publication reachable", async () => {
    const project = await createEligibleProject({
      code: "NOVA",
      displayName: "Nova",
      idempotencyKey: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1",
    });
    const failed = await publicationService(
      verifierResult({ ok: false, code: "content_mismatch" }),
    ).publishOwnedProject(project.projectId, OWNER);

    const repository = new PostgresMetadataPublicationRepository(sql);
    const stale = await repository.markVerifiedIfCurrent({
      projectId: project.projectId,
      contentHash: "0".repeat(64),
      now: clock + 1,
    });

    assert.equal(stale, null);
    assert.equal(
      (await repository.getByProjectId(project.projectId))?.contentHash,
      failed.publication.contentHash,
    );
    assert.equal(
      (await repository.getByProjectId(project.projectId))?.reachable,
      false,
    );
  });

  function publicationService(
    verifier: MetadataPublicationVerifier,
  ): MetadataPublicationService {
    return new MetadataPublicationService(sql, {
      now: () => clock,
      verifier,
    });
  }

  function verifierResult(
    result: MetadataVerificationResult,
  ): MetadataPublicationVerifier {
    return {
      verify: async (_publication: Pick<
        MetadataPublicationState,
        "assetCode" | "issuerPublicKey" | "currencyToml" | "contentHash"
      >) => result,
    };
  }

  async function createEligibleProject(input: {
    code: string;
    displayName: string;
    idempotencyKey: string;
    network?: "testnet" | "public";
  }) {
    const service = new ManagedProjectService(sql, {
      network: input.network ?? "testnet",
      now: () => clock,
    });
    const created = await service.createManagedProject({
      ownerPublicKey: OWNER,
      idempotencyKey: input.idempotencyKey,
      code: input.code,
      displayName: input.displayName,
      description: `${input.displayName} metadata.`,
    });

    await sql`
      UPDATE project_profiles
      SET issuer_public_key = ${ISSUER}
      WHERE project_id = ${created.project.projectId}
    `;

    return {
      ...created.project,
      issuerPublicKey: ISSUER,
    };
  }
}
