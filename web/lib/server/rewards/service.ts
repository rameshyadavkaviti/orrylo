import { randomUUID } from "node:crypto";

import type postgres from "postgres";

import { hashJson, type JsonObject } from "../../persistence/json";
import {
  assertAuditMetadataSafe,
  hashAuditEvent,
} from "../persistence/audit-repository";
import type { DatabaseClient } from "../persistence/database";
import {
  InvalidStellarPublicKeyError,
  normalizeWalletPublicKey,
} from "../persistence/wallet";
import {
  FIRST_TOKEN_ELIGIBILITY_TYPE,
  FIRST_TOKEN_REWARD_AMOUNT,
  FIRST_TOKEN_REWARD_TYPE,
  REWARD_WINDOW_INTERVAL,
  TOKEN_CREATION_SUCCEEDED_EVENT,
  evaluateRewardWindow,
  parseOfficialLaunchAt,
} from "./policy";
import type {
  EligibilityRewardProcessingResult,
  EligibilityResult,
  InvalidQualifyingEventCode,
  RewardResult,
  TrustedTokenCreationSucceededEvent,
} from "./types";

const AUDIT_CHAIN_ID = "application";
const WORKFLOW_SCOPE = "rylo:first-token-reward";
const WORKFLOW_TYPE = "reward_preparation";

interface ServiceOptions {
  officialLaunchAt?: string;
  now?: () => number;
}

interface StoredEventRow {
  event_fingerprint: string;
  result: EligibilityRewardProcessingResult | null;
  processing_state: "received" | "processed";
}

interface EligibilityRow {
  eligibility_id: string;
  qualifying_event_reference: string;
}

interface RewardRow {
  reward_id: string;
  qualifying_event_reference: string | null;
  policy_version: string;
}

interface WorkflowRow {
  request_id: string;
  payload_hash: string;
}

interface ProtectedOperationRow {
  operation_id: string;
  operation_type: string;
  target_public_key: string | null;
  parameters: JsonObject;
}

export class EligibilityRewardService {
  private readonly now: () => number;

  constructor(
    private readonly sql: DatabaseClient,
    private readonly options: ServiceOptions = {},
  ) {
    this.now = options.now ?? Date.now;
  }

