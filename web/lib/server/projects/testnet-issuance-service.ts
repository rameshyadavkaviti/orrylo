import { randomUUID } from "node:crypto";

import { hashJson } from "../../persistence/json";
import { isValidProjectId } from "../../projects/project-profile";
import { validateSharedAssetDraft } from "../../validation/token";
import type { DatabaseClient } from "../persistence/database";
import { PostgresAuditRepository } from "../persistence/audit-repository";
import { normalizeWalletPublicKey } from "../persistence/wallet";

import {
  SHARED_ISSUANCE_POLICY_VERSION,
  SHARED_ISSUER_TESTNET_PASSPHRASE,
  buildSharedIssuerIssuancePlan,
  type SharedIssuerIssuanceRequest,
  type SharedIssuerIssuancePreconditions,
  type SharedIssuerIssuancePlan,
} from "../../stellar/shared-issuer-issuance";

const SCOPE = "asset:testnet-shared-issuance";
const WORKFLOW_TYPE = "shared_asset_issuance";
const POLICY_VERSION = "testnet-shared-issuance-foundation-v2";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type TestnetIssuanceStatus =
  | "not_started"
  | "awaiting_issuer_integration"
  | "pending_execution"
  | "submitted"
  | "confirmed"
  | "failed"
  | "reconciliation_required";

export interface TestnetIssuanceRecord {
  requestId: string;
  projectId: string;
  assetCode: string;
  network: "testnet";
  status: Exclude<TestnetIssuanceStatus, "not_started">;
  reservationIssuerPublicKey: string;
  reservationFingerprint: string;
  issuerPublicKey: string | null;
  transactionHash: string | null;
  ledgerSequence: number | null;
  failureCode: string | null;
}

export type TestnetIssuanceErrorCode =
  | "project_not_found"
  | "unsupported_network"
  | "ineligible_project"
  | "invalid_asset_configuration"
  | "invalid_request"
  | "asset_code_mismatch"
  | "idempotency_conflict"
  | "issuance_already_requested"
  | "asset_code_reserved"
  | "reservation_limit_reached"
  | "issuer_integration_unavailable"
  | "issuer_configuration_mismatch"
  | "database_invariant";

export class TestnetIssuanceError extends Error {
  constructor(readonly code: TestnetIssuanceErrorCode) {
    super(code);
    this.name = "TestnetIssuanceError";
  }
}

interface OwnedProjectRow {
  project_id: string;
  asset_code: string;
  display_name: string;
  description: string | null;
  issuer_model: string;
  network: string;
  issuer_public_key: string | null;
}

interface IssuanceRow {
  project_id: string;
  request_id: string;
  asset_code: string;
  network: "testnet";
  reservation_issuer_public_key: string;
  reservation_fingerprint: string;
  status: Exclude<TestnetIssuanceStatus, "not_started">;
  issuer_public_key: string | null;
  transaction_hash: string | null;
  ledger_sequence: string | null;
  failure_code: string | null;
}

interface WorkflowRow {
  request_id: string;
  payload_hash: string;
  subject_public_key: string | null;
  workflow_type: string;
  policy_version: string;
}

/** This is NOT the PR #27 complete issuance intent. No amount/destination is chosen. */
function reservationPayload(projectId: string, assetCode: string, issuer: string) {
  return {
    projectId,
    network: "testnet",
    issuerModel: "shared",
    assetCode,
    issuerPublicKey: issuer,
    preparationPolicyVersion: SHARED_ISSUANCE_POLICY_VERSION,
  } as const;
}

function fingerprint(owner: string, payload: ReturnType<typeof reservationPayload>) {
  return hashJson({
    workflowType: WORKFLOW_TYPE,
    subjectPublicKey: owner,
    policyVersion: POLICY_VERSION,
    payload,
  });
}

function mapRow(row: IssuanceRow): TestnetIssuanceRecord {
  const ledger = row.ledger_sequence === null ? null : Number(row.ledger_sequence);
  if (ledger !== null && (!Number.isSafeInteger(ledger) || ledger <= 0)) {
    throw new TestnetIssuanceError("database_invariant");
  }
  return {
    requestId: row.request_id,
    projectId: row.project_id,
    assetCode: row.asset_code,
    network: row.network,
    status: row.status,
    reservationIssuerPublicKey: row.reservation_issuer_public_key.trim(),
    reservationFingerprint: row.reservation_fingerprint.trim(),
    issuerPublicKey: row.issuer_public_key?.trim() ?? null,
    transactionHash: row.transaction_hash?.trim() ?? null,
    ledgerSequence: ledger,
    failureCode: row.failure_code,
  };
}

