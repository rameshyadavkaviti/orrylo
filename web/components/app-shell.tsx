import Link from "next/link";
import type { ReactNode } from "react";

import {
  networkLabel,
  readPublicRuntimeConfig,
} from "../lib/config/public-env";
import { NAV_ITEMS } from "../lib/navigation";
import { StatusPill } from "./status-pill";
import { WalletAuthControl } from "./wallet-auth-control";

export function AppShell({ children }: { children: ReactNode }) {
  const config = readPublicRuntimeConfig();

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Primary">
        <Link className="brand" href="/" aria-label="Orrylo home">
          <span className="brand-mark" aria-hidden="true">
            O
          </span>
          <span>
            <strong>Orrylo</strong>
            <small>Stellar builder</small>
          </span>
        </Link>

        <nav className="nav-list" aria-label="Application">
          {NAV_ITEMS.map((item) => (
            <Link key={item.href} href={item.href} className="nav-link">
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="sidebar-note">
          <span className="eyebrow">Phase</span>
          <strong>Wallet authentication</strong>
          <p>Albedo authentication only. No chain mutations.</p>
        </div>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <div>
            <span className="eyebrow">Orrylo workspace</span>
            <p className="topbar-copy">
              Clear product state, explicit chain boundaries.
            </p>
          </div>
          <div className="topbar-actions">
            <StatusPill tone="warning">
              {networkLabel(config.network)} · product data demo
            </StatusPill>
            <WalletAuthControl />
          </div>
        </header>
        <main className="main-content">{children}</main>
      </div>

      <aside className="status-column" aria-label="System status">
        <div className="status-card">
          <span className="eyebrow">Runtime status</span>
          <StatusRow label="Product data" value="Demo" />
          <StatusRow label="Wallet auth" value="Server-verified" />
          <StatusRow
            label="Contract"
            value={
              config.foundationContractId ? "Configured" : "Not configured"
            }
          />
          <StatusRow label="Transactions" value="Disabled" />
        </div>

        <div className="status-card">
          <span className="eyebrow">Contract Interface v1</span>
          <p className="muted">
            Application compatibility is limited to interface_version(),
            version(), and state() reads.
          </p>
          <StatusPill tone="positive">Expected interface: 1</StatusPill>
        </div>

        <div className="status-card">
          <span className="eyebrow">Safety boundary</span>
          <p className="muted">
            Issuance, RYLO mutations, authorization changes, payments, and admin
            controls are unavailable in this phase.
          </p>
        </div>
      </aside>
    </div>
  );
}

function StatusRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="status-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