  async processTrustedTokenCreationSucceeded(
    event: TrustedTokenCreationSucceededEvent,
  ): Promise<EligibilityRewardProcessingResult> {
    const validated = validateEvent(event);

    if (!validated.ok) {
      return { outcome: "invalid_event", code: validated.code };
    }

    const launchConfig = parseOfficialLaunchAt(this.options.officialLaunchAt);
    const now = this.now();
    const eventFingerprint = hashJson({
      eventReference: validated.eventReference,
      walletPublicKey: validated.walletPublicKey,
      eventType: TOKEN_CREATION_SUCCEEDED_EVENT,
      eventOccurredAt: validated.eventOccurredAt,
      associatedReference: validated.associatedReference,
      source: validated.source,
      policyVersion: validated.policyVersion,
    });

    return this.sql.begin(async (transaction) => {
      const [insertedEvent] = await transaction<{ event_reference: string }[]>`
        INSERT INTO token_creation_qualifying_events (
          event_reference,
          event_fingerprint,
          wallet_public_key,
          event_type,
          event_occurred_at,
          associated_reference,
          source,
          policy_version,
          processing_state,
          received_at
        )
        VALUES (
          ${validated.eventReference},
          ${eventFingerprint},
          ${validated.walletPublicKey},
          ${TOKEN_CREATION_SUCCEEDED_EVENT},
          ${new Date(validated.eventOccurredAt)},
          ${validated.associatedReference},
          ${validated.source},
          ${validated.policyVersion},
          'received',
          ${new Date(now)}
        )
        ON CONFLICT (event_reference) DO NOTHING
        RETURNING event_reference
      `;

      const [storedEvent] = await transaction<StoredEventRow[]>`
        SELECT event_fingerprint, result, processing_state
        FROM token_creation_qualifying_events
        WHERE event_reference = ${validated.eventReference}
        FOR UPDATE
      `;

      if (
        !storedEvent ||
        storedEvent.event_fingerprint.trim() !== eventFingerprint
      ) {
        return {
          outcome: "invalid_event",
          code: "event_reference_conflict",
        } satisfies EligibilityRewardProcessingResult;
      }

      if (
        !insertedEvent &&
        storedEvent.processing_state === "processed" &&
        storedEvent.result
      ) {
        return storedEvent.result;
      }

      const eligibilityId = randomUUID();
      const [createdEligibility] = await transaction<EligibilityRow[]>`
        INSERT INTO eligibility_records (
          eligibility_id,
          wallet_public_key,
          eligibility_type,
          reason,
          became_eligible_at,
          status,
          revocation_state,
          policy_version,
          qualifying_event_reference
        )
        VALUES (
          ${eligibilityId},
          ${validated.walletPublicKey},
          ${FIRST_TOKEN_ELIGIBILITY_TYPE},
          ${"first successful token creation through Orrylo"},
          ${new Date(now)},
          'eligible',
          'not_revoked',
          ${validated.policyVersion},
          ${validated.eventReference}
        )
        ON CONFLICT (wallet_public_key, eligibility_type) DO NOTHING
        RETURNING eligibility_id, qualifying_event_reference
      `;

      const [eligibility] = createdEligibility
        ? [createdEligibility]
        : await transaction<EligibilityRow[]>`
            SELECT eligibility_id, qualifying_event_reference
            FROM eligibility_records
            WHERE wallet_public_key = ${validated.walletPublicKey}
              AND eligibility_type = ${FIRST_TOKEN_ELIGIBILITY_TYPE}
          `;

      if (!eligibility) {
        throw new Error("Eligibility record could not be established.");
      }

      const eligibilityResult: EligibilityResult = {
        outcome: createdEligibility
          ? "eligibility_established"
          : "eligibility_already_existed",
        eligibilityId: eligibility.eligibility_id,
      };

      await appendAudit(transaction, {
        eventType: createdEligibility
          ? "eligibility.established"
          : "eligibility.reused",
        targetPublicKey: validated.walletPublicKey,
        policyVersion: validated.policyVersion,
        occurredAt: now,
        metadata: {
          qualifyingEventReference: validated.eventReference,
          eligibilityId: eligibility.eligibility_id,
          eligibilityType: FIRST_TOKEN_ELIGIBILITY_TYPE,
        },
      });

      await appendAudit(transaction, {
        eventType: createdEligibility
          ? "reward.evaluated"
          : "reward.decision.reused",
        targetPublicKey: validated.walletPublicKey,
        policyVersion: validated.policyVersion,
        occurredAt: now,
        metadata: {
          qualifyingEventReference: validated.eventReference,
          rewardType: FIRST_TOKEN_REWARD_TYPE,
          launchConfigured: launchConfig.configured,
        },
      });

      let rewardResult: RewardResult;

      if (!createdEligibility) {
        const [firstEvent] = await transaction<StoredEventRow[]>`
          SELECT event_fingerprint, result, processing_state
          FROM token_creation_qualifying_events
          WHERE event_reference = ${eligibility.qualifying_event_reference}
            AND wallet_public_key = ${validated.walletPublicKey}
        `;

        if (
          firstEvent?.processing_state !== "processed" ||
          firstEvent.result?.outcome !== "processed" ||
          firstEvent.result.eligibility.eligibilityId !==
            eligibility.eligibility_id
        ) {
          throw new Error(
            "Original first-token reward decision is unavailable.",
          );
        }

        const firstReward = firstEvent.result.reward;

        if (
          firstReward.outcome === "reward_approved" ||
          firstReward.outcome === "reward_already_exists"
        ) {
          const [originalReward] = await transaction<
            { launch_window_evidence: JsonObject; policy_version: string }[]
          >`
            SELECT launch_window_evidence, policy_version
            FROM reward_records
            WHERE reward_id = ${firstReward.rewardId}
              AND wallet_public_key = ${validated.walletPublicKey}
              AND reward_type = ${FIRST_TOKEN_REWARD_TYPE}
              AND qualifying_event_reference = ${eligibility.qualifying_event_reference}
          `;
          const launchAt = Date.parse(
            String(originalReward?.launch_window_evidence?.launchAt),
          );
          const windowEnd = Date.parse(
            String(originalReward?.launch_window_evidence?.windowEnd),
          );

          if (
            !originalReward ||
            !Number.isFinite(launchAt) ||
            !Number.isFinite(windowEnd)
          ) {
            throw new Error(
              "Original first-token reward evidence is unavailable.",
            );
          }

          rewardResult = await ensureRewardPreparation(transaction, {
            walletPublicKey: validated.walletPublicKey,
            qualifyingEventReference: eligibility.qualifying_event_reference,
            policyVersion: originalReward.policy_version,
            now,
            launchAt,
            windowEnd,
          });
        } else {
          rewardResult = firstReward;

          await appendAudit(transaction, {
            eventType: "reward.skipped.first_token_decision",
            targetPublicKey: validated.walletPublicKey,
            policyVersion: validated.policyVersion,
            occurredAt: now,
            metadata: {
              qualifyingEventReference: eligibility.qualifying_event_reference,
              observedEventReference: validated.eventReference,
              rewardType: FIRST_TOKEN_REWARD_TYPE,
              originalOutcome: firstReward.outcome,
            },
          });
        }
      } else if (!launchConfig.configured) {
        rewardResult = { outcome: "launch_not_configured" };

        await appendAudit(transaction, {
          eventType: "reward.skipped.launch_not_configured",
          targetPublicKey: validated.walletPublicKey,
          policyVersion: validated.policyVersion,
          occurredAt: now,
          metadata: {
            qualifyingEventReference: validated.eventReference,
            rewardType: FIRST_TOKEN_REWARD_TYPE,
          },
        });
      } else {
        const windowPosition = evaluateRewardWindow(now, launchConfig);

        if (windowPosition !== "inside_window") {
          rewardResult = {
            outcome: "outside_reward_window",
            position: windowPosition,
          };

          await appendAudit(transaction, {
            eventType: "reward.skipped.outside_window",
            targetPublicKey: validated.walletPublicKey,
            policyVersion: validated.policyVersion,
            occurredAt: now,
            metadata: {
              qualifyingEventReference: validated.eventReference,
              rewardType: FIRST_TOKEN_REWARD_TYPE,
              position: windowPosition,
              launchAt: new Date(launchConfig.launchAt).toISOString(),
              windowEnd: new Date(launchConfig.windowEnd).toISOString(),
              interval: REWARD_WINDOW_INTERVAL,
            },
          });
        } else {
          rewardResult = await ensureRewardPreparation(transaction, {
            walletPublicKey: validated.walletPublicKey,
            qualifyingEventReference: validated.eventReference,
            policyVersion: validated.policyVersion,
            now,
            launchAt: launchConfig.launchAt,
            windowEnd: launchConfig.windowEnd,
          });
        }
      }

      const result = {
        outcome: "processed",
        eventReference: validated.eventReference,
        walletPublicKey: validated.walletPublicKey,
        eligibility: eligibilityResult,
        reward: rewardResult,
      } satisfies EligibilityRewardProcessingResult;

      await transaction`
        UPDATE token_creation_qualifying_events
        SET
          processing_state = 'processed',
          result = ${transaction.json(result)},
          processed_at = ${new Date(now)}
        WHERE event_reference = ${validated.eventReference}
      `;

      return result;
    });
  }
}

