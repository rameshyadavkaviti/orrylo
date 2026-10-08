import { randomUUID } from "node:crypto";

import { StrKey } from "@stellar/stellar-sdk";

import { assertAuditMetadataSafe, hashAuditEvent } from "../persistence/audit-repository";
import type { DatabaseClient } from "../persistence/database";

export const ELIGIBILITY_TYPE = "FIRST_SUCCESSFUL_TOKEN_CREATION";
export const REWARD_TYPE = "FIRST_TOKEN_CREATION_REWARD";
export const REWARD_AMOUNT = "150.0000000";
export const REWARD_WINDOW_MS = 60 * 24 * 60 * 60 * 1000;
export const REWARD_POLICY_VERSION = "rylo-v1";

export interface TrustedTokenCreationSucceeded {
  readonly type: "TokenCreationSucceeded";
  readonly eventId: string;
  readonly walletPublicKey: string;
  readonly source: string;
  readonly assetReference: string;
  readonly workflowReference: string;
}

export type RewardOutcome =
  | "reward_approved"
  | "reward_already_exists"
  | "outside_reward_window"
  | "launch_not_configured";

export interface EligibilityRewardResult {
  eligibility: "established" | "already_existed";
  reward: RewardOutcome;
  eligibilityId: string;
  rewardId: string | null;
  workflowRequestId: string | null;
}

export function normalizeStellarPublicKey(value: string): string {
  if (typeof value !== "string") throw new Error("Invalid Stellar public key.");
  const key = value.trim().toUpperCase();
  if (!StrKey.isValidEd25519PublicKey(key)) {
    throw new Error("Invalid Stellar public key.");
  }
  return key;
}

export function parseOfficialLaunchAt(value: string | undefined): number | null {
  if (value === undefined || value === "") return null;
  if (!/^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$/.test(value)) {
    throw new Error("Invalid ORRYLO_OFFICIAL_LAUNCH_AT: expected ISO UTC milliseconds.");
  }
  const time = Date.parse(value);
  if (!Number.isFinite(time) || new Date(time).toISOString() !== value) {
    throw new Error("Invalid ORRYLO_OFFICIAL_LAUNCH_AT.");
  }
  return time;
}

export function isWithinRewardWindow(now: number, launchAt: number): boolean {
  return now >= launchAt && now < launchAt + REWARD_WINDOW_MS;
}

function validateEvent(event: TrustedTokenCreationSucceeded): string {
  if (event.type !== "TokenCreationSucceeded" ||
      !/^[A-Za-z0-9:_-]{1,160}$/.test(event.eventId) ||
      !/^[A-Za-z0-9:_-]{1,120}$/.test(event.source) ||
      !/^[A-Za-z0-9:_-]{1,200}$/.test(event.assetReference) ||
      !/^[A-Za-z0-9:_-]{1,200}$/.test(event.workflowReference)) {
    throw new Error("Invalid trusted qualifying event.");
  }
  return normalizeStellarPublicKey(event.walletPublicKey);
}

/**
 * Server-only integration boundary. Only a future reviewed token-creation service
 * may call this; event authenticity is NOT established by this method.
 */
export class EligibilityRewardService {
  constructor(private readonly sql: DatabaseClient) {}

