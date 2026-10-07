export type StellarNetwork = "testnet" | "public";
export type DataMode = "demo";

export interface PublicRuntimeConfig {
  dataMode: DataMode;
  network: StellarNetwork;
  horizonUrl: string;
  rpcUrl: string;
  foundationContractId: string | null;
}

const TESTNET_DEFAULTS = {
  horizonUrl: "https://horizon-testnet.stellar.org",
  rpcUrl: "https://soroban-testnet.stellar.org",
} as const;

export function readPublicRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env,
): PublicRuntimeConfig {
  const dataMode = env.NEXT_PUBLIC_ORRYLO_DATA_MODE ?? "demo";
  if (dataMode !== "demo") {
    throw new Error(
      "Unsupported Orrylo data mode. Application Phase 1 supports demo mode only.",
    );
  }

  const network = env.NEXT_PUBLIC_STELLAR_NETWORK ?? "testnet";
  if (network !== "testnet" && network !== "public") {
    throw new Error("NEXT_PUBLIC_STELLAR_NETWORK must be testnet or public.");
  }

  return {
    dataMode,
    network,
    horizonUrl:
      env.NEXT_PUBLIC_STELLAR_HORIZON_URL ??
      (network === "testnet" ? TESTNET_DEFAULTS.horizonUrl : ""),
    rpcUrl:
      env.NEXT_PUBLIC_STELLAR_RPC_URL ??
      (network === "testnet" ? TESTNET_DEFAULTS.rpcUrl : ""),
    foundationContractId:
      env.NEXT_PUBLIC_FOUNDATION_CONTRACT_ID?.trim() || null,
  };
}

export function networkLabel(network: StellarNetwork): string {
  return network === "testnet" ? "Testnet config" : "Public network config";
}
