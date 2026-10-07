import type { StellarNetwork } from "../config/public-env";
import {
  PostgresChallengeStore,
  PostgresSessionStore,
} from "../server/persistence/auth-repositories";
import { getDatabaseClient } from "../server/persistence/database";
import { WalletAuthService } from "./service";

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
  const sql = getDatabaseClient();

  return new WalletAuthService(
    readServerAuthConfig(),
    new PostgresChallengeStore(sql),
    new PostgresSessionStore(sql),
  );
}