/**
 * Integrates PR #27's pure preparation API without making it executable from
 * browser routes. The caller MUST supply the committed owner-scoped DB record
 * and independently ledger-verified preconditions; no fake reserved:true input.
 * Not invoked by the app while the issuer/service policy is unresolved.
 */
export function prepareReservedSharedIssuerPlan(
  reserved: TestnetIssuanceRecord,
  request: SharedIssuerIssuanceRequest,
  preconditions: Omit<SharedIssuerIssuancePreconditions, "assetCodeReservedForProject">,
): SharedIssuerIssuancePlan {
  if (
    reserved.network !== "testnet" ||
    request.network !== "testnet" ||
    request.networkPassphrase !== SHARED_ISSUER_TESTNET_PASSPHRASE ||
    reserved.projectId !== request.projectId ||
    reserved.assetCode !== request.assetCode ||
    reserved.reservationIssuerPublicKey !== request.issuerPublicKey ||
    reserved.status !== "awaiting_issuer_integration"
  ) {
    throw new TestnetIssuanceError("issuer_configuration_mismatch");
  }
  return buildSharedIssuerIssuancePlan(request, {
    ...preconditions,
    assetCodeReservedForProject: true,
  });
}

export class TestnetIssuanceService {
  constructor(
    private readonly sql: DatabaseClient,
    private readonly options: {
      network: "testnet" | "public";
      /** Explicitly approved issuer identity. Never select the reserved candidate. */
      approvedIssuerPublicKey?: string | null;
      now?: () => number;
    },
  ) {}

  async getOwnedStatus(
    projectId: string,
    ownerPublicKey: string,
  ): Promise<TestnetIssuanceRecord | null> {
    const owner = normalizeWalletPublicKey(ownerPublicKey);
    if (!isValidProjectId(projectId)) {
      throw new TestnetIssuanceError("invalid_request");
    }
    const [project] = await this.sql<{ project_id: string }[]>`
      SELECT p.project_id
      FROM project_profiles AS p
      JOIN project_profile_owners AS o ON o.project_id = p.project_id
      WHERE p.project_id = ${projectId} AND o.owner_public_key = ${owner}
    `;
    if (!project) throw new TestnetIssuanceError("project_not_found");
    const [row] = await this.sql<IssuanceRow[]>`
      SELECT * FROM project_issuance_intents WHERE project_id = ${projectId}
    `;
    return row ? mapRow(row) : null;
  }

