import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

import { NAV_ITEMS, UTILITY_NAV_ITEMS } from "../lib/navigation";
import { WalletAuthControl } from "./wallet-auth-control";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Primary">
        <Link className="brand" href="/" aria-label="Orrylo home">
          <Image
            className="brand-logo"
            src="/brand/orrylo-logo.webp"
            alt=""
            width={52}
            height={52}
            priority
          />
          <span>
            <strong>Orrylo</strong>
            <small>Build on Stellar</small>
          </span>
        </Link>

        <nav className="nav-list" aria-label="Primary navigation">
          {NAV_ITEMS.map((item) => (
            <Link key={item.href} href={item.href} className="nav-link">
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="sidebar-note">
          <span className="eyebrow">Early prototype</span>
          <strong>Explore before launch</strong>
          <p>
            Build and explore a token without a wallet. Connect only when a
            later identity or execution step needs it.
          </p>
        </div>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <div>
            <span className="eyebrow">Stellar made approachable</span>
            <p className="topbar-copy">
              Build and preview a Stellar token before you connect a wallet.
            </p>
          </div>
          <div id="wallet-connect" className="topbar-actions">
            <WalletAuthControl />
          </div>
        </header>

        <main className="main-content">{children}</main>

        <footer className="site-footer">
          <span>Orrylo public prototype</span>
          <nav aria-label="Prototype utilities">
            {UTILITY_NAV_ITEMS.map((item) => (
              <Link key={item.href} href={item.href}>
                {item.label}
              </Link>
            ))}
          </nav>
        </footer>
      </div>
    </div>
  );
}
