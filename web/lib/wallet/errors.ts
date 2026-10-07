export type WalletIntentFailure = "rejected" | "wallet_error";

export function classifyWalletIntentError(error: unknown): WalletIntentFailure {
  if (isRecord(error)) {
    if (error.code === -4) {
      return "rejected";
    }

    if (
      typeof error.message === "string" &&
      /reject|cancel|closed/i.test(error.message)
    ) {
      return "rejected";
    }
  }

  return "wallet_error";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