  async processTrustedTokenCreation(
    event: TrustedTokenCreationSucceeded,
    options: { officialLaunchAt?: string; now?: () => number } = {},
  ): Promise<EligibilityRewardResult> {
    const wallet = validateEvent(event);
    const launchAt = parseOfficialLaunchAt(options.officialLaunchAt);
    const now = (options.now ?? Date.now)();
    if (!Number.isSafeInteger(now)) throw new Error("Invalid server time.");

    // Wallet-level transaction lock serializes all reward/eligibility decisions
    // across instances, including distinct qualifying event IDs.
    return this.sql.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${wallet}, 19371))`;
      const [existing] = await tx<{ eligibility_id: string; reason: string }[]>`
        SELECT eligibility_id, reason FROM eligibility_records
        WHERE wallet_public_key = ${wallet} AND eligibility_type = ${ELIGIBILITY_TYPE}
      `;
      const eligibilityId = existing?.eligibility_id ?? randomUUID();
      const firstEvent = existing?.reason ?? event.eventId;
      if (!existing) {
        await tx`
          INSERT INTO eligibility_records
          (eligibility_id, wallet_public_key, eligibility_type, reason,
           became_eligible_at, status, revocation_state, policy_version)
          VALUES (${eligibilityId}, ${wallet}, ${ELIGIBILITY_TYPE},
                  ${event.eventId}, ${new Date(now)}, 'eligible',
                  'not_revoked', ${REWARD_POLICY_VERSION})
        `;
      }

      const [priorReward] = await tx<{ reward_id: string }[]>`
        SELECT reward_id FROM reward_records
        WHERE wallet_public_key = ${wallet} AND reward_type = ${REWARD_TYPE}
      `;
      const reward: RewardOutcome = priorReward
        ? "reward_already_exists"
        : launchAt === null
          ? "launch_not_configured"
          : isWithinRewardWindow(now, launchAt)
            ? "reward_approved"
            : "outside_reward_window";

      let rewardId = priorReward?.reward_id ?? null;
      let workflowRequestId: string | null = null;
      if (reward === "reward_approved") {
        rewardId = randomUUID();
        workflowRequestId = randomUUID();
        const evidence = {
          launchAt: new Date(launchAt!).toISOString(),
          windowEndExclusive: new Date(launchAt! + REWARD_WINDOW_MS).toISOString(),
          evaluatedAt: new Date(now).toISOString(),
          qualifyingEventReference: firstEvent,
        };
        await tx`
          INSERT INTO reward_records
          (reward_id, wallet_public_key, reward_type, amount, status,
           idempotency_key, reward_uniqueness_key, qualifying_event_reference,
           launch_window_evidence, policy_version, created_at, updated_at)
          VALUES (${rewardId}, ${wallet}, ${REWARD_TYPE}, ${REWARD_AMOUNT},
                  'approved', ${"reward:" + wallet}, ${"reward:" + wallet},
                  ${firstEvent}, ${tx.json(evidence)},
                  ${REWARD_POLICY_VERSION}, ${new Date(now)}, ${new Date(now)})
        `;
        const payload = {
          rewardId, rewardType: REWARD_TYPE, amount: REWARD_AMOUNT,
          qualifyingEventReference: firstEvent,
        };
        const { hashJson } = await import("../../persistence/json");
        await tx`
          INSERT INTO workflow_intents
          (request_id, workflow_scope, workflow_type, subject_public_key,
           state, idempotency_key, payload_hash, payload, created_at,
           updated_at, policy_version)
          VALUES (${workflowRequestId}, 'rylo:first-token-reward',
                  'reward_preparation', ${wallet}, 'created',
                  ${"reward:" + wallet}, ${hashJson(payload)},
                  ${tx.json(payload)}, ${new Date(now)}, ${new Date(now)},
                  ${REWARD_POLICY_VERSION})
        `;
        await tx`
          INSERT INTO protected_operation_intents
          (operation_id, workflow_request_id, operation_type,
           target_public_key, parameters, created_at)
          VALUES (${randomUUID()}, ${workflowRequestId}, 'mint', ${wallet},
                  ${tx.json(payload)}, ${new Date(now)})
        `;
      } else if (priorReward) {
        const [workflow] = await tx<{ request_id: string }[]>`
          SELECT request_id FROM workflow_intents
          WHERE workflow_scope = 'rylo:first-token-reward'
            AND idempotency_key = ${"reward:" + wallet}
        `;
        workflowRequestId = workflow?.request_id ?? null;
      }

      // Append only evidence of changes. A retry does not create a misleading
      // second approval, and all evidence commits with the underlying records.
      const eventTypes = [
        ...(!existing ? ["eligibility.established"] : []),
        ...(reward === "reward_approved"
          ? ["reward.approved", "reward.intent_created"]
          : []),
      ];
      for (const eventType of eventTypes) {
        const metadata = {
          eligibilityId,
          rewardId,
          qualifyingEventReference: firstEvent,
          rewardOutcome: reward,
        };
        assertAuditMetadataSafe(metadata);
        const [head] = await tx<{ last_sequence: string; last_event_hash: string | null }[]>`
          SELECT last_sequence::text AS last_sequence, last_event_hash
          FROM audit_chain_heads WHERE chain_id = 'application' FOR UPDATE
        `;
        if (!head) throw new Error("Audit chain head missing.");
        const sequence = (BigInt(head.last_sequence) + 1n).toString();
        const eventId = randomUUID();
        const eventHash = hashAuditEvent({
          eventId, sequence, requestId: workflowRequestId, eventType,
          source: "eligibility-reward-service", targetPublicKey: wallet,
          occurredAt: now, policyVersion: REWARD_POLICY_VERSION,
          metadata, previousEventHash: head.last_event_hash?.trim() ?? null,
        });
        await tx`
          INSERT INTO audit_events
          (event_id, chain_id, sequence, request_id, event_type, source,
           target_public_key, occurred_at, policy_version, metadata,
           previous_event_hash, event_hash)
          VALUES (${eventId}, 'application', ${sequence},
                  ${workflowRequestId}, ${eventType},
                  'eligibility-reward-service', ${wallet}, ${new Date(now)},
                  ${REWARD_POLICY_VERSION}, ${tx.json(metadata)},
                  ${head.last_event_hash}, ${eventHash})
        `;
        await tx`
          UPDATE audit_chain_heads SET last_sequence = ${sequence},
          last_event_hash = ${eventHash} WHERE chain_id = 'application'
        `;
      }
      return {
        eligibility: existing ? "already_existed" as const : "established" as const,
        reward, eligibilityId, rewardId, workflowRequestId,
      };
    });
  }
}
