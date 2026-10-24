"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import type { StellarNetwork } from "../lib/config/public-env";

const PREFERENCE_KEY = "orrylo-selected-network";

/** UI preference only. Financial endpoints enforce their own network and activation. */
export function NetworkSelector() {
  const [network, setNetwork] = useState<StellarNetwork>("testnet");
  useEffect(() => {
    const urlNetwork = new URLSearchParams(window.location.search).get("network");
    const stored = window.localStorage.getItem(PREFERENCE_KEY);
    const selected = urlNetwork === "public" || urlNetwork === "testnet"
      ? urlNetwork
      : stored === "public" ? "public" : "testnet";
    setNetwork(selected);
  }, []);

  function choose(value: StellarNetwork) {
    setNetwork(value);
    window.localStorage.setItem(PREFERENCE_KEY, value);
    document.cookie = `orrylo-network=${value}; Path=/; SameSite=Lax; Max-Age=31536000`;
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
