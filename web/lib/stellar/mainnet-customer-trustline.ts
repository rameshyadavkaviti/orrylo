/**
 * Read-only Mainnet trustline inspection. Testnet issuance is intentionally not imported.
 * A missing trustline requires a wallet-authorized ChangeTrust before issuance.
 */
import { MAINNET_ISSUER } from "../server/projects/mainnet-token-orders";

export type MainnetTrustlineState =
  | { status: "ready"; network: "public"; destination: string; assetCode: string; issuer: string }
  | { status: "signature_required"; network: "public"; destination: string; assetCode: string; issuer: string };

export class MainnetTrustlineError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "MainnetTrustlineError";
  }
}

function stroops(value: string): bigint {
  if (!/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,7})?$/.test(value)) {
    throw new MainnetTrustlineError("invalid_amount");
  }
  const [whole, fraction = ""] = value.split(".");
  const units = BigInt(whole) * 10_000_000n + BigInt(fraction.padEnd(7, "0") || "0");
  if (units < 0n || units > 9_223_372_036_854_775_807n) {
    throw new MainnetTrustlineError("invalid_amount");
  }
  return units;
}

export async function inspectMainnetCustomerTrustline(
  input: { destination: string; assetCode: string; initialSupply: string },
  fetchImpl: typeof fetch = fetch,
): Promise<MainnetTrustlineState> {
  const { destination, assetCode, initialSupply } = input;
  if (!/^G[A-Z2-7]{55}$/.test(destination) || !/^[A-Z0-9]{1,12}$/.test(assetCode)) {
    throw new MainnetTrustlineError("invalid_request");
  }
  const needed = stroops(initialSupply);
  if (needed === 0n) throw new MainnetTrustlineError("invalid_amount");
  let response: Response;
  try {
    response = await fetchImpl(
      `https://horizon.stellar.org/accounts/${encodeURIComponent(destination)}`,
      { method: "GET", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10000) },
    );
  } catch {
    throw new MainnetTrustlineError("horizon_unavailable");
  }
  if (response.status === 404) throw new MainnetTrustlineError("customer_account_not_funded");
  if (!response.ok) throw new MainnetTrustlineError("horizon_unavailable");
  let body: unknown;
  try { body = await response.json(); }
  catch { throw new MainnetTrustlineError("invalid_horizon_response"); }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new MainnetTrustlineError("invalid_horizon_response");
  }
  const account = body as Record<string, unknown>;
  if (account.account_id !== destination || !Array.isArray(account.balances)) {
    throw new MainnetTrustlineError("invalid_horizon_response");
  }
  const balance = account.balances.find((item: unknown) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    const row = item as Record<string, unknown>;
    return row.asset_code === assetCode && row.asset_issuer === MAINNET_ISSUER &&
      row.asset_type === (assetCode.length <= 4 ? "credit_alphanum4" : "credit_alphanum12");
  }) as Record<string, unknown> | undefined;
  const details = { network: "public" as const, destination, assetCode, issuer: MAINNET_ISSUER };
  if (!balance) return { status: "signature_required", ...details };
  if (balance.is_authorized === false || balance.is_authorized_to_maintain_liabilities === true) {
    throw new MainnetTrustlineError("trustline_not_authorized");
  }
  if (typeof balance.limit !== "string" || typeof balance.balance !== "string") {
    throw new MainnetTrustlineError("invalid_horizon_response");
  }
  let freeCapacity: bigint;
  try {
    freeCapacity = stroops(balance.limit) - stroops(balance.balance) -
      stroops(typeof balance.buying_liabilities === "string" ? balance.buying_liabilities : "0");
  } catch {
    throw new MainnetTrustlineError("invalid_horizon_response");
  }
  if (freeCapacity < needed) throw new MainnetTrustlineError("trustline_capacity_insufficient");
  return { status: "ready", ...details };
}
