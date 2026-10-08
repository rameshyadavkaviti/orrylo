import { randomUUID } from "node:crypto";

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
}

interface RewardRow {
  reward_id: string;
}

interface WorkflowRow {
  request_id: string;
  payload_hash: string;
}

interface ProtectedOperationRow {
  operation_id: string;
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
          ${TOKEN_CREATIO