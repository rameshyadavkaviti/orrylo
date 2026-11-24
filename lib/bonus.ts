/**
 * Promotional calculation only. A real bonus must be funded, verifiably
 * delivered and protected against repeated redemption before activation.
 */
export const BONUS_THRESHOLD_RYLO = 1000;
export const BONUS_RATE = 0.5;
export const BONUS_CAMPAIGN_ACTIVE = false as boolean;
export const BONUS_CAMPAIGN_STATUS = "awaiting_fulfillment" as const;

export function bonusForQuantity(quantity: number): number {
  if (!Number.isFinite(quantity) || quantity <= BONUS_THRESHOLD_RYLO) return 0;
  return Math.round(quantity * BONUS_RATE * 10_000_000) / 10_000_000;
}