type TransactionClient = postgres.TransactionSql;

async function ensureRewardPreparation(
  transaction: TransactionClient,
  input: {
    walletPublicKey: string;
    qualifyingEventReference: string;
    policyVersion: string;
    now: number;
    launchAt: number;
    windowEnd: number;
  },
): Promise<RewardResult> {
  const rewardId = randomUUID();
  const rewardIdempotencyKey = `${FIRST_TOKEN_REWARD_TYPE}:${input.walletPublicKey}`;
  const rewardUniquenessKey = rewardIdempotencyKey;
  const launchWindowEvidence: JsonObject = {
    evaluatedAt: new Date(input.now).toISOString(),
    launchAt: new Date(input.launchAt).toISOString(),
    windowEnd: new Date(input.windowEnd).toISOString(),
    interval: REWARD_WINDOW_INTERVAL,
  };
  const [createdReward] = await transaction<RewardRow[]>`
    INSERT INTO reward_records (
      reward_id,
      wallet_public_key,
      reward_type,
      amount,
      status,
      idempotency_key,
      reward_uniqueness_key,
      qualifying_event_reference,
      launch_window_evidence,
      policy_version,
      created_at,
      updated_at
    )
    VALUES (
      ${rewardId},
      ${input.walletPublicKey},
      ${FIRST_TOKEN_REWARD_TYPE},
      ${FIRST_TOKEN_REWARD_AMOUNT},
      'approved',
      ${rewardIdempotencyKey},
      ${rewardUniquenessKey},
      ${input.qualifyingEventReference},
      ${transaction.json(launchWindowEvidence)},
      ${input.policyVersion},
      ${new Date(input.now)},
      ${new Date(input.now)}
    )
    ON CONFLICT DO NOTHING
    RETURNING reward_id, qualifying_event_reference, policy_version
  `;

  const [reward] = createdReward
    ? [createdReward]
    : await transaction<RewardRow[]>`
        SELECT reward_id, qualifying_event_reference, policy_version
        FROM reward_records
        WHERE wallet_public_key = ${input.walletPublicKey}
          AND reward_type = ${FIRST_TOKEN_REWARD_TYPE}
      `;

  if (!reward) {
    throw new Error("Reward record could not be established.");
  }

  const rewardQualifyingEventReference =
    reward.qualifying_event_reference ?? input.qualifyingEventReference;
  const rewardPolicyVersion = reward.policy_version;

  await appendAudit(transaction, {
    eventType: createdReward ? "reward.approved" : "reward.already_exists",
    targetPublicKey: input.walletPublicKey,
    policyVersion: rewardPolicyVersion,
    occurredAt: input.now,
    metadata: {
      qualifyingEventReference: rewardQualifyingEventReference,
      rewardId: reward.reward_id,
      rewardType: FIRST_TOKEN_REWARD_TYPE,
      amount: FIRST_TOKEN_REWARD_AMOUNT,
    },
  });

  const workflowPayload = {
    rewardId: reward.reward_id,
    rewardType: FIRST_TOKEN_REWARD_TYPE,
    amount: FIRST_TOKEN_REWARD_AMOUNT,
    walletPublicKey: input.walletPublicKey,
    qualifyingEventReference: rewardQualifyingEventReference,
  } as const;
  const workflowPayloadHash = hashJson({
    workflowType: WORKFLOW_TYPE,
    subjectPublicKey: input.walletPublicKey,
    policyVersion: rewardPolicyVersion,
    payload: workflowPayload,
  });
  const workflowRequestId = randomUUID();
  const workflowIdempotencyKey = `reward:${reward.reward_id}`;
  const [createdWorkflow] = await transaction<WorkflowRow[]>`
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
      ${workflowRequestId},
      ${WORKFLOW_SCOPE},
      ${WORKFLOW_TYPE},
      ${input.walletPublicKey},
      'approved',
      ${workflowIdempotencyKey},
      ${workflowPayloadHash},
      ${transaction.json(workflowPayload)},
      ${new Date(input.now)},
      ${new Date(input.now)},
      ${rewardPolicyVersion}
    )
    ON CONFLICT (workflow_scope, idempotency_key) DO NOTHING
    RETURNING request_id, payload_hash
  `;

  const [workflow] = createdWorkflow
    ? [createdWorkflow]
    : await transaction<WorkflowRow[]>`
        SELECT request_id, payload_hash
        FROM workflow_intents
        WHERE workflow_scope = ${WORKFLOW_SCOPE}
          AND idempotency_key = ${workflowIdempotencyKey}
      `;

  if (!workflow || workflow.payload_hash.trim() !== workflowPayloadHash) {
    throw new Error("Reward workflow idempotency conflict.");
  }

  const protectedOperationId = randomUUID();
  const protectedParameters = {
    rewardId: reward.reward_id,
    rewardType: FIRST_TOKEN_REWARD_TYPE,
    amount: FIRST_TOKEN_REWARD_AMOUNT,
    qualifyingEventReference: rewardQualifyingEventReference,
    execution: "future_reward_mint",
  } as const;
  const [createdProtectedOperation] = await transaction<
    ProtectedOperationRow[]
  >`
      INSERT INTO protected_operation_intents (
        operation_id,
        workflow_request_id,
        operation_type,
        target_public_key,
        parameters,
        created_at
      )
      VALUES (
        ${protectedOperationId},
        ${workflow.request_id},
        'mint',
        ${input.walletPublicKey},
        ${transaction.json(protectedParameters)},
        ${new Date(input.now)}
      )
      ON CONFLICT (workflow_request_id) DO NOTHING
      RETURNING operation_id, operation_type, target_public_key, parameters
    `;

  const [protectedOperation] = createdProtectedOperation
    ? [createdProtectedOperation]
    : await transaction<ProtectedOperationRow[]>`
        SELECT operation_id, operation_type, target_public_key, parameters
        FROM protected_operation_intents
        WHERE workflow_request_id = ${workflow.request_id}
      `;

  if (!protectedOperation) {
    throw new Error("Protected reward mint intent could not be established.");
  }

  if (
    protectedOperation.operation_type !== "mint" ||
    protectedOperation.target_public_key?.trim() !== input.walletPublicKey ||
    hashJson(protectedOperation.parameters) !== hashJson(protectedParameters)
  ) {
    throw new Error("Protected reward mint intent idempotency conflict.");
  }

  if (createdWorkflow) {
    await appendAudit(transaction, {
      eventType: "reward.workflow_intent.created",
      requestId: workflow.request_id,
      targetPublicKey: input.walletPublicKey,
      policyVersion: input.policyVersion,
      occurredAt: input.now,
      metadata: {
        rewardId: reward.reward_id,
        workflowRequestId: workflow.request_id,
        protectedOperationId: protectedOperation.operation_id,
        workflowType: WORKFLOW_TYPE,
      },
    });
  }

  return {
    outcome: createdReward ? "reward_approved" : "reward_already_exists",
    rewardId: reward.reward_id,
    workflowRequestId: workflow.request_id,
    protectedOperationId: protectedOperation.operation_id,
    amount: FIRST_TOKEN_REWARD_AMOUNT,
  };
}

