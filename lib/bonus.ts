/**
 * Promotional calculation only. A real bonus must be funded, verifiably
 * delivered and protected against repeated redemption before activation.
 */
export const BONUS_THRESHOLD_RYLO = 500;
export const BONUS_RATE = 0.36;

export function bonusForQuantity(quantity: number): number {
  if (!Number.isFinite(quantity) || quantity < BONUS_THRESHOLD_RYLO) return 0;
  return Math.round(quantity * BONUS_RATE * 10_000_000) / 10_000_000;
}
