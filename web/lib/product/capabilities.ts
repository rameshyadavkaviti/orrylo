export const CAPABILITIES = {
  sharedIssuerMutation: false,
  dedicatedIssuerProvisioning: false,
  ryloMutation: false,
  walletConnection: false,
  transactionSubmission: false,
} as const;

export type CapabilityName = keyof typeof CAPABILITIES;

export function capabilityStatus(
  name: CapabilityName,
): "available" | "unavailable" {
  return CAPABILITIES[name] ? "available" : "unavailable";
}
