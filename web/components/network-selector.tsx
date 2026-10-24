"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";

import type { StellarNetwork } from "../lib/config/public-env";

const PREFERENCE_KEY = "orrylo-selected-network";
const EVENT = "orrylo-network-change";

function subscribe(callback: () => void) {
  window.addEventListener(EVENT, callback);
  window.addEventListener("popstate", callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(EVENT, callback);
    window.removeEventListener("popstate", callback);
    window.removeEventListener("storage", callback);
  };
}

function rememberNetwork(value: StellarNetwork) {
  window.localStorage.setItem(PREFERENCE_KEY, value);
  document.cookie = `orrylo-network=${value}; Path=/; SameSite=Lax; Max-Age=31536000`;
}

function selectedNetwork(): StellarNetwork {
  const requested = new URLSearchParams(window.location.search).get("network");
  if (requested === "public" || requested === "testnet") return requested;
  return window.localStorage.getItem(PREFERENCE_KEY) === "public" ? "public" : "testnet";
}

/** Browser preference only. Financial endpoints independently validate and gate requests. */
export function NetworkSelector() {
  const network = useSyncExternalStore(subscribe, selectedNetwork, () => "testnet");

  function choose(value: StellarNetwork) {
    rememberNetwork(value);
    window.dispatchEvent(new Event(EVENT));
  }

  return (
    <div role="group" aria-label="Stellar network selection" className="header-network-selector" style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: 5, border: "1px solid var(--line)", borderRadius: 12, background: "var(--surface-soft)", flexShrink: 0, whiteSpace: "nowrap" }}>
      {(["testnet", "public"] as const).map((value) => (
        <Link
          key={value}
          href={`/create?network=${value}`}
          onClick={() => choose(value)}
          aria-current={network === value ? "true" : undefined}
          className={`header-network-choice${network === value ? " header-network-choice-active" : ""}`}
          style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: 73, minHeight: 35, padding: "7px 13px", borderRadius: 8, textDecoration: "none", fontSize: 13, fontWeight: 700, lineHeight: "20px", color: network === value ? "var(--text)" : "var(--muted)", background: network === value ? "var(--violet-soft)" : "transparent", boxShadow: network === value ? "inset 0 0 0 1px var(--violet)" : "none" }}
          title={value === "public" ? "Mainnet preview; live payments are gated" : "Stellar Testnet"}
        >
          {value === "public" ? "Mainnet" : "Testnet"}
        </Link>
      ))}
    </div>
  );
}
