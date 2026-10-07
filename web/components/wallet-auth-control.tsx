"use client";

import { useEffect, useState } from "react";

import { albedoAuthAdapter } from "../lib/wallet/albedo-auth-adapter";
import { classifyWalletIntentError } from "../lib/wallet/errors";

type WalletAuthState =
  | { status: "checking" }
  | { status: "disconnected" }
  | { status: "requesting_challenge" }
  | { status: "awaiting_wallet" }
  | { status: "verifying" }
  | { status: "authenticated"; publicKey: string }
  | { status: "rejected" }
  | { status: "expired" }
  | { status: "failure" };

interface ChallengeResponse {
  id: string;
  payload: string;
  expiresAt: number;
}

interface SessionResponse {
  authenticated: boolean;
  publicKey?: string;
}

export function WalletAuthControl() {
  const [state, setState] = useState<WalletAuthState>({ status: "checking" });

  useEffect(() => {
    void loadSession();
  }, []);

  async function loadSession() {
    try {
      const response = await fetch("/api/auth/session", {
        method: "GET",
        cache: "no-store",
        credentials: "same-origin",
      });
      const session = (await response.json()) as SessionResponse;

      if (response.ok && session.authenticated && session.publicKey) {
        setState({ status: "authenticated", publicKey: session.publicKey });
        return;
      }

      setState({ status: "disconnected" });
    } catch {
      setState({ status: "failure" });
    }
  }

  async function connect() {
    setState({ status: "requesting_challenge" });

    let challenge: ChallengeResponse;

    try {
      const response = await fetch("/api/auth/challenge", {
        method: "POST",
        credentials: "same-origin",
      });

      if (!response.ok) {
        setState({ status: "failure" });
        return;
      }

      challenge = (await response.json()) as ChallengeResponse;
    } catch {
      setState({ status: "failure" });
      return;
    }

    setState({ status: "awaiting_wallet" });

    let proof;

    try {
      proof = await albedoAuthAdapter.authenticate(challenge.payload);
    } catch (error) {
      setState({
        status:
          classifyWalletIntentError(error) === "rejected"
            ? "rejected"
            : "failure",
      });
      return;
    }

    setState({ status: "verifying" });

    try {
      const response = await fetch("/api/auth/verify", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "same-origin",
        body: JSON.stringify({
          challengeId: challenge.id,
          payload: challenge.payload,
          proof: {
            pubkey: proof.publicKey,
            signed_message: proof.signedMessage,
            signature: proof.signature,
          },
        }),
      });
      const result = (await response.json()) as SessionResponse & {
        code?: string;
      };

      if (response.status === 410 || result.code === "challenge_expired") {
        setState({ status: "expired" });
        return;
      }

      if (!response.ok || !result.authenticated || !result.publicKey) {
        setState({ status: "failure" });
        return;
      }

      setState({ status: "authenticated", publicKey: result.publicKey });
    } catch {
      setState({ status: "failure" });
    }
  }

  async function disconnect() {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "same-origin",
      });
    } finally {
      setState({ status: "disconnected" });
    }
  }

  if (state.status === "authenticated") {
    return (
      <div className="wallet-auth-control wallet-authenticated">
        <div>
          <span className="wallet-auth-label">Verified wallet</span>
          <code className="wallet-public-key">{state.publicKey}</code>
        </div>
        <button
          type="button"
          className="button button-secondary"
          onClick={() => void disconnect()}
        >
          Disconnect
        </button>
      </div>
    );
  }

  const progressLabel = getProgressLabel(state.status);

  return (
    <div className="wallet-auth-control">
      <button
        type="button"
        className="button button-secondary"
        disabled={Boolean(progressLabel)}
        onClick={() => void connect()}
      >
        {progressLabel ?? "Connect Albedo"}
      </button>
      {state.status === "rejected" ? (
        <span className="wallet-auth-error" role="alert">
          Wallet request rejected or cancelled.
        </span>
      ) : null}
      {state.status === "expired" ? (
        <span className="wallet-auth-error" role="alert">
          Authentication challenge expired. Try again.
        </span>
      ) : null}
      {state.status === "failure" ? (
        <span className="wallet-auth-error" role="alert">
          Wallet authentication failed. Try again.
        </span>
      ) : null}
    </div>
  );
}

function getProgressLabel(status: WalletAuthState["status"]): string | null {
  switch (status) {
    case "checking":
      return "Checking session…";
    case "requesting_challenge":
      return "Requesting challenge…";
    case "awaiting_wallet":
      return "Awaiting Albedo approval…";
    case "verifying":
      return "Verifying proof…";
    default:
      return null;
  }
}
