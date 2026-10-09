"use client";

import { useEffect, useState } from "react";

import { albedoAuthAdapter } from "../lib/wallet/albedo-auth-adapter";
import { describeAuthApiFailure } from "../lib/wallet/auth-messages";
import { classifyWalletIntentError } from "../lib/wallet/errors";

type WalletAuthState =
  | { status: "disconnected" }
  | { status: "requesting_challenge" }
  | { status: "awaiting_wallet" }
  | { status: "verifying" }
  | { status: "authenticated"; publicKey: string }
  | { status: "rejected" }
  | { status: "failure"; message: string };

interface ChallengeResponse {
  id: string;
  payload: string;
  expiresAt: number;
}

interface SessionResponse {
  authenticated: boolean;
  publicKey?: string;
  code?: string;
}

export function WalletAuthControl() {
  const [state, setState] = useState<WalletAuthState>({
    status: "disconnected",
  });

  useEffect(() => {
    let active = true;

    void (async () => {
      try {
        const response = await fetch("/api/auth/session", {
          method: "GET",
          cache: "no-store",
          credentials: "same-origin",
        });
        const session = await readJson<SessionResponse>(response);

        if (!active) {
          return;
        }

        if (response.ok && session?.authenticated && session.publicKey) {
          setState({ status: "authenticated", publicKey: session.publicKey });
          return;
        }

        setState({ status: "disconnected" });
      } catch {
        if (active) {
          setState({ status: "disconnected" });
        }
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  async function connect() {
    setState({ status: "requesting_challenge" });

    let challenge: ChallengeResponse;

    try {
      const response = await fetch("/api/auth/challenge", {
        method: "POST",
        credentials: "same-origin",
      });
      const result = await readJson<ChallengeResponse & { code?: string }>(
        response,
      );

      if (!response.ok || !result?.id || !result.payload) {
        setState({
          status: "failure",
          message: describeAuthApiFailure({
            code: result?.code,
            status: response.status,
          }),
        });
        return;
      }

      challenge = result;
    } catch {
      setState({
        status: "failure",
        message:
          "Wallet authentication is temporarily unavailable. The token builder still works without a wallet.",
      });
      return;
    }

    setState({ status: "awaiting_wallet" });

    let proof;

    try {
      proof = await albedoAuthAdapter.authenticate(challenge.payload);
    } catch (error) {
      if (classifyWalletIntentError(error) === "rejected") {
        setState({ status: "rejected" });
      } else {
        setState({
          status: "failure",
          message:
            "Albedo could not complete the wallet request. Please try again.",
        });
      }
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
      const result = await readJson<SessionResponse>(response);

      if (!response.ok || !result?.authenticated || !result.publicKey) {
        setState({
          status: "failure",
          message: describeAuthApiFailure({
            code: result?.code,
            status: response.status,
          }),
        });
        return;
      }

      setState({ status: "authenticated", publicKey: result.publicKey });
    } catch {
      setState({
        status: "failure",
        message:
          "Wallet verification is temporarily unavailable. Your token configuration is still available.",
      });
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
        {progressLabel ?? "Connect Wallet"}
      </button>
      {state.status === "rejected" ? (
        <span className="wallet-auth-error" role="alert">
          Wallet request rejected or cancelled.
        </span>
      ) : null}
      {state.status === "failure" ? (
        <span className="wallet-auth-error" role="alert">
          {state.message}
        </span>
      ) : null}
    </div>
  );
}

function getProgressLabel(status: WalletAuthState["status"]): string | null {
  switch (status) {
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

async function readJson<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}
