/** Only public, explicitly recognized readiness codes may reach the UI. */
const MESSAGES: Record<string, string> = {
  insufficient_customer_xlm:
    "This Stellar Testnet wallet lacks enough spendable XLM for another trustline reserve and fee. Fund the same Testnet wallet, then refresh readiness.",
  destination_not_found:
    "This wallet account does not exist on Stellar Testnet. Activate/fund the Testnet account before creating a trustline.",
  trustline_fee_cap_exceeded:
    "The current Testnet fee exceeds Orrylo's approved customer-fee cap. No wallet action is permitted until the fee is within the limit.",
  fee_below_network_minimum:
    "Orrylo's configured issuer fee is below the current Testnet network minimum. This requires an Orrylo configuration review.",
  insufficient_issuer_native_balance:
    "The Orrylo Testnet Shared Issuer has insufficient spendable XLM for issuance fees. This requires operator attention.",
  issuer_policy_mismatch:
    "The Orrylo Testnet Shared Issuer no longer matches the approved signer, flag, or threshold policy. Signing is blocked until the operator verifies it.",
  trustline_unauthorized:
    "The customer trustline is not authorized by the issuer. It cannot be used for issuance.",
  trustline_capacity_exceeded:
    "The requested asset amount exceeds the wallet's available Stellar trustline capacity. Review a smaller amount.",
  horizon_unavailable:
    "Official Stellar Testnet Horizon is unavailable. Readiness cannot be verified; do not sign or submit a transaction.",
  malformed_horizon_response:
    "Official Stellar Testnet Horizon returned inconsistent or incomplete data. Readiness remains blocked.",
  trustline_configuration_unavailable:
    "Orrylo's Testnet trustline configuration is incomplete. This requires operator attention.",
  unauthenticated:
    "Your wallet session expired. Sign in with Albedo, then recheck trustline readiness.",
  project_not_found:
    "This project is not accessible to the authenticated wallet. Verify the project and connected account.",
  ineligible_project:
    "Only eligible, unissued Shared Issuer projects on Testnet support this trustline step.",
  invalid_request:
    "The reviewed trustline amount or project request is invalid. Recheck the amount.",
};

const GENERIC =
  "Could not verify the exact customer trustline. No issuance was started.";

export function customerTrustlineReadinessMessage(
  errorCode: string | undefined,
): string {
  if (!errorCode || !Object.hasOwn(MESSAGES, errorCode)) return GENERIC;
  return `${MESSAGES[errorCode]} (Code: ${errorCode}). No issuance was started.`;
}