  async request(input: {
    ownerPublicKey: string;
    projectId: string;
    idempotencyKey: string;
    expectedAssetCode: string;
  }): Promise<{ created: boolean; issuance: TestnetIssuanceRecord }> {
    if (this.options.network !== "testnet") {
      throw new TestnetIssuanceError("unsupported_network");
    }
    if (!isValidProjectId(input.projectId) || !UUID_PATTERN.test(input.idempotencyKey)) {
      throw new TestnetIssuanceError("invalid_request");
    }

    // Without an explicitly approved server-side identity there is NO safe
    // issuer-scoped reservation. This also prevents speculative public squatting.
    if (!this.options.approvedIssuerPublicKey) {
      throw new TestnetIssuanceError("issuer_integration_unavailable");
    }
    let issuer: string;
    try {
      issuer = normalizeWalletPublicKey(this.options.approvedIssuerPublicKey);
    } catch {
      throw new TestnetIssuanceError("issuer_integration_unavailable");
    }

    const owner = normalizeWalletPublicKey(input.ownerPublicKey);
    if (issuer === owner) {
      throw new TestnetIssuanceError("issuer_configuration_mismatch");
    }
    const key = input.idempotencyKey.toLowerCase();
    const now = this.options.now?.() ?? Date.now();

    try {
      return await this.sql.begin(async (transaction) => {
        const [project] = await transaction<OwnedProjectRow[]>`
          SELECT p.project_id, p.asset_code, p.display_name, p.description,
                 p.issuer_model, p.network, p.issuer_public_key
          FROM project_profiles AS p
          JOIN project_profile_owners AS o ON o.project_id = p.project_id
          WHERE p.project_id = ${input.projectId} AND o.owner_public_key = ${owner}
          FOR UPDATE OF p
        `;
        if (!project) throw new TestnetIssuanceError("project_not_found");
        if (project.network !== "testnet") {
          throw new TestnetIssuanceError("unsupported_network");
        }
        if (project.issuer_model !== "shared" || project.issuer_public_key !== null) {
          throw new TestnetIssuanceError("ineligible_project");
        }
        const validation = validateSharedAssetDraft({
          code: project.asset_code,
          displayName: project.display_name,
          description: project.description ?? "",
        });
        if (!validation.valid) {
          throw new TestnetIssuanceError("invalid_asset_configuration");
        }
        if (input.expectedAssetCode !== validation.normalized.code) {
          throw new TestnetIssuanceError("asset_code_mismatch");
        }

        const payload = reservationPayload(input.projectId, validation.normalized.code, issuer);
        const expectedFingerprint = fingerprint(owner, payload);
        const boundKey = `${owner}:${input.projectId}:${key}`;
        const [workflow] = await transaction<WorkflowRow[]>`
          SELECT request_id, payload_hash, subject_public_key,
                 workflow_type, policy_version
          FROM workflow_intents
          WHERE workflow_scope = ${SCOPE} AND idempotency_key = ${boundKey}
          FOR UPDATE
        `;
        if (workflow) {
          if (workflow.payload_hash.trim() !== expectedFingerprint ||
              workflow.subject_public_key?.trim() !== owner ||
              workflow.workflow_type !== WORKFLOW_TYPE ||
              workflow.policy_version !== POLICY_VERSION) {
            throw new TestnetIssuanceError("idempotency_conflict");
          }
          const [existing] = await transaction<IssuanceRow[]>`
            SELECT * FROM project_issuance_intents WHERE request_id = ${workflow.request_id}
          `;
          if (!existing || existing.project_id !== input.projectId ||
              existing.reservation_issuer_public_key.trim() !== issuer ||
              existing.asset_code !== payload.assetCode ||
              existing.reservation_fingerprint.trim() !== expectedFingerprint) {
            throw new TestnetIssuanceError("database_invariant");
          }
          return { created: false, issuance: mapRow(existing) };
        }

        const [existing] = await transaction<IssuanceRow[]>`
          SELECT * FROM project_issuance_intents WHERE project_id = ${input.projectId}
        `;
        if (existing) throw new TestnetIssuanceError("issuance_already_requested");

        const requestId = randomUUID();
        await transaction`
          INSERT INTO workflow_intents (
            request_id, workflow_scope, workflow_type, subject_public_key,
            state, idempotency_key, payload_hash, payload,
            policy_version, created_at, updated_at
          ) VALUES (
            ${requestId}, ${SCOPE}, ${WORKFLOW_TYPE}, ${owner},
            'created', ${boundKey}, ${expectedFingerprint},
            ${transaction.json(payload)}, ${POLICY_VERSION}, ${new Date(now)}, ${new Date(now)}
          )
        `;
        const [created] = await transaction<IssuanceRow[]>`
          INSERT INTO project_issuance_intents (
            project_id, request_id, owner_public_key, network,
            reservation_issuer_public_key, asset_code, reservation_fingerprint,
            status, created_at, updated_at
          ) VALUES (
            ${input.projectId}, ${requestId}, ${owner}, 'testnet',
            ${issuer}, ${payload.assetCode}, ${expectedFingerprint},
            'awaiting_issuer_integration', ${new Date(now)}, ${new Date(now)}
          ) RETURNING *
        `;
        if (!created) throw new TestnetIssuanceError("database_invariant");

        const audit = new PostgresAuditRepository(transaction as unknown as DatabaseClient);
        // Both events share the same transaction, request ID and hash chain.
        // A failure to append either event rolls back the reservation and workflow.
        await audit.appendInTransaction(transaction as unknown as DatabaseClient, {
          requestId,
          eventType: "SHARED_ISSUANCE_INTENT_CREATED",
          source: "testnet-issuance-service",
          targetPublicKey: owner,
          policyVersion: POLICY_VERSION,
          occurredAt: now,
          metadata: {
            projectId: input.projectId,
            assetCode: payload.assetCode,
            issuerPublicKey: issuer,
            reservationFingerprint: expectedFingerprint,
            network: "testnet",
          },
        });
        await audit.appendInTransaction(transaction as unknown as DatabaseClient, {
          requestId,
          eventType: "SHARED_ISSUANCE_ASSET_CODE_RESERVED",
          source: "testnet-issuance-service",
          targetPublicKey: owner,
          policyVersion: POLICY_VERSION,
          occurredAt: now,
          metadata: {
            projectId: input.projectId,
            assetCode: payload.assetCode,
            issuerPublicKey: issuer,
            status: "awaiting_issuer_integration",
          },
        });
        return { created: true, issuance: mapRow(created) };
      });
    } catch (error) {
      if (error instanceof TestnetIssuanceError) throw error;
      const constraint =
        typeof error === "object" && error !== null && "constraint_name" in error
          ? error.constraint_name : null;
      if (constraint === "project_issuance_unique_asset_code") {
        throw new TestnetIssuanceError("asset_code_reserved");
      }
      if (constraint === "project_issuance_one_outstanding_per_wallet") {
        throw new TestnetIssuanceError("reservation_limit_reached");
      }
      throw error;
    }
  }
}