async function appendAudit(
  transaction: TransactionClient,
  input: {
    requestId?: string | null;
    eventType: string;
    targetPublicKey: string;
    occurredAt: number;
    policyVersion: string;
    metadata: JsonObject;
  },
): Promise<void> {
  assertAuditMetadataSafe(input.metadata);

  const [head] = await transaction<
    { last_sequence: string; last_event_hash: string | null }[]
  >`
    SELECT
      last_sequence::text AS last_sequence,
      CASE
        WHEN last_event_hash IS NULL THEN NULL
        ELSE btrim(last_event_hash)
      END AS last_event_hash
    FROM audit_chain_heads
    WHERE chain_id = ${AUDIT_CHAIN_ID}
    FOR UPDATE
  `;

  if (!head) {
    throw new Error("Audit chain head is unavailable.");
  }

  const eventId = randomUUID();
  const sequence = (BigInt(head.last_sequence) + 1n).toString();
  const eventHash = hashAuditEvent({
    eventId,
    sequence,
    requestId: input.requestId ?? null,
    eventType: input.eventType,
    source: "eligibility-reward-service",
    targetPublicKey: input.targetPublicKey,
    occurredAt: input.occurredAt,
    policyVersion: input.policyVersion,
    metadata: input.metadata,
    previousEventHash: head.last_event_hash,
  });

  await transaction`
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
      ${AUDIT_CHAIN_ID},
      ${sequence},
      ${input.requestId ?? null},
      ${input.eventType},
      ${"eligibility-reward-service"},
      ${input.targetPublicKey},
      ${new Date(input.occurredAt)},
      ${input.policyVersion},
      ${transaction.json(input.metadata)},
      ${head.last_event_hash},
      ${eventHash}
    )
  `;

  await transaction`
    UPDATE audit_chain_heads
    SET last_sequence = ${sequence}, last_event_hash = ${eventHash}
    WHERE chain_id = ${AUDIT_CHAIN_ID}
  `;
}

