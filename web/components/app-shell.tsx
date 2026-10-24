"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { NAV_ITEMS, UTILITY_NAV_ITEMS } from "../lib/navigation";
import { WalletAuthControl } from "./wallet-auth-control";
import { ThemeToggle } from "./theme-toggle";
import { NetworkSelector } from "./network-selector";

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

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

        <nav className="nav-list desktop-primary-nav" aria-label="Desktop primary navigation">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`nav-link${pathname === item.href || (item.href !== "/" && pathname?.startsWith(`${item.href}/`)) ? " nav-link-active" : ""}`}
              aria-current={pathname === item.href ? "page" : undefined}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <details className="mobile-nav-details">
          <summary className="mobile-nav-toggle" aria-controls="orrylo-primary-navigation">
            <span className="mobile-menu-closed-label" aria-hidden="true">☰ Menu</span>
            <span className="mobile-menu-open-label" aria-hidden="true">✕ Close</span>
          </summary>
          <nav
            id="orrylo-primary-navigation"
            className="nav-list"
            aria-label="Primary navigation"
          >
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={(event) =>
                  event.currentTarget.closest("details")?.removeAttribute("open")
                }
                className={`nav-link${pathname === item.href || (item.href !== "/" && pathname?.startsWith(`${item.href}/`)) ? " nav-link-active" : ""}`}
                aria-current={pathname === item.href ? "page" : undefined}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </details>

        <div id="wallet-connect" className="unified-header-actions">
          <NetworkSelector />
          <ThemeToggle />
          <WalletAuthControl />
        </div>
      </aside>

      <div className="workspace">
        <main className="main-content">{children}</main>

        <footer className="site-footer">
          <div className="footer-brand">
            <Image src="/brand/orrylo-logo.webp" alt="" width={36} height={36} />
            <div><strong>Orrylo</strong><span>Build with confidence on Stellar.</span></div>
          </div>
          <div className="footer-end">
            <nav aria-label="Site utilities">
              {UTILITY_NAV_ITEMS.map((item) => (
                <Link key={item.href} href={item.href}>{item.label}</Link>
              ))}
            </nav>
            <span className="footer-network"><span className="header-network-dot" aria-hidden="true" /> Stellar · Early access</span>
          </div>
        </footer>
      </div>
    </div>
  );
}
