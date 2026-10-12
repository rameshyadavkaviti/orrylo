import { createHash, randomUUID } from "node:crypto";

import { hashJson } from "../../persistence/json";
import { isValidProjectId } from "../../projects/project-profile";
import { validateSharedAssetDraft } from "../../validation/token";
import { validateInitialSupply } from "../../validation/initial-supply";
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
  /** Present only when a complete immutable full intent actually exists. */
  completeIntent?: {
    fingerprint: string;
    destinationPublicKey: string;
    initialSupply: string;
    amountStroops: string;
  };
}

export type TestnetIssuanceErrorCode =
  | "project_not_found"
  | "unsupported_network"
  | "ineligible_project"
  | "invalid_asset_configuration"
  | "invalid_request"
  | "asset_code_mismatch"
  | "invalid_initial_supply"
  | "idempotency_conflict"
  | "issuance_already_requested"
  | "asset_code_reserved"
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
  failure_code: string | null;
  full_fingerprint?: string | null;
  destination_public_key?: string | null;
  full_amount?: string | null;
}

interface WorkflowRow {
  request_id: string;
  payload_hash: string;
  subject_public_key: string | null;
  workflow_type: string;
  policy_version: string;
}

/** This is NOT the PR #27 complete issuance intent. No amount/destination is chosen. */
function reservationPayload(
  projectId: string,
  assetCode: string,
  issuer: string,
) {
  return {
    projectId,
    network: "testnet",
    issuerModel: "shared",
    assetCode,
    issuerPublicKey: issuer,
    preparationPolicyVersion: SHARED_ISSUANCE_POLICY_VERSION,
  } as const;
}

function fingerprint(
  owner: string,
  payload: ReturnType<typeof reservationPayload>,
) {
  return hashJson({
    workflowType: WORKFLOW_TYPE,
    subjectPublicKey: owner,
    policyVersion: POLICY_VERSION,
    payload,
  });
}

