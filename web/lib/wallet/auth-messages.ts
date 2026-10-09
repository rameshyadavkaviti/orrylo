export interface AuthApiFailure {
  code?: string;
  status: number;
}

export function describeAuthApiFailure({
  code,
  status,
}: AuthApiFailure): string {
  if (code === "untrusted_origin") {
    return "Wallet connection is not configured for this site address. You can still use the token builder without a wallet.";
  }

  if (code === "challenge_expired") {
    return "The wallet challenge expired. Please connect again.";
  }

  if (
    code === "signed_message_mismatch" ||
    code === "invalid_signature" ||
    code === "invalid_signature_format" ||
    code === "invalid_public_key"
  ) {
    return "The Albedo proof could not be verified. Please connect again.";
  }

  if (code === "challenge_missing_or_used") {
    return "That wallet challenge was already used or is no longer available. Please connect again.";
  }

  if (status >= 500) {
    return "Wallet authentication is temporarily unavailable. The token builder still works without a wallet.";
  }

  return "Wallet authentication could not be completed. Please try again.";
}
