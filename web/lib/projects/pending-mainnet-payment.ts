/** Browser-side duplicate-submission interlock; never evidence of ledger payment. */
export interface PendingMainnetPayment {
  version: 1;
  network: "public";
  orderId: string;
  source: string;
  transactionHash: string;
  unsignedXdr: string;
}

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type PendingRead =
  | {kind: "none"}
  | {kind: "blocked"}
  | {kind: "pending"; value: PendingMainnetPayment};

interface Locks {
  request(
    name: string,
    options: {mode: "exclusive"; ifAvailable: true},
    callback: (lock: object | null) => Promise<boolean>,
  ): Promise<boolean>;
}

const ORDER = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const ACCOUNT = /^G[A-Z2-7]{55}$/;
const HASH = /^[0-9a-f]{64}$/;

function key(orderId: string) {
  return `orrylo:pending-mainnet-payment:v1:${orderId}`;
}

function valid(value: unknown): value is PendingMainnetPayment {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return v.version === 1 && v.network === "public" &&
    typeof v.orderId === "string" && ORDER.test(v.orderId) &&
    typeof v.source === "string" && ACCOUNT.test(v.source) &&
    typeof v.transactionHash === "string" && HASH.test(v.transactionHash) &&
    typeof v.unsignedXdr === "string" && v.unsignedXdr.length > 0 && v.unsignedXdr.length <= 4096;
}

export function readPendingMainnetPayment(store: Store, orderId: string): PendingRead {
  try {
    const raw = store.getItem(key(orderId));
    if (raw === null) return {kind: "none"};
    const value: unknown = JSON.parse(raw);
    if (!valid(value) || value.orderId !== orderId) return {kind: "blocked"};
    return {kind: "pending", value};
  } catch {
    return {kind: "blocked"};
  }
}

export async function withMainnetPaymentHandoff(
  store: Store,
  value: PendingMainnetPayment,
  locks: Locks | undefined,
  openWallet: () => Promise<void>,
): Promise<boolean> {
  if (!valid(value) || !locks) return false;
  return locks.request(key(value.orderId), {mode: "exclusive", ifAvailable: true}, async (lock) => {
    if (!lock || readPendingMainnetPayment(store, value.orderId).kind !== "none") return false;
    try {
      store.setItem(key(value.orderId), JSON.stringify(value));
    } catch {
      return false;
    }
    const stored = readPendingMainnetPayment(store, value.orderId);
    if (stored.kind !== "pending" || stored.value.transactionHash !== value.transactionHash || stored.value.unsignedXdr !== value.unsignedXdr) return false;
    await openWallet();
    return true;
  });
}

/** Clear only when the order is durably paid for the exact pending hash. */
export function clearSettledMainnetPayment(store: Store, orderId: string, transactionHash: string): boolean {
  const pending = readPendingMainnetPayment(store, orderId);
  if (pending.kind !== "pending" || pending.value.transactionHash !== transactionHash) return false;
  try {
    store.removeItem(key(orderId));
    return readPendingMainnetPayment(store, orderId).kind === "none";
  } catch {
    return false;
  }
}
