/**
 * Draft-only initial-supply validation. This value is NOT part of a saved
 * project or an executable issuance intent until a separately reviewed
 * server-authoritative issuance integration is implemented.
 */
export const STELLAR_MAX_AMOUNT_STROOPS = 9223372036854775807n;

export type InitialSupplyValidation =
  | { valid: true; normalized: string; stroops: bigint }
  | { valid: false; error: string };

export function validateInitialSupply(input: string): InitialSupplyValidation {
  const value = input.trim();
  if (value.length > 40) {
    return {
      valid: false,
      error: "The amount is too long for a Stellar asset.",
    };
  }
  if (!/^[0-9]+(?:\.[0-9]{1,7})?$/.test(value)) {
    return {
      valid: false,
      error: "Enter a positive amount with up to 7 decimal places.",
    };
  }

  const [whole, fraction = ""] = value.split(".");
  const stroops =
    BigInt(whole) * 10_000_000n + BigInt(fraction.padEnd(7, "0") || "0");
  if (stroops <= 0n || stroops > STELLAR_MAX_AMOUNT_STROOPS) {
    return {
      valid: false,
      error:
        "The amount must be above zero and within Stellar's native amount limit.",
    };
  }

  const normalizedWhole = BigInt(whole).toString();
  const normalizedFraction = fraction.replace(/0+$/, "");
  return {
    valid: true,
    normalized: normalizedFraction
      ? `${normalizedWhole}.${normalizedFraction}`
      : normalizedWhole,
    stroops,
  };
}
