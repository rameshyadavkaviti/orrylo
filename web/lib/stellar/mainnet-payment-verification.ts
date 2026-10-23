/**
 * Read-only verification of a uniquely bound Mainnet XLM service payment.
 * This is NOT a settlement or entitlement grant: callers must atomically mark
 * the order paid and uniquely consume the transaction hash in PostgreSQL.
 */
const HORIZON = "https://horizon.stellar.org";
const HASH = /^[0-9a-f]{64}$/i;
const ACCOUNT = /^G[A-Z2-7]{55}$/;
const PRICE_STROOPS = 100000000n; // 10 XLM, never 10 stroops

export interface MainnetPaymentIntent {
  transactionHash: string;
  sender: string;
  treasury: string;
  memo: string;
}

export type MainnetPaymentResult =
  | { status: "confirmed"; hash: string; ledger: number }
  | { status: "not_found" }
  | { status: "rejected" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function amountToStroops(value: unknown): bigint | null {
  if (typeof value !== "string" || !/^(0|[1-9]\d*)(?:\.\d{1,7})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * 10000000n + BigInt(fraction.padEnd(7, "0") || "0");
}

export async function verifyMainnetPayment(
  intent: MainnetPaymentIntent,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<MainnetPaymentResult> {
  if (
    !HASH.test(intent.transactionHash) ||
    !ACCOUNT.test(intent.sender) ||
    !ACCOUNT.test(intent.treasury) ||
    intent.sender === intent.treasury ||
    !/^[A-Za-z0-9_-]{1,28}$/.test(intent.memo)
  ) {
    throw new Error("invalid_payment_intent");
  }

  const hash = intent.transactionHash.toLowerCase();
  async function read(path: string): Promise<unknown | null> {
    const response = await fetchImpl(`${HORIZON}${path}`, {
      method: "GET",
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error("mainnet_horizon_unavailable");
    return response.json();
  }

  const transaction = await read(`/transactions/${hash}`);
  if (transaction === null) return { status: "not_found" };
  if (!isRecord(transaction)) throw new Error("invalid_horizon_response");
  if (
    transaction.hash !== hash ||
    transaction.successful !== true ||
    transaction.source_account !== intent.sender ||
    transaction.memo_type !== "text" ||
    transaction.memo !== intent.memo ||
    !Number.isSafeInteger(transaction.ledger) ||
    (transaction.ledger as number) <= 0 ||
    transaction.operation_count !== 1
  ) return { status: "rejected" };

  const operations = await read(`/transactions/${hash}/operations?limit=2`);
  if (!isRecord(operations) || !isRecord(operations._embedded)) {
    throw new Error("invalid_horizon_response");
  }
  const records = operations._embedded.records;
  if (!Array.isArray(records) || records.length !== 1 || !isRecord(records[0])) {
    return { status: "rejected" };
  }
  const payment = records[0];
  if (
    payment.type !== "payment" ||
    payment.source_account !== intent.sender ||
    payment.from !== intent.sender ||
    payment.to !== intent.treasury ||
    payment.asset_type !== "native" ||
    amountToStroops(payment.amount) !== PRICE_STROOPS
  ) return { status: "rejected" };

  return { status: "confirmed", hash, ledger: transaction.ledger as number };
}
