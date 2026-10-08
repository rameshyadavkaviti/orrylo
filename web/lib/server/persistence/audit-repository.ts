import { createHash, randomUUID } from "node:crypto";

import type {
  AppendAuditEventInput,
  AuditEventRecord,
} from "../../persistence/audit";
import { canonicalJson, type JsonObject } from "../../persistence/json";
import type { DatabaseClient } from "./database";
import { normalizeWalletPublicKey } from "./wallet";

const CHAIN_ID = "application";
const SENSITIVE_KEY =
  /(secret|seed|session(?:.?token)?|authorization|signature|signed.?message|private.?key|credential|password)/i;

interface AuditRow {
  event_id: string;
  sequence: string;
  request_id: string | null;
  event_type: string;
  source: string;
  target_public_key: string | null;
  occurred_at: Date;
  policy_version: string;
  metadata: JsonObject;
  previous_event_hash: string | null;
  event_hash: string;
}

interface AuditHeadRow {
  last_sequence: string;
  last_event_hash: string | null;
}

export class PostgresAuditRepository {
  constructor(private readonly sql: DatabaseClient) {}

  async append(input: AppendAuditEventInput): Promise<AuditEventRecord> {
    assertAuditMetadataSafe(input.metadata);

    const targetPublicKey = input.targetPublicKey
      ? normalizeWalletPublicKey(input.targetPublicKey)
      : null;
    const occurredAt = input.occurredAt ?? Date.now();
    const eventId = randomUUID();

    return this.sql.begin(async (transaction) => {
      const [head] = await transaction<
        { last_sequence: string; last_event_hash: string | null }[]
      >`
        SELECT last_sequence::text AS last_sequence, last_event_hash
        FROM audit_chain_heads
        WHERE chain_id = ${CHAIN_ID}
        FOR UPDATE
      `;

      if (!head) {
        throw new Error("Audit chain head is unavailable.");
      }

      const sequence = (BigInt(head.last_sequence) + 1n).toString();
      const eventHash = hashAuditEvent({
        eventId,
        sequence,
        requestId: input.requestId ?? null,
        eventType: input.eventType,
        source: input.source,
        targetPublicKey,
        occurredAt,
        policyVersion: input.policyVersion,
        metadata: input.metadata,
        previousEventHash: head.last_event_hash,
      });

      const [row] = await transaction<AuditRow[]>`
        INSERT INTO audit_events (
          event_id,
          chain_id,
          sequence,
          request_id,
          event_type,
          source,
          target_public_key,
          occurred_at,
          policy_version,
          metadata,
          previous_event_hash,
          event_hash
        )
        VALUES (
          ${eventId},
          ${CHAIN_ID},
          ${sequence},
          ${input.requestId ?? null},
          ${input.eventType},
          ${input.source},
          ${targetPublicKey},
          ${new Date(occurredAt)},
          ${input.policyVersion},
          ${transaction.json(input.metadata)},
          ${head.last_event_hash},
          ${eventHash}
        )
        RETURNING
          event_id,
          sequence::text AS sequence,
          request_id,
          event_type,
          source,
          target_public_key,
          occurred_at,
          policy_version,
          metadata,
          previous_event_hash,
          event_hash
      `;

      await transaction`
        UPDATE audit_chain_heads
        SET last_sequence = ${sequence}, last_event_hash = ${eventHash}
        WHERE chain_id = ${CHAIN_ID}
      `;

      if (!row) {
        throw new Error("Audit event insert did not return a row.");
      }

      return mapAuditRow(row);
    });
  }

  async list(): Promise<AuditEventRecord[]> {
    const rows = await this.sql<AuditRow[]>`
      SELECT
        event_id,
        sequence::text AS sequence,
        request_id,
        event_type,
        source,
        target_public_key,
        occurred_at,
        policy_version,
        metadata,
        previous_event_hash,
        event_hash
      FROM audit_events
      WHERE chain_id = ${CHAIN_ID}
      ORDER BY audit_events.sequence ASC
    `;

    return rows.map(mapAuditRow);
  }

