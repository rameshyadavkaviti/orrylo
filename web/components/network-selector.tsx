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
    <div role="group" aria-label="Stellar network" className="header-network-selector">
      {(["testnet", "public"] as const).map((value) => (
        <Link
          key={value}
          href={`/create?network=${value}`}
          onClick={() => choose(value)}
          aria-current={network === value ? "true" : undefined}
          className={`header-network-choice${network === value ? " header-network-choice-active" : ""}`}
          title={value === "public" ? "Mainnet preview; live payments are gated" : "Stellar Testnet"}
        >
          {value === "public" ? "Mainnet" : "Testnet"}
        </Link>
      ))}
    </div>
  );
}
