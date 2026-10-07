import type { JsonValue } from "./json";

export type WorkflowState =
  | "created"
  | "approved"
  | "signed"
  | "submitted"
  | "confirmed"
  | "failed"
  | "cancelled";

export interface CreateWorkflowIntentInput {
  workflowScope: string;
  workflowType: string;
  subjectPublicKey?: string | null;
  idempotencyKey: string;
  payload: JsonValue;
  policyVersion: string;
}

export interface WorkflowIntentRecord {
  requestId: string;
  workflowScope: string;
  workflowType: string;
  subjectPublicKey: string | null;
  state: WorkflowState;
  idempotencyKey: string;
  payloadHash: string;
  payload: JsonValue;
  createdAt: number;
  updatedAt: number;
  terminalAt: number | null;
  failureCode: string | null;
  retryCount: number;
  policyVersion: string;
  externalReference: string | null;
  onchainReference: string | null;
}

export class IdempotencyPayloadMismatchError extends Error {
  constructor(
    readonly workflowScope: string,
    readonly idempotencyKey: string,
  ) {
    super("Idempotency key already exists with a different request payload.");
    this.name = "IdempotencyPayloadMismatchError";
  }
}
