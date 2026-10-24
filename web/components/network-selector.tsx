"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";

import type { StellarNetwork } from "../lib/config/public-env";

const PREFERENCE_KEY = "orrylo-selected-network";
const EVENT = "orrylo-network-change";

function subscribe(callback: () => void) {
  window.addEventListener(EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

function rememberedNetwork(): StellarNetwork {
  return window.localStorage.getItem(PREFERENCE_KEY) === "public" ? "public" : "testnet";
}

function rememberNetwork(value: StellarNetwork) {
  window.localStorage.setItem(PREFERENCE_KEY, value);
  document.cookie = `orrylo-network=${value}; Path=/; SameSite=Lax; Max-Age=31536000`;
  window.dispatchEvent(new Event(EVENT));
}

/** UI preference only. Financial endpoints independently validate and gate requests. */
export function NetworkSelector() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const savedNetwork = useSyncExternalStore(subscribe, rememberedNetwork, () => "testnet");
  const requested = searchParams.get("network");
  const routeNetwork: StellarNetwork | null =
    requested === "public" || requested === "testnet" ? requested : null;
  const [pendingNetwork, setPendingNetwork] = useState<StellarNetwork | null>(null);
  const [pendingTarget, setPendingTarget] = useState<string | null>(null);
  const currentTarget = `${pathname}?${searchParams.toString()}`;

  // Once the destination has rendered, the URL becomes authoritative again.
  useEffect(() => {
    if (pendingTarget === null) return;
    if (currentTarget === pendingTarget) {
      // State was committed by the router, not just the click.
      setPendingNetwork(null);
      setPendingTarget(null);
    }
  }, [currentTarget, pendingTarget]);

  const network = pendingNetwork ?? routeNetwork ?? savedNetwork;

  function choose(value: StellarNetwork) {
    if (value === network && pathname === "/create" && routeNetwork === value) return;
    // Update the indicator immediately, before any Next.js navigation or server render.
    setPendingNetwork(value);
    const target = `/create?network=${value}`;
    setPendingTarget(target);
    rememberNetwork(value);
    router.push(target);
  }

  return (
    <div
      role="group"
      aria-label="Stellar network selection"
      className="header-network-selector"
      data-network={network}
    >
      <span className="header-network-thumb" aria-hidden="true" />
      {(["testnet", "public"] as const).map((value) => (
        <button
          key={value}
          type="button"
          onClick={() => choose(value)}
          aria-pressed={network === value}
          className={`header-network-choice${network === value ? " header-network-choice-active" : ""}`}
          title={value === "public" ? "Mainnet preview; live payments are gated" : "Stellar Testnet"}
        >
          {value === "public" ? "Mainnet" : "Testnet"}
        </button>
      ))}
    </div>
  );
}
