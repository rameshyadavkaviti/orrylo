import type { StoredAuthChallenge } from "./challenge";

export type ChallengeConsumeResult =
  | { ok: true; challenge: StoredAuthChallenge }
  | { ok: false; reason: "missing" | "expired" };

export interface ChallengeStore {
  put(challenge: StoredAuthChallenge): Promise<void>;
  consume(id: string, now: number): Promise<ChallengeConsumeResult>;
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

export interface SessionStore {
  create(publicKey: string, now: number): Promise<CreatedAuthSession>;
  get(token: string, now: number): Promise<AuthSession | null>;
  destroy(token: string, now: number): Promise<void>;
}
