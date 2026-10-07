import { randomBytes } from "node:crypto";

import type { StoredAuthChallenge } from "../../lib/auth/challenge";
import { SESSION_TTL_MS } from "../../lib/auth/constants";
import type {
  AuthSession,
  ChallengeConsumeResult,
  ChallengeStore,
  CreatedAuthSession,
  SessionStore,
} from "../../lib/auth/stores";

export class MemoryChallengeStore implements ChallengeStore {
  private readonly challenges = new Map<string, StoredAuthChallenge>();

  async put(challenge: StoredAuthChallenge): Promise<void> {
    this.challenges.set(challenge.id, challenge);
  }

  async consume(id: string, now: number): Promise<ChallengeConsumeResult> {
    const challenge = this.challenges.get(id);

    if (!challenge) {
      return { ok: false, reason: "missing" };
    }

    this.challenges.delete(id);

    if (now >= challenge.expiresAt) {
      return { ok: false, reason: "expired" };
    }

    return { ok: true, challenge };
  }
}

export class MemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, AuthSession>();

  async create(publicKey: string, now: number): Promise<CreatedAuthSession> {
    const token = randomBytes(32).toString("base64url");
    const session = {
      publicKey,
      createdAt: now,
      expiresAt: now + SESSION_TTL_MS,
    };

    this.sessions.set(token, session);
    return { token, session };
  }

  async get(token: string, now: number): Promise<AuthSession | null> {
    const session = this.sessions.get(token);

    if (!session || now >= session.expiresAt) {
      return null;
    }

    return session;
  }

  async destroy(token: string): Promise<void> {
    this.sessions.delete(token);
  }
}