  async verifyChain(): Promise<boolean> {
    return this.sql.begin(async (transaction) => {
      const [head] = await transaction<AuditHeadRow[]>`
        SELECT
          last_sequence::text AS last_sequence,
          CASE
            WHEN last_event_hash IS NULL THEN NULL
            ELSE btrim(last_event_hash)
          END AS last_event_hash
        FROM audit_chain_heads
        WHERE chain_id = ${CHAIN_ID}
        FOR SHARE
      `;

      if (!head) {
        return false;
      }

      const rows = await transaction<AuditRow[]>`
        SELECT
          event_id,
          sequence::text AS sequence,
          request_id,
          event_type,
          source,
          target_public_key,
          occurred_at,
          policy_version,
          metadata,
          previous_event_hash,
          event_hash
        FROM audit_events
        WHERE chain_id = ${CHAIN_ID}
        ORDER BY audit_events.sequence ASC
      `;
      const events = rows.map(mapAuditRow);
      let previousEventHash: string | null = null;
      let expectedSequence = 1n;

      for (const event of events) {
        if (event.sequence !== expectedSequence.toString()) {
          return false;
        }

        if (event.previousEventHash !== previousEventHash) {
          return false;
        }

        const expectedHash = hashAuditEvent({
          eventId: event.eventId,
          sequence: event.sequence,
          requestId: event.requestId,
          eventType: event.eventType,
          source: event.source,
          targetPublicKey: event.targetPublicKey,
          occurredAt: event.occurredAt,
          policyVersion: event.policyVersion,
          metadata: event.metadata,
          previousEventHash,
        });

        if (expectedHash !== event.eventHash) {
          return false;
        }

        previousEventHash = event.eventHash;
        expectedSequence += 1n;
      }

      const finalSequence = (expectedSequence - 1n).toString();

      return (
        head.last_sequence === finalSequence &&
        head.last_event_hash === previousEventHash
      );
    });
  }
}

export function hashAuditEvent(input: {
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
}): string {
  return createHash("sha256")
    .update(
      canonicalJson({
        eventId: input.eventId,
        sequence: input.sequence,
        requestId: input.requestId,
        eventType: input.eventType,
        source: input.source,
        targetPublicKey: input.targetPublicKey,
        occurredAt: new Date(input.occurredAt).toISOString(),
        policyVersion: input.policyVersion,
        metadata: input.metadata,
        previousEventHash: input.previousEventHash,
      }),
      "utf8",
    )
    .digest("hex");
}

export function assertAuditMetadataSafe(metadata: JsonObject): void {
  const encoded = canonicalJson(metadata);

  if (Buffer.byteLength(encoded, "utf8") > 16_384) {
    throw new Error("Audit metadata exceeds the 16 KiB application limit.");
  }

  scan(metadata);
}

function scan(value: JsonObject | JsonObject[keyof JsonObject]): void {
  if (Array.isArray(value)) {
    for (const child of value) {
      if (child !== null && typeof child === "object") {
        scan(child);
      }
    }
    return;
  }

  if (value === null || typeof value !== "object") {
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    if (SENSITIVE_KEY.test(key)) {
      throw new Error("Audit metadata contains a sensitive field name.");
    }

    if (child !== null && typeof child === "object") {
      scan(child);
    }
  }
}

function mapAuditRow(row: AuditRow): AuditEventRecord {
  return {
    eventId: row.event_id,
    sequence: row.sequence,
    requestId: row.request_id,
    eventType: row.event_type,
    source: row.source,
    targetPublicKey: row.target_public_key?.trim() ?? null,
    occurredAt: row.occurred_at.getTime(),
    policyVersion: row.policy_version,
    metadata: row.metadata,
    previousEventHash: row.previous_event_hash?.trim() ?? null,
    eventHash: row.event_hash.trim(),
  };
}
