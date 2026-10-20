"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";

import { NAV_ITEMS, UTILITY_NAV_ITEMS } from "../lib/navigation";
import { WalletAuthControl } from "./wallet-auth-control";
import { HeaderPreferencesMenu } from "./header-preferences-menu";

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  if (pathname?.startsWith("/p/")) {
    return <>{children}</>;
  }

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

        <button
          className="mobile-nav-toggle"
          type="button"
          aria-controls="orrylo-primary-navigation"
          aria-expanded={menuOpen}
          aria-label={menuOpen ? "Close navigation menu" : "Open navigation menu"}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <span aria-hidden="true">{menuOpen ? "✕" : "☰"}</span>
          <span>{menuOpen ? "Close" : "Menu"}</span>
        </button>

        <nav id="orrylo-primary-navigation" className={`nav-list${menuOpen ? " nav-list-open" : ""}`} aria-label="Primary navigation">
          {NAV_ITEMS.map((item) => (
            <Link key={item.href} href={item.href} onClick={() => setMenuOpen(false)} className={`nav-link${pathname === item.href || (item.href !== "/" && pathname?.startsWith(`${item.href}/`)) ? " nav-link-active" : ""}`} aria-current={pathname === item.href ? "page" : undefined}>
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
          <div className="topbar-context">
            <span className="topbar-context-label">Workspace</span>
            <strong>Token Studio</strong>
          </div>
          <div id="wallet-connect" className="topbar-actions">
            <HeaderPreferencesMenu />
            <WalletAuthControl />
          </div>
        </header>

        <main className="main-content">{children}</main>

        <footer className="site-footer">
          <span>Orrylo · Stellar Testnet</span>
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
