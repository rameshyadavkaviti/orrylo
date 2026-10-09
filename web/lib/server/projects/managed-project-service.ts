import { randomUUID } from "node:crypto";

import { hashJson } from "../../persistence/json";
import {
  type ManagedProjectProfile,
  type ProjectNetwork,
} from "../../projects/project-profile";
import {
  normalizeProjectSlug,
  projectSlugCandidate,
} from "../../projects/project-slug";
import { SHARED_ASSET_DOMAIN } from "../../product/constants";
import { validateSharedAssetDraft } from "../../validation/token";
import type { DatabaseClient } from "../persistence/database";
import { PostgresProjectProfileRepository } from "../persistence/project-profile-repository";
import {
  InvalidStellarPublicKeyError,
  normalizeWalletPublicKey,
} from "../persistence/wallet";

const WORKFLOW_SCOPE = "project:managed-create";
const WORKFLOW_TYPE = "managed_project_creation";
const POLICY_VERSION = "project-profile-v1";
const MAX_SLUG_ATTEMPTS = 1000;
const IDEMPOTENCY_KEY_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ManagedProjectCreationErrorCode =
  | "invalid_project"
  | "invalid_idempotency_key"
  | "idempotency_conflict"
  | "slug_unavailable"
  | "database_invariant";

export class ManagedProjectCreationError extends Error {
  constructor(readonly code: ManagedProjectCreationErrorCode) {
    super(code);
    this.name = "ManagedProjectCreationError";
  }
}

interface WorkflowRow {
  request_id: string;
  subject_public_key: string | null;
  state: string;
  payload_hash: string;
  external_reference: string | null;
}

export interface CreateManagedProjectInput {
  ownerPublicKey: string;
  idempotencyKey: string;
  code: string;
  displayName: string;
  description: string;
}

export interface CreateManagedProjectResult {
  created: boolean;
  project: ManagedProjectProfile;
}

export class ManagedProjectService {
  constructor(
    private readonly sql: DatabaseClient,
    private readonly options: {
      network: ProjectNetwork;
      now?: () => number;
    },
  ) {}

