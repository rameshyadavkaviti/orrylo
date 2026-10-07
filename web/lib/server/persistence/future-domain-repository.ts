import { randomUUID } from "node:crypto";

import type { JsonObject } from "../../persistence/json";
import type { DatabaseClient } from "./database";
import { normalizeWalletPublicKey } from "./wallet";

export class PostgresFutureDomainRepository {
  constructor(private readonly sql: DatabaseClient) {}

  async createEligibility(input: {
    walletPublicKey: string;
    eligibilityType: string;
    reason: string;
    becameEligibleAt: number;
    policyVersion: string;
  }): Promise<{ created: boolean; eligibilityId: string | null }> {
    const eligibilityId = randomUUID();
    const publicKey = normalizeWalletPublicKey(input.walletPublicKey);
    const [row] = await this.sql<{ eligibility_id: string }[]>`
      INSERT INTO eligibility_records (
        eligibility_id,
        wallet_public_key,
        eligibility_type,
        reason,
        became_eligible_at,
        status,
        revocation_state,
        policy_version
      )
      VALUES (
        ${eligibilityId},
        ${publicKey},
        ${input.eligibilityType},
        ${input.reason},
        ${new Date(input.becameEligibleAt)},
        'eligible',
        'not_revoked',
        ${input.policyVersion}
      )
      ON CONFLICT (wallet_public_key, eligibility_type) DO NOTHING
      RETURNING eligibility_id
    `;

    return {
      created: Boolean(row),
      eligibilityId: row?.eligibility_id ?? null,
    };
  }

  async createReward(input: {
    walletPublicKey: string;
    rewardType: string;
    amount: string;
    idempotencyKey: string;
    rewardUniquenessKey: string;
    qualifyingEventReference?: string | null;
    launchWindowEvidence?: JsonObject | null;
    policyVersion: string;
    now?: number;
  }): Promise<{ created: boolean; rewardId: string | null }> {
    const rewardId = randomUUID();
    const publicKey = normalizeWalletPublicKey(input.walletPublicKey);
    const now = input.now ?? Date.now();
    const [row] = await this.sql<{ reward_id: string }[]>`
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
        ${publicKey},
        ${input.rewardType},
        ${input.amount},
        'created',
        ${input.idempotencyKey},
        ${input.rewardUniquenessKey},
        ${input.qualifyingEventReference ?? null},
        ${input.launchWindowEvidence
          ? this.sql.json(input.launchWindowEvidence)
          : null},
        ${input.policyVersion},
        ${new Date(now)},
        ${new Date(now)}
      )
      ON CONFLICT DO NOTHING
      RETURNING reward_id
    `;

    return {
      created: Boolean(row),
      rewardId: row?.reward_id ?? null,
    };
  }
}
