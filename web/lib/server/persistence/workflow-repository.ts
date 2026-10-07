import { randomUUID } from "node:crypto";

import {
  IdempotencyPayloadMismatchError,
  type CreateWorkflowIntentInput,
  type WorkflowIntentRecord,
  type WorkflowState,
} from "../../persistence/workflows";
import { hashJson, type JsonValue } from "../../persistence/json";
import type { DatabaseClient } from "./database";
import { normalizeWalletPublicKey } from "./wallet";

interface WorkflowRow {
  request_id: string;
  workflow_scope: string;
  workflow_type: string;
  subject_public_key: string | null;
  state: WorkflowState;
  idempotency_key: string;
  payload_hash: string;
  payload: JsonValue;
  created_at: Date;
  updated_at: Date;
  terminal_at: Date | null;
  failure_code: string | null;
  retry_count: number;
  policy_version: string;
  external_reference: string | null;
  onchain_reference: string | null;
}

export class PostgresWorkflowRepository {
  constructor(private readonly sql: DatabaseClient) {}

  async createIdempotent(
    input: CreateWorkflowIntentInput,
    now = Date.now(),
  ): Promise<WorkflowIntentRecord> {
    const subjectPublicKey = input.subjectPublicKey
      ? normalizeWalletPublicKey(input.subjectPublicKey)
      : null;
    const payloadHash = hashJson({
      workflowType: input.workflowType,
      subjectPublicKey,
      policyVersion: input.policyVersion,
      payload: input.payload,
    });
    const requestId = randomUUID();

    const [inserted] = await this.sql<WorkflowRow[]>`
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
        ${input.workflowScope},
        ${input.workflowType},
        ${subjectPublicKey},
        'created',
        ${input.idempotencyKey},
        ${payloadHash},
        ${this.sql.json(input.payload)},
        ${new Date(now)},
        ${new Date(now)},
        ${input.policyVersion}
      )
      ON CONFLICT (workflow_scope, idempotency_key) DO NOTHING
      RETURNING *
    `;

    if (inserted) {
      return mapWorkflow(inserted);
    }

    const existing = await this.getByIdempotency(
      input.workflowScope,
      input.idempotencyKey,
    );

    if (!existing) {
      throw new Error("Idempotent workflow conflict could not be re-read.");
    }

    if (existing.payloadHash !== payloadHash) {
      throw new IdempotencyPayloadMismatchError(
        input.workflowScope,
        input.idempotencyKey,
      );
    }

    return existing;
  }

  async getByIdempotency(
    workflowScope: string,
    idempotencyKey: string,
  ): Promise<WorkflowIntentRecord | null> {
    const [row] = await this.sql<WorkflowRow[]>`
      SELECT *
      FROM workflow_intents
      WHERE workflow_scope = ${workflowScope}
        AND idempotency_key = ${idempotencyKey}
    `;

    return row ? mapWorkflow(row) : null;
  }

  async compareAndSetState(input: {
    requestId: string;
    expectedState: WorkflowState;
    nextState: WorkflowState;
    failureCode?: string | null;
    externalReference?: string | null;
    onchainReference?: string | null;
    now?: number;
  }): Promise<WorkflowIntentRecord | null> {
    const now = input.now ?? Date.now();
    const terminal =
      input.nextState === "confirmed" ||
      input.nextState === "failed" ||
      input.nextState === "cancelled";

    const [row] = await this.sql<WorkflowRow[]>`
      UPDATE workflow_intents
      SET
        state = ${input.nextState},
        updated_at = ${new Date(now)},
        terminal_at = ${terminal ? new Date(now) : null},
        failure_code = ${input.failureCode ?? null},
        external_reference = COALESCE(
          ${input.externalReference ?? null},
          external_reference
        ),
        onchain_reference = COALESCE(
          ${input.onchainReference ?? null},
          onchain_reference
        )
      WHERE request_id = ${input.requestId}
        AND state = ${input.expectedState}
        AND state NOT IN ('confirmed', 'failed', 'cancelled')
      RETURNING *
    `;

    return row ? mapWorkflow(row) : null;
  }
}

function mapWorkflow(row: WorkflowRow): WorkflowIntentRecord {
  return {
    requestId: row.request_id,
    workflowScope: row.workflow_scope,
    workflowType: row.workflow_type,
    subjectPublicKey: row.subject_public_key?.trim() ?? null,
    state: row.state,
    idempotencyKey: row.idempotency_key,
    payloadHash: row.payload_hash.trim(),
    payload: row.payload,
    createdAt: row.created_at.getTime(),
    updatedAt: row.updated_at.getTime(),
    terminalAt: row.terminal_at?.getTime() ?? null,
    failureCode: row.failure_code,
    retryCount: row.retry_count,
    policyVersion: row.policy_version,
    externalReference: row.external_reference,
    onchainReference: row.onchain_reference,
  };
}
