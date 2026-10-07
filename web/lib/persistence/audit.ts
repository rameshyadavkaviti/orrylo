import type { JsonObject } from "./json";

export interface AppendAuditEventInput {
  requestId?: string | null;
  eventType: string;
  source: string;
  targetPublicKey?: string | null;
  occurredAt?: number;
  policyVersion: string;
  metadata: JsonObject;
}

export interface AuditEventRecord {
  eventId: string;
  sequence: string;
  requestId: string | null;
  eventType: string;
  source: string;
  targetPublicKey: string | null;
  occurredAt: number;
  policyVersion: string;
  metadata: JsonObject;
  previousEventHash: string | null;
  eventHash: string;
}