function mapRow(row: IssuanceRow): TestnetIssuanceRecord {
  const fullAmount = row.full_amount
    ? validateInitialSupply(row.full_amount)
    : null;
  if (row.full_amount && (!fullAmount || !fullAmount.valid)) {
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
    issuerPublicKey: null,
    transactionHash: null,
    ledgerSequence: null,
    failureCode: row.failure_code,
    ...(row.full_fingerprint && row.destination_public_key && fullAmount?.valid
      ? {
          completeIntent: {
            fingerprint: row.full_fingerprint.trim(),
            destinationPublicKey: row.destination_public_key.trim(),
            initialSupply: fullAmount.normalized,
            amountStroops: fullAmount.stroops.toString(),
          },
        }
      : {}),
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
  preconditions: Omit<
    SharedIssuerIssuancePreconditions,
    "assetCodeReservedForProject"
  >,
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

const TESTNET_PASSPHRASE_HASH = createHash("sha256")
  .update(SHARED_ISSUER_TESTNET_PASSPHRASE, "utf8")
  .digest("hex");

function fullIdentity(
  projectId: string,
  owner: string,
  issuer: string,
  assetCode: string,
  stroops: bigint,
) {
  const amount = `${stroops / 10_000_000n}.${(stroops % 10_000_000n).toString().padStart(7, "0")}`;
  // Identical fingerprint tuple and canonical amount as PR #27's hashIntent.
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify([
        SHARED_ISSUANCE_POLICY_VERSION,
        projectId,
        "testnet",
        assetCode,
        issuer,
        owner,
        amount,
      ]),
      "utf8",
    )
    .digest("hex");
  return { amount, fingerprint };
}

async function loadIssuance(
  sql: DatabaseClient,
  requestId: string,
): Promise<TestnetIssuanceRecord> {
  const [row] = await sql<IssuanceRow[]>`
    SELECT i.*, f.issuance_intent_fingerprint AS full_fingerprint,
      f.destination_public_key, f.amount::text AS full_amount
    FROM project_issuance_intents i
    LEFT JOIN project_issuance_full_intents f ON f.issuance_request_id = i.request_id
    WHERE i.request_id = ${requestId}
  `;
  if (!row) throw new TestnetIssuanceError("database_invariant");
  return mapRow(row);
}

/**
 * Must only run inside the caller's existing project-row locked transaction.
 * The full intent and audit append are atomic with the initial reservation.
 */
async function appendFullIntent(
  sql: DatabaseClient,
  input: {
    requestId: string;
    reservationFingerprint: string;
    projectId: string;
    owner: string;
    issuer: string;
    assetCode: string;
    amountStroops: bigint;
    now: number;
  },
) {
  const identity = fullIdentity(
    input.projectId,
    input.owner,
    input.issuer,
    input.assetCode,
    input.amountStroops,
  );
  await sql`
    INSERT INTO project_issuance_full_intents (
      issuance_request_id, issuance_intent_fingerprint, reservation_fingerprint,
      project_id, owner_public_key, network, network_passphrase_hash,
      asset_code, issuer_public_key, destination_public_key, amount,
      policy_version, created_at
    ) VALUES (
      ${input.requestId}, ${identity.fingerprint}, ${input.reservationFingerprint},
      ${input.projectId}, ${input.owner}, 'testnet', ${TESTNET_PASSPHRASE_HASH},
      ${input.assetCode}, ${input.issuer}, ${input.owner}, ${identity.amount},
      ${SHARED_ISSUANCE_POLICY_VERSION}, ${new Date(input.now)}
    )
  `;
  await new PostgresAuditRepository(sql).appendInTransaction(sql, {
    requestId: input.requestId,
    eventType: "SHARED_ISSUANCE_FULL_INTENT_COMMITTED",
    source: "testnet-issuance-service",
    targetPublicKey: input.owner,
    policyVersion: SHARED_ISSUANCE_POLICY_VERSION,
    occurredAt: input.now,
    metadata: {
      projectId: input.projectId,
      network: "testnet",
      issuerPublicKey: input.issuer,
      destinationPublicKey: input.owner,
      assetCode: input.assetCode,
      amount: identity.amount,
      amountStroops: input.amountStroops.toString(),
      reservationFingerprint: input.reservationFingerprint,
      issuanceIntentFingerprint: identity.fingerprint,
    },
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
      SELECT i.*, f.issuance_intent_fingerprint AS full_fingerprint,
        f.destination_public_key, f.amount::text AS full_amount
      FROM project_issuance_intents i
      LEFT JOIN project_issuance_full_intents f ON f.issuance_request_id = i.request_id
      WHERE i.project_id = ${projectId}
    `;
    return row ? mapRow(row) : null;
  }

  async request(input: {
    ownerPublicKey: string;
    projectId: string;
    idempotencyKey: string;
    expectedAssetCode: string;
    /** Only explicit final confirmation binds this value; legacy reservation tests remain valid. */
    initialSupply?: string;
  }): Promise<{ created: boolean; issuance: TestnetIssuanceRecord }> {
    if (this.options.network !== "testnet") {
      throw new TestnetIssuanceError("unsupported_network");
    }
    if (
      !isValidProjectId(input.projectId) ||
      !UUID_PATTERN.test(input.idempotencyKey)
    ) {
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

    const amount =
      input.initialSupply === undefined
        ? null
        : validateInitialSupply(input.initialSupply);
    if (amount !== null && !amount.valid) {
      throw new TestnetIssuanceError("invalid_initial_supply");
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
        if (
          project.issuer_model !== "shared" ||
          project.issuer_public_key !== null
        ) {
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

        const payload = reservationPayload(
          input.projectId,
          validation.normalized.code,
          issuer,
        );
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
          if (
            workflow.payload_hash.trim() !== expectedFingerprint ||
            workflow.subject_public_key?.trim() !== owner ||
            workflow.workflow_type !== WORKFLOW_TYPE ||
            workflow.policy_version !== POLICY_VERSION
          ) {
            throw new TestnetIssuanceError("idempotency_conflict");
          }
          const [existing] = await transaction<IssuanceRow[]>`
            SELECT i.*, f.issuance_intent_fingerprint AS full_fingerprint,
              f.destination_public_key, f.amount::text AS full_amount
            FROM project_issuance_intents i
            LEFT JOIN project_issuance_full_intents f ON f.issuance_request_id = i.request_id
            WHERE i.request_id = ${workflow.request_id}
          `;
          if (
            !existing ||
            existing.project_id !== input.projectId ||
            existing.reservation_issuer_public_key.trim() !== issuer ||
            existing.asset_code !== payload.assetCode ||
            existing.reservation_fingerprint.trim() !== expectedFingerprint
          ) {
            throw new TestnetIssuanceError("database_invariant");
          }
          if (amount?.valid) {
            const intent = fullIdentity(
              input.projectId,
              owner,
              issuer,
              payload.assetCode,
              amount.stroops,
            );
            if (existing.full_fingerprint) {
              if (
                existing.full_fingerprint.trim() !== intent.fingerprint ||
                existing.destination_public_key?.trim() !== owner ||
                !existing.full_amount ||
                !validateInitialSupply(existing.full_amount).valid ||
                existing.full_amount !== intent.amount
              ) {
                throw new TestnetIssuanceError("idempotency_conflict");
              }
            } else {
              // A historical reservation may be completed once, under its exact
              // already-bound idempotency key, without recreating its identity.
              await appendFullIntent(transaction as unknown as DatabaseClient, {
                requestId: workflow.request_id,
                reservationFingerprint: expectedFingerprint,
                projectId: input.projectId,
                owner,
                issuer,
                assetCode: payload.assetCode,
                amountStroops: amount.stroops,
                now,
              });
            }
          }
          return {
            created: false,
            issuance: await loadIssuance(
              transaction as unknown as DatabaseClient,
              workflow.request_id,
            ),
          };
        }

        const [existing] = await transaction<IssuanceRow[]>`
          SELECT * FROM project_issuance_intents WHERE project_id = ${input.projectId}
        `;
        if (existing)
          throw new TestnetIssuanceError("issuance_already_requested");

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

        const audit = new PostgresAuditRepository(
          transaction as unknown as DatabaseClient,
        );
        // Both events share the same transaction, request ID and hash chain.
        // A failure to append either event rolls back the reservation and workflow.
        await audit.appendInTransaction(
          transaction as unknown as DatabaseClient,
          {
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
          },
        );
        await audit.appendInTransaction(
          transaction as unknown as DatabaseClient,
          {
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
          },
        );
        if (amount?.valid) {
          await appendFullIntent(transaction as unknown as DatabaseClient, {
            requestId,
            reservationFingerprint: expectedFingerprint,
            projectId: input.projectId,
            owner,
            issuer,
            assetCode: payload.assetCode,
            amountStroops: amount.stroops,
            now,
          });
        }
        return {
          created: true,
          issuance: await loadIssuance(
            transaction as unknown as DatabaseClient,
            requestId,
          ),
        };
      });
    } catch (error) {
      if (error instanceof TestnetIssuanceError) throw error;
      const constraint =
        typeof error === "object" &&
        error !== null &&
        "constraint_name" in error
          ? error.constraint_name
          : null;
      if (constraint === "project_issuance_unique_asset_code") {
        throw new TestnetIssuanceError("asset_code_reserved");
      }
      throw error;
    }
  }
}
