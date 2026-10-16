import type {
  ImmutableSharedIssuanceIntent,
  ImmutableSharedIssuanceTransactionAttempt,
} from "./shared-issuance-persistence";

export const TEST8926_BOUNDED_RECOVERY_POLICY = Object.freeze({
  policyVersion: "test8926-owner-bounded-recovery-v1",
  requestId: "cda25e25-322b-46fa-9081-fe4c382b5614",
  projectId: "cabb5cec-0140-4d7f-93a5-d37d7b7a5f13",
  ownerPublicKey: "GBJIM6BH2WYV3BLAFR4F6KW6Y7XZV36FBXZFICMWQ5Y7DVL4RGV2CYPB",
  issuerPublicKey: "GBW4IKGPC5Q4YRKGRMNNXTVRZNQZ3DFWFHXSQUAMWLXES75MWTY3TWOV",
  destinationPublicKey:
    "GBJIM6BH2WYV3BLAFR4F6KW6Y7XZV36FBXZFICMWQ5Y7DVL4RGV2CYPB",
  assetCode: "TEST8926",
  amount: "991100.0000000",
  supersededAttemptId: "96708101-1afc-4897-b141-fa6839fe6307",
  supersededTransactionHash:
    "478da69fea287435c93ae284dad2d0de90993c2f92dd758f5f706f77f0eac124",
  nextAttemptNumber: 2,
} as const);

export function isExactTest8926RecoveryIntent(
  intent: ImmutableSharedIssuanceIntent,
  attempt: ImmutableSharedIssuanceTransactionAttempt,
): boolean {
  const policy = TEST8926_BOUNDED_RECOVERY_POLICY;
  return (
    intent.issuanceRequestId === policy.requestId &&
    intent.projectId === policy.projectId &&
    intent.ownerPublicKey === policy.ownerPublicKey &&
    intent.network === "testnet" &&
    intent.issuerPublicKey === policy.issuerPublicKey &&
    intent.destinationPublicKey === policy.destinationPublicKey &&
    intent.assetCode === policy.assetCode &&
    intent.amount === policy.amount &&
    attempt.attemptId === policy.supersededAttemptId &&
    attempt.issuanceRequestId === policy.requestId &&
    attempt.issuanceIntentFingerprint === intent.issuanceIntentFingerprint &&
    attempt.attemptNumber === 1 &&
    attempt.transactionHash === policy.supersededTransactionHash &&
    attempt.transactionSourcePublicKey === policy.issuerPublicKey &&
    attempt.operationSourcePublicKey === policy.issuerPublicKey &&
    attempt.assetCode === policy.assetCode &&
    attempt.issuerPublicKey === policy.issuerPublicKey &&
    attempt.destinationPublicKey === policy.destinationPublicKey &&
    attempt.amount === policy.amount
  );
}
