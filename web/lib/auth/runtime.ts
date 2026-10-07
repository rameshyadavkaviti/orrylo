import type { StellarNetwork } from "../config/public-env";
import { MemoryChallengeStore, MemorySessionStore } from "./stores";
import { WalletAuthService } from "./service";

interface AuthMemoryState {
  challenges: MemoryChallengeStore;
  sessions: MemorySessionStore;
}

declare global {
  // eslint-disable-next-line no-var
  var __orryloAuthMemoryState: AuthMemoryState | undefined;
}

function getMemoryState(): AuthMemoryState {
  if (!globalThis.__orryloAuthMemoryState) {
    globalThis.__orryloAuthMemoryState = {
      challenges: new MemoryChallengeStore(),
      sessions: new MemorySessionStore(),
    };
  }

  return globalThis.__orryloAuthMemoryState;
}

export function readServerAuthConfig(env: NodeJS.ProcessEnv = process.env): {
  domain: string;
  network: StellarNetwork;
} {
  const domain = env.ORRYLO_AUTH_DOMAIN?.trim() || "localhost";
  const network = env.NEXT_PUBLIC_STELLAR_NETWORK ?? "testnet";

  if (network !== "testnet" && network !== "public") {
    throw new Error("NEXT_PUBLIC_STELLAR_NETWORK must be testnet or public.");
  }

  return { domain, network };
}

export function getWalletAuthService(): WalletAuthService {
  const memory = getMemoryState();

  return new WalletAuthService(
    readServerAuthConfig(),
    memory.challenges,
    memory.sessions,
  );
}
