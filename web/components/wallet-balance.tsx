"use client";

import { useEffect, useState } from "react";
import type { StellarNetwork } from "../lib/config/public-env";

type BalanceState =
  | { status: "disconnected" }
  | { status: "loading" }
  | { status: "ready"; balance: string }
  | { status: "unfunded" }
  | { status: "unavailable" };

export function WalletBalance({ network }: { network: StellarNetwork }) {
  const [state, setState] = useState<BalanceState>({ status: "loading" });

  useEffect(() => {
    let active = true;
    const controller = new AbortController();

    async function refresh() {
      try {
        const response = await fetch(`/api/wallet/balance?network=${network}`, {
          credentials: "same-origin",
          cache: "no-store",
          signal: controller.signal,
        });
        if (!active) return;
        if (response.status === 401) {
          setState({ status: "disconnected" });
          return;
        }
        if (!response.ok) throw new Error("balance_unavailable");
        const result: unknown = await response.json();
        if (!active || !result || typeof result !== "object" || !("status" in result)) return;
        if (result.status === "unfunded") {
          setState({ status: "unfunded" });
        } else if (result.status === "ready" && "balance" in result && typeof result.balance === "string") {
          setState({ status: "ready", balance: result.balance });
        } else {
          setState({ status: "unavailable" });
        }
      } catch {
        if (active && !controller.signal.aborted) setState({ status: "unavailable" });
      }
    }

    function onAuthChanged() {
      setState({ status: "loading" });
      void refresh();
    }

    setState({ status: "loading" });
    void refresh();
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 20_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("orrylo-auth-changed", onAuthChanged);
    return () => {
      active = false;
      controller.abort();
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("orrylo-auth-changed", onAuthChanged);
    };
  }, [network]);

  return (
    <span className="builder-anonymous-note" role="status" aria-live="polite">
      {state.status === "ready"
        ? `${network === "public" ? "Mainnet" : "Testnet"} balance: ${Number(state.balance).toLocaleString("en-US", { maximumFractionDigits: 7 })} XLM`
        : state.status === "disconnected" ? "Connect wallet to see XLM balance"
        : state.status === "unfunded" ? "Wallet not funded on this network"
        : state.status === "loading" ? "Checking wallet balance…"
        : "Balance temporarily unavailable"}
    </span>
  );
}
