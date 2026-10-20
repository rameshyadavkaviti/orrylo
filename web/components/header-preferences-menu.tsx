"use client";

import { useEffect, useRef, useState } from "react";

import { NetworkSelector } from "./network-selector";
import { ThemeToggle } from "./theme-toggle";

/** Network selection is display-only: Mainnet remains unavailable. */
export function HeaderPreferencesMenu() {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="header-preferences" ref={root}>
      <button
        type="button"
        className="header-preferences-trigger"
        aria-expanded={open}
        aria-controls="header-preferences-panel"
        aria-label="Network and appearance settings"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="header-network-dot" aria-hidden="true" />
        <span>Testnet</span>
        <span className="header-chevron" aria-hidden="true">{open ? "⌃" : "⌄"}</span>
      </button>
      {open ? (
        <div id="header-preferences-panel" className="header-preferences-panel">
          <div className="header-preferences-heading">
            <strong>Network</strong>
            <span>Stellar Testnet is active</span>
          </div>
          <NetworkSelector />
          <p className="header-preferences-hint">Mainnet is not available yet. Token issuance stays on Testnet.</p>
          <div className="header-preferences-appearance">
            <div>
              <strong>Appearance</strong>
              <span>Switch light or dark mode</span>
            </div>
            <ThemeToggle />
          </div>
        </div>
      ) : null}
    </div>
  );
}
