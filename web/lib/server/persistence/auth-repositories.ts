import { createHash, randomBytes } from "node:crypto";

import type { StoredAuthChallenge } from "../../auth/challenge";
import { SESSION_TTL_MS } from "../../auth/constants";
import type {
  AuthSession,
  ChallengeConsumeResult,
  ChallengeStore,
  CreatedAuthSession,
  SessionStore,
} from "../../auth/stores";
import type { DatabaseClient } from "./database";
import { normalizeWalletPublicKey } from "./wallet";

interface ChallengeRow {
  challenge_id: string;
  purpose: StoredAuthChallenge["purpose"];
  domain: string;
  network: StoredAuthChallenge["network"];
  nonce: string;
  issued_at: Date;
  expires_at: Date;
  payload: string;
}

interface SessionRow {
  public_key: string;
  created_at: Date;
  expires_at: Date;
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export class PostgresChallengeStore implements ChallengeStore {
  constructor(private readonly sql: DatabaseClient) {}

  async put(challenge: StoredAuthChallenge): Promise<void> {
    await this.sql`
      INSERT INTO auth_challenges (
        challenge_id,
        purpose,
        domain,
        network,
        nonce,
        issued_at,
        expires_at,
        payload
      )
      VALUES (
        ${challenge.id},
        ${challenge.purpose},
        ${challenge.domain},
        ${challenge.network},
        ${challenge.nonce},
        ${new Date(challenge.issuedAt)},
        ${new Date(challenge.expiresAt)},
        ${challenge.payload}
      )
    `;
  }

  async consume(id: string, now: number): Promise<ChallengeConsumeResult> {
    const [row] = await this.sql<ChallengeRow[]>`
      UPDATE auth_challenges
      SET consumed_at = ${new Date(now)}
      WHERE challenge_id = ${id}
        AND consumed_at IS NULL
        AND expires_at > ${new Date(now)}
      RETURNING
        challenge_id,
        purpose,
        domain,
        network,
        nonce,
        issued_at,
        expires_at,
        payload
    `;

    if (row) {
      return {
        ok: true,
        challenge: {
          id: row.challenge_id,
          purpose: row.purpose,
          domain: row.domain,
          network: row.network,
          nonce: row.nonce,
          issuedAt: row.issued_at.getTime(),
          expiresAt: row.expires_at.getTime(),
          payload: row.payload,
        },
      };
    }

    const [existing] = await this.sql<
      { expires_at: Date; consumed_at: Date | null }[]
    >`
      SELECT expires_at, consumed_at
      FROM auth_challenges
      WHERE challenge_id = ${id}
    `;

    if (
      existing &&
      existing.consumed_at === null &&
      existing.expires_at.getTime() <= now
    ) {
      await this.sql`
        UPDATE auth_challenges
        SET consumed_at = ${new Date(now)}
        WHERE challenge_id = ${id}
          AND consumed_at IS NULL
      `;

      return { ok: false, reason: "expired" };
    }

    return { ok: false, reason: "missing" };
  }
}

export class PostgresSessionStore implements SessionStore {
  constructor(private readonly sql: DatabaseClient) {}

  async create(publicKey: string, now: number): Promise<CreatedAuthSession> {
    const normalizedPublicKey = normalizeWalletPublicKey(publicKey);
    const token = randomBytes(32).toString("base64url");
    const tokenHash = hashSessionToken(token);
    const expiresAt = now + SESSION_TTL_MS;

    await this.sql`
      INSERT INTO auth_sessions (
        token_hash,
        public_key,
        created_at,
        expires_at
      )
      VALUES (
        ${tokenHash},
        ${normalizedPublicKey},
        ${new Date(now)},
        ${new Date(expiresAt)}
      )
    `;

    return {
      token,
      session: {
        publicKey: normalizedPublicKey,
        createdAt: now,
        expiresAt,
      },
    };
  }

  async get(token: string, now: number): Promise<AuthSession | null> {
    const tokenHash = hashSessionToken(token);
    const [row] = await this.sql<SessionRow[]>`
      SELECT public_key, created_at, expires_at
      FROM auth_sessions
      WHERE token_hash = ${tokenHash}
        AND invalidated_at IS NULL
        AND expires_at > ${new Date(now)}
    `;

    if (!row) {
      return null;
    }

    return {
      publicKey: row.public_key.trim(),
      createdAt: row.created_at.getTime(),
      expiresAt: row.expires_at.getTime(),
    };
  }

  async destroy(token: string, now: number): Promise<void> {
    const tokenHash = hashSessionToken(token);

    await this.sql`
      UPDATE auth_sessions
      SET invalidated_at = COALESCE(invalidated_at, ${new Date(now)})
      WHERE token_hash = ${tokenHash}
    `;
  }
}
