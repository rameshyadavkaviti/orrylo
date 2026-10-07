import { randomBytes } from "node:crypto";

import type { StellarNetwork } from "../config/public-env";
import { AUTH_PURPOSE, CHALLENGE_TTL_MS } from "./constants";

export interface StoredAuthChallenge {
  id: string;
  purpose: typeof AUTH_PURPOSE;
  domain: string;
  network: StellarNetwork;
  nonce: string;
  issuedAt: number;
  expiresAt: number;
  payload: string;
}

export interface PublicAuthChallenge {
  id: string;
  payload: string;
  expiresAt: number;
}

export interface CreateAuthChallengeOptions {
  domain: string;
  network: StellarNetwork;
  now?: number;
  nonce?: string;
}

export function createAuthChallenge(
  options: CreateAuthChallengeOptions,
): StoredAuthChallenge {
  const issuedAt = options.now ?? Date.now();
  const expiresAt = issuedAt + CHALLENGE_TTL_MS;
  const nonce = options.nonce ?? randomBytes(32).toString("base64url");

  if (!/^[A-Za-z0-9.-]+$/.test(options.domain)) {
    throw new Error("ORRYLO_AUTH_DOMAIN must contain a hostname only.");
  }

  const base = {
    purpose: AUTH_PURPOSE,
    domain: options.domain,
    network: options.network,
    nonce,
    issuedAt,
    expiresAt,
  } as const;

  return {
    id: nonce,
    ...base,
    payload: serializeAuthChallenge(base),
  };
}

function serializeAuthChallenge(input: {
  purpose: typeof AUTH_PURPOSE;
  domain: string;
  network: StellarNetwork;
  nonce: string;
  issuedAt: number;
  expiresAt: number;
}): string {
  return [
    "Orrylo wallet authentication",
    `purpose=${input.purpose}`,
    `domain=${input.domain}`,
    `network=${input.network}`,
    `nonce=${input.nonce}`,
    `issued_at=${new Date(input.issuedAt).toISOString()}`,
    `expires_at=${new Date(input.expiresAt).toISOString()}`,
  ].join("\n");
}

export function toPublicAuthChallenge(
  challenge: StoredAuthChallenge,
): PublicAuthChallenge {
  return {
    id: challenge.id,
    payload: challenge.payload,
    expiresAt: challenge.expiresAt,
  };
}
