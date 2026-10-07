import type { StellarNetwork } from "../config/public-env";
import {
  createAuthChallenge,
  toPublicAuthChallenge,
  type PublicAuthChallenge,
} from "./challenge";
import { AUTH_PURPOSE } from "./constants";
import type { AuthSession, ChallengeStore, SessionStore } from "./stores";
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
    private readonly challenges: ChallengeStore,
    private readonly sessions: SessionStore,
  ) {}

  async createChallenge(
    now = Date.now(),
    nonce?: string,
  ): Promise<PublicAuthChallenge> {
    const challenge = createAuthChallenge({
      ...this.config,
      now,
      nonce,
    });

    await this.challenges.put(challenge);
    return toPublicAuthChallenge(challenge);
  }

  async verifyWallet(
    request: VerifyWalletRequest,
    now = Date.now(),
  ): Promise<VerifyWalletResult> {
    const consumed = await this.challenges.consume(request.challengeId, now);

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

    const created = await this.sessions.create(proof.publicKey, now);

    return {
      ok: true,
      sessionToken: created.token,
      session: created.session,
    };
  }

  async getSession(
    token: string | undefined,
    now = Date.now(),
  ): Promise<AuthSession | null> {
    return token ? this.sessions.get(token, now) : null;
  }

  async logout(token: string | undefined, now = Date.now()): Promise<void> {
    if (token) {
      await this.sessions.destroy(token, now);
    }
  }
}
