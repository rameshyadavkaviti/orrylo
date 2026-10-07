import type { ReactNode } from "react";

import { networkLabel, readPublicRuntimeConfig } from "../lib/config/public-env";
import { NAV_ITEMS } from "../lib/navigation";
import { StatusPill } from "./status-pill";

export function AppShell({ children }: { children: ReactNode }) {
  const config = readPublicRuntimeConfig();

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Primary">
        <a className="brand" href="/" aria-label="Orrylo home">
          <span className="brand-mark" aria-hidden="true">
            O
          </span>
          <span>
            <strong>Orrylo</strong>
            <small>Stellar builder</small>
          </span>
        </a>

        <nav className="nav-list" aria-label="Application">
          {NAV_ITEMS.map((item) => (
            <a key={item.href} href={item.href} className="nav-link">
              {item.label}
            </a>
          ))}
        </nav>

        <div className="sidebar-note">
          <span className="eyebrow">Phase</span>
          <strong>Application Foundation</strong>
          <p>No live wallet or issuer mutations.</p>
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
              {networkLabel(config.network)} · demo only
            </StatusPill>
            <button type="button" className="button button-secondary" disabled>
              Wallet not connected
            </button>
          </div>
        </header>
        <main className="main-content">{children}</main>
      </div>

      <aside className="status-column" aria-label="System status">
        <div className="status-card">
          <span className="eyebrow">Runtime status</span>
          <StatusRow label="Data" value="Demo" />
          <StatusRow label="Wallet" value="Not connected" />
          <StatusRow
            label="Contract"
            value={config.foundationContractId ? "Configured" : "Not configured"}
          />
          <StatusRow label="Transactions" value="Disabled" />
        </div>

        <div className="status-card">
          <span className="eyebrow">Contract Interface v1</span>
          <p className="muted">
            Application compatibility is limited to interface_version(), version(),
            and state() reads.
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
