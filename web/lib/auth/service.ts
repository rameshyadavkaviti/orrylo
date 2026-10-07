import type { StellarNetwork } from "../config/public-env";
import {
  createAuthChallenge,
  toPublicAuthChallenge,
  type PublicAuthChallenge,
} from "./challenge";
import { AUTH_PURPOSE } from "./constants";
import {
  MemoryChallengeStore,
  MemorySessionStore,
  type AuthSession,
} from "./stores";
import {
  verifyAlbedoPublicKeyProof,
  type AlbedoPublicKeyProof,
  type AlbedoProofFailure,
} from "./verify-albedo";

export interface AuthServiceConfig {
  domain: string;
  network: StellarNetwork;
}

export interface VerifyWalletRequest {
  challengeId: string;
  payload: string;
  proof: AlbedoPublicKeyProof;
}

export type VerifyWalletFailureCode =
  | "challenge_missing_or_used"
  | "challenge_expired"
  | "challenge_mismatch"
  | AlbedoProofFailure;

export type VerifyWalletResult =
  | {
      ok: true;
      sessionToken: string;
      session: AuthSession;
    }
  | {
      ok: false;
      code: VerifyWalletFailureCode;
    };

export class WalletAuthService {
  constructor(
    private readonly config: AuthServiceConfig,
    private readonly challenges: MemoryChallengeStore,
    private readonly sessions: MemorySessionStore,
  ) {}

  createChallenge(now = Date.now(), nonce?: string): PublicAuthChallenge {
    const challenge = createAuthChallenge({
      ...this.config,
      now,
      nonce,
    });

    this.challenges.put(challenge);
    return toPublicAuthChallenge(challenge);
  }

  verifyWallet(
    request: VerifyWalletRequest,
    now = Date.now(),
    sessionToken?: string,
  ): VerifyWalletResult {
    const consumed = this.challenges.consume(request.challengeId, now);

    if (!consumed.ok) {
      return {
        ok: false,
        code:
          consumed.reason === "expired"
            ? "challenge_expired"
            : "challenge_missing_or_used",
      };
    }

    const challenge = consumed.challenge;

    if (
      challenge.purpose !== AUTH_PURPOSE ||
      challenge.domain !== this.config.domain ||
      challenge.network !== this.config.network ||
      request.payload !== challenge.payload
    ) {
      return { ok: false, code: "challenge_mismatch" };
    }

    const proof = verifyAlbedoPublicKeyProof(challenge.payload, request.proof);

    if (!proof.ok) {
      return { ok: false, code: proof.reason };
    }

    const created = this.sessions.create(proof.publicKey, now, sessionToken);

    return {
      ok: true,
      sessionToken: created.token,
      session: created.session,
    };
  }

  getSession(token: string | undefined, now = Date.now()): AuthSession | null {
    return token ? this.sessions.get(token, now) : null;
  }

  logout(token: string | undefined): void {
    if (token) {
      this.sessions.destroy(token);
    }
  }
}