  async createManagedProject(
    input: CreateManagedProjectInput,
  ): Promise<CreateManagedProjectResult> {
    let ownerPublicKey: string;

    try {
      ownerPublicKey = normalizeWalletPublicKey(input.ownerPublicKey);
    } catch (error) {
      if (error instanceof InvalidStellarPublicKeyError) {
        throw new ManagedProjectCreationError("invalid_project");
      }

      throw error;
    }

    const idempotencyKey = input.idempotencyKey.trim().toLowerCase();

    if (!IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
      throw new ManagedProjectCreationError("invalid_idempotency_key");
    }

    const validation = validateSharedAssetDraft({
      code: input.code,
      displayName: input.displayName,
      description: input.description,
    });

    if (!validation.valid) {
      throw new ManagedProjectCreationError("invalid_project");
    }

    const now = this.options.now?.() ?? Date.now();
    const description = validation.normalized.description || null;
    const payload = {
      assetCode: validation.normalized.code,
      displayName: validation.normalized.displayName,
      description,
      issuerModel: "shared",
      network: this.options.network,
      metadataHome: SHARED_ASSET_DOMAIN,
      publicStatus: "draft",
    } as const;
    const payloadHash = hashJson({
      workflowType: WORKFLOW_TYPE,
      subjectPublicKey: ownerPublicKey,
      policyVersion: POLICY_VERSION,
      payload,
    });
    const boundIdempotencyKey = `${ownerPublicKey}:${idempotencyKey}`;

    const outcome = await this.sql.begin(async (transaction) => {
      const requestId = randomUUID();

      await transaction`
        INSERT INTO workflow_intents (
          request_id,
          workflow_scope,
          workflow_type,
          subject_public_key,
          state,
          idempotency_key,
          payload_hash,
          payload,
          created_at,
          updated_at,
          policy_version
        )
        VALUES (
          ${requestId},
          ${WORKFLOW_SCOPE},
          ${WORKFLOW_TYPE},
          ${ownerPublicKey},
          'created',
          ${boundIdempotencyKey},
          ${payloadHash},
          ${transaction.json(payload)},
          ${new Date(now)},
          ${new Date(now)},
          ${POLICY_VERSION}
        )
        ON CONFLICT (workflow_scope, idempotency_key) DO NOTHING
      `;

      const [workflow] = await transaction<WorkflowRow[]>`
        SELECT
          request_id,
          subject_public_key,
          state,
          payload_hash,
          external_reference
        FROM workflow_intents
        WHERE workflow_scope = ${WORKFLOW_SCOPE}
          AND idempotency_key = ${boundIdempotencyKey}
        FOR UPDATE
      `;

      if (!workflow) {
        throw new ManagedProjectCreationError("database_invariant");
      }

      if (
        workflow.subject_public_key?.trim() !== ownerPublicKey ||
        workflow.payload_hash.trim() !== payloadHash
      ) {
        throw new ManagedProjectCreationError("idempotency_conflict");
      }

      if (workflow.state === "confirmed") {
        if (!workflow.external_reference) {
          throw new ManagedProjectCreationError("database_invariant");
        }

        return {
          created: false,
          projectId: workflow.external_reference,
        };
      }

      if (workflow.state !== "created") {
        throw new ManagedProjectCreationError("idempotency_conflict");
      }

      const projectId = randomUUID();
      const baseSlug = normalizeProjectSlug(
        validation.normalized.displayName,
        validation.normalized.code,
      );

      for (let ordinal = 1; ordinal <= MAX_SLUG_ATTEMPTS; ordinal += 1) {
        const slug = projectSlugCandidate(baseSlug, ordinal);
        const [inserted] = await transaction<{ project_id: string }[]>`
          INSERT INTO project_profiles (
            project_id,
            slug,
            asset_code,
            display_name,
            description,
            category,
            logo_url,
            website_url,
            community_url,
            metadata_home,
            issuer_model,
            network,
            issuer_public_key,
            explorer_url,
            public_status,
            created_at,
            updated_at
          )
          VALUES (
            ${projectId},
            ${slug},
            ${validation.normalized.code},
            ${validation.normalized.displayName},
            ${description},
            NULL,
            NULL,
            NULL,
            NULL,
            ${SHARED_ASSET_DOMAIN},
            'shared',
            ${this.options.network},
            NULL,
            NULL,
            'draft',
            ${new Date(now)},
            ${new Date(now)}
          )
          ON CONFLICT (slug) DO NOTHING
          RETURNING project_id
        `;

        if (!inserted) {
          continue;
        }

        await transaction`
          INSERT INTO project_profile_owners (
            project_id,
            owner_public_key,
            creation_request_id,
            created_at
          )
          VALUES (
            ${projectId},
            ${ownerPublicKey},
            ${workflow.request_id},
            ${new Date(now)}
          )
        `;

        const [completed] = await transaction<{ request_id: string }[]>`
          UPDATE workflow_intents
          SET
            state = 'confirmed',
            updated_at = ${new Date(now)},
            terminal_at = ${new Date(now)},
            external_reference = ${projectId}
          WHERE request_id = ${workflow.request_id}
            AND state = 'created'
          RETURNING request_id
        `;

        if (!completed) {
          throw new ManagedProjectCreationError("database_invariant");
        }

        return { created: true, projectId };
      }

      throw new ManagedProjectCreationError("slug_unavailable");
    });

    const repository = new PostgresProjectProfileRepository(this.sql);
    const project = await repository.findOwnedById(
      outcome.projectId,
      ownerPublicKey,
    );

    if (!project) {
      throw new ManagedProjectCreationError("database_invariant");
    }

    return {
      created: outcome.created,
      project,
    };
  }
}
