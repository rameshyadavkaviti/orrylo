import type { JsonObject } from "../../persistence/json";

export interface TrustedTokenCreationSucceededEvent {
  eventReference: string;
  walletPublicKey: string;
  eventType: "TOKEN_CREATION_SUCCEEDED";
  eventOccurredAt: number;
  associatedReference?: string | null;
  source: string;
  policyVersion: string;
}

export type InvalidQualifyingEventCode =
  | "invalid_event_type"
  | "invalid_event_reference"
  | "invalid_public_key"
  | "invalid_event_timestamp"
  | "invalid_source"
  | "invalid_policy_version"
  | "event_reference_conflict";

export interface EligibilityResult extends JsonObject {
  outcome: "eligibility_established" | "eligibility_already_existed";
  eligibilityId: string;
}

export type RewardResult =
  | (JsonObject & {
      outcome: "reward_approved" | "reward_already_exists";
      rewardId: string;
      workflowRequestId: string;
      protectedOperationId: string;
      amount: "150.0000000";
    })
  | (JsonObject & {
      outcome: "outside_reward_window";
      position: "before_launch" | "after_window";
    })
  | (JsonObject & {
      outcome: "launch_not_configured";
    });

export type EligibilityRewardProcessingResult =
  | {
      outcome: "invalid_event";
      code: InvalidQualifyingEventCode;
    }
  | (JsonObject & {
      outcome: "processed";
      eventReference: string;
      walletPublicKey: string;
      eligibility: EligibilityResult;
      reward: RewardResult;
    });