function validateEvent(event: TrustedTokenCreationSucceededEvent):
  | {
      ok: true;
      eventReference: string;
      walletPublicKey: string;
      eventOccurredAt: number;
      associatedReference: string | null;
      source: string;
      policyVersion: string;
    }
  | { ok: false; code: InvalidQualifyingEventCode } {
  if (event.eventType !== TOKEN_CREATION_SUCCEEDED_EVENT) {
    return { ok: false, code: "invalid_event_type" };
  }

  const eventReference = event.eventReference.trim();

  if (!eventReference || eventReference.length > 512) {
    return { ok: false, code: "invalid_event_reference" };
  }

  let walletPublicKey: string;

  try {
    walletPublicKey = normalizeWalletPublicKey(event.walletPublicKey);
  } catch (error) {
    if (error instanceof InvalidStellarPublicKeyError) {
      return { ok: false, code: "invalid_public_key" };
    }

    throw error;
  }

  if (
    !Number.isFinite(event.eventOccurredAt) ||
    !Number.isFinite(new Date(event.eventOccurredAt).getTime())
  ) {
    return { ok: false, code: "invalid_event_timestamp" };
  }

  const source = event.source.trim();

  if (!source || source.length > 128) {
    return { ok: false, code: "invalid_source" };
  }

  const policyVersion = event.policyVersion.trim();

  if (!policyVersion || policyVersion.length > 128) {
    return { ok: false, code: "invalid_policy_version" };
  }

  const associatedReference = event.associatedReference?.trim() || null;

  if (associatedReference && associatedReference.length > 512) {
    return { ok: false, code: "invalid_event_reference" };
  }

  return {
    ok: true,
    eventReference,
    walletPublicKey,
    eventOccurredAt: event.eventOccurredAt,
    associatedReference,
    source,
    policyVersion,
  };
}
