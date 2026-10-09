import type { StellarNetwork } from "../config/public-env";
import {
  PostgresChallengeStore,
  PostgresSessionStore,
} from "../server/persistence/auth-repositories";
import { getDatabaseClient } from "../server/persistence/database";
import { WalletAuthService } from "./service";

export function readServerAuthConfig(
  env: NodeJS.ProcessEnv = process.env,
  nodeEnv = process.env.NODE_ENV,
): {
  domain: string;
  network: StellarNetwork;
} {
  const configuredDomain = env.ORRYLO_AUTH_DOMAIN?.trim();
  const domain =
    configuredDomain || (nodeEnv === "production" ? null : "localhost");
  const network = env.NEXT_PUBLIC_STELLAR_NETWORK ?? "testnet";

  if (!domain) {
    throw new Error("ORRYLO_AUTH_DOMAIN is required in production.");
  }

  if (!/^[A-Za-z0-9.-]+$/.test(domain)) {
    throw new Error("ORRYLO_AUTH_DOMAIN must contain a hostname only.");
  }

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
