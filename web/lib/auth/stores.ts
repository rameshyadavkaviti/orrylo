import { randomBytes } from "node:crypto";

import type { StoredAuthChallenge } from "./challenge";
import { SESSION_TTL_MS } from "./constants";

export type ChallengeConsumeResult =
  | { ok: true; challenge: StoredAuthChallenge }
  | { ok: false; reason: "missing" | "expired" };

export class MemoryChallengeStore {
  private readonly challenges = new Map<string, StoredAuthChallenge>();

  put(challenge: StoredAuthChallenge): void {
    this.pruneExpired(challenge.issuedAt);
    this.challenges.set(challenge.id, challenge);
  }

  consume(id: string, now: number): ChallengeConsumeResult {
    const challenge = this.challenges.get(id);

    if (!challenge) {
      return { ok: false, reason: "missing" };
    }

    // Delete synchronously before any signature verification work occurs.
    // Within one Node.js process this makes the challenge single-use.
    this.challenges.delete(id);

    if (now >= challenge.expiresAt) {
      return { ok: false, reason: "expired" };
    }

    return { ok: true, challenge };
  }

  size(): number {
    return this.challenges.size;
  }

  private pruneExpired(now: number): void {
    for (const [id, challenge] of this.challenges) {
      if (now >= challenge.expiresAt) {
        this.challenges.delete(id);
      }
    }
  }
}

export interface AuthSession {
  publicKey: string;
  createdAt: number;
  expiresAt: number;
}

export interface CreatedAuthSession {
  token: string;
  session: AuthSession;
}

export class MemorySessionStore {
  private readonly sessions = new Map<string, AuthSession>();

  create(
    publicKey: string,
    now: number,
    token = randomBytes(32).toString("base64url"),
  ): CreatedAuthSession {
    this.pruneExpired(now);

    const session = {
      publicKey,
      createdAt: now,
      expiresAt: now + SESSION_TTL_MS,
    };

    this.sessions.set(token, session);

    return { token, session };
  }

  get(token: string, now: number): AuthSession | null {
    const session = this.sessions.get(token);

    if (!session) {
      return null;
    }

    if (now >= session.expiresAt) {
      this.sessions.delete(token);
      return null;
    }

    return session;
  }

  destroy(token: string): void {
    this.sessions.delete(token);
  }

  size(): number {
    return this.sessions.size;
  }

  private pruneExpired(now: number): void {
    for (const [token, session] of this.sessions) {
      if (now >= session.expiresAt) {
        this.sessions.delete(token);
      }
    }
  }
}
