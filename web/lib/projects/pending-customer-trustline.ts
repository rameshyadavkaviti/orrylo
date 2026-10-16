/**
 * Non-secret handoff evidence only. The unsigned XDR binds the exact hash,
 * transaction time bounds and customer ChangeTrust operation. This record is
 * a conservative browser-side interlock, never authoritative ledger evidence.
 */
export interface PendingCustomerTrustline {
  version: 1;
  network: "testnet";
  projectId: string;
  assetCode: string;
  destinationPublicKey: string;
  issuerPublicKey: string;
  amount: string;
  transactionHash: string;
  unsignedXdr: string;
  validUntil: number;
}

export type PendingTrustlineRead =
  | { kind: "none" }
  | { kind: "pending"; value: PendingCustomerTrustline }
  | { kind: "blocked" };

type ReconciliationStorage = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
>;

export function pendingCustomerTrustlineKey(projectId: string): string {
  return `orrylo:pending-testnet-change-trust:v1:${projectId}`;
}

export function readPendingCustomerTrustline(
  storage: ReconciliationStorage,
  projectId: string,
): PendingTrustlineRead {
  try {
    const raw = storage.getItem(pendingCustomerTrustlineKey(projectId));
    if (raw === null) return { kind: "none" };
    const parsed: unknown = JSON.parse(raw);
    if (!isPendingCustomerTrustline(parsed) || parsed.projectId !== projectId) {
      return { kind: "blocked" };
    }
    return { kind: "pending", value: parsed };
  } catch {
    // Corrupt or inaccessible storage cannot safely unlock another signature.
    return { kind: "blocked" };
  }
}

export function storePendingCustomerTrustline(
  storage: ReconciliationStorage,
  value: PendingCustomerTrustline,
): boolean {
  if (!isPendingCustomerTrustline(value)) return false;
  const existing = readPendingCustomerTrustline(storage, value.projectId);
  if (existing.kind !== "none") return false;
  try {
    storage.setItem(
      pendingCustomerTrustlineKey(value.projectId),
      JSON.stringify(value),
    );
    const saved = readPendingCustomerTrustline(storage, value.projectId);
    return (
      saved.kind === "pending" &&
      saved.value.transactionHash === value.transactionHash &&
      saved.value.unsignedXdr === value.unsignedXdr
    );
  } catch {
    return false;
  }
}

/** Call only after authoritative readiness or terminal exact-hash proof. */
export function clearResolvedCustomerTrustline(
  storage: ReconciliationStorage,
  projectId: string,
  exactHash: string,
): boolean {
  const pending = readPendingCustomerTrustline(storage, projectId);
  if (
    pending.kind !== "pending" ||
    pending.value.transactionHash !== exactHash
  ) {
    return false;
  }
  try {
    storage.removeItem(pendingCustomerTrustlineKey(projectId));
    return readPendingCustomerTrustline(storage, projectId).kind === "none";
  } catch {
    return false;
  }
}

function isPendingCustomerTrustline(
  value: unknown,
): value is PendingCustomerTrustline {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return (
    item.version === 1 &&
    item.network === "testnet" &&
    typeof item.projectId === "string" &&
    /^[0-9a-f-]{36}$/i.test(item.projectId) &&
    typeof item.assetCode === "string" &&
    /^[A-Z0-9]{1,12}$/.test(item.assetCode) &&
    typeof item.destinationPublicKey === "string" &&
    /^G[A-Z2-7]{55}$/.test(item.destinationPublicKey) &&
    typeof item.issuerPublicKey === "string" &&
    /^G[A-Z2-7]{55}$/.test(item.issuerPublicKey) &&
    typeof item.amount === "string" &&
    /^[0-9]+(?:\.[0-9]{1,7})?$/.test(item.amount) &&
    typeof item.transactionHash === "string" &&
    /^[0-9a-f]{64}$/.test(item.transactionHash) &&
    typeof item.unsignedXdr === "string" &&
    item.unsignedXdr.length > 0 &&
    item.unsignedXdr.length <= 4096 &&
    typeof item.validUntil === "number" &&
    Number.isSafeInteger(item.validUntil) &&
    item.validUntil > 0
  );
}
