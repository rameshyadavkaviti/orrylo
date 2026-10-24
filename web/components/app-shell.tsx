"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useEffect, useRef, useState, type ReactNode } from "react";

import { NAV_ITEMS, UTILITY_NAV_ITEMS } from "../lib/navigation";
import { WalletAuthControl } from "./wallet-auth-control";
import { ThemeToggle } from "./theme-toggle";
import { NetworkSelector } from "./network-selector";

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const mobileMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setMenuOpen(false); }, [pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    function handleOutside(event: PointerEvent) {
      if (event.target instanceof Node && !mobileMenuRef.current?.contains(event.target)) setMenuOpen(false);
    }
    function handleKeydown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMenuOpen(false);
        mobileMenuRef.current?.querySelector<HTMLButtonElement>(".mobile-nav-toggle")?.focus();
      }
    }
    document.addEventListener("pointerdown", handleOutside);
    document.addEventListener("keydown", handleKeydown);
    return () => {
      document.removeEventListener("pointerdown", handleOutside);
      document.removeEventListener("keydown", handleKeydown);
    };
  }, [menuOpen]);

  if (pathname?.startsWith("/p/")) {
    return <>{children}</>;
  }

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Primary">
        <Link className="brand" href="/" aria-label="Orrylo home">
          <Image
            className="brand-logo"
            src="/brand/orrylo-logo-1f95ea3.webp"
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

        <div className="mobile-nav-details" ref={mobileMenuRef}>
          <button
            type="button"
            className="mobile-nav-toggle"
            aria-controls="orrylo-primary-navigation"
            aria-expanded={menuOpen}
            aria-label={menuOpen ? "Close navigation menu" : "Open navigation menu"}
            onClick={() => setMenuOpen((current) => !current)}
          >
            <span className="mobile-nav-toggle-icon" aria-hidden="true"><span /><span /><span /></span>
            <span>{menuOpen ? "Close" : "Menu"}</span>
          </button>
          <nav
            id="orrylo-primary-navigation"
            className={`nav-list mobile-nav-panel${menuOpen ? " mobile-nav-panel-open" : ""}`}
            aria-label="Primary navigation"
            aria-hidden={!menuOpen}
          >
            <span className="mobile-nav-heading">Explore Orrylo</span>
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMenuOpen(false)}
                className={`nav-link${pathname === item.href || (item.href !== "/" && pathname?.startsWith(`${item.href}/`)) ? " nav-link-active" : ""}`}
                aria-current={pathname === item.href ? "page" : undefined}
                tabIndex={menuOpen ? 0 : -1}
              >
                <span>{item.label}</span>
                <span className="mobile-nav-arrow" aria-hidden="true">↗</span>
              </Link>
            ))}
          </nav>
        </div>

        <div id="wallet-connect" className="unified-header-actions">
          <Suspense fallback={<div className="header-network-selector header-network-placeholder" aria-label="Loading network selection"><span>Testnet</span><span>Mainnet</span></div>}>
            <NetworkSelector />
          </Suspense>
          <ThemeToggle />
          <WalletAuthControl connectLabel="Connect" />
        </div>
      </aside>

      <div className="workspace">
        <main className="main-content">{children}</main>

        <footer className="site-footer">
          <div className="footer-brand">
            <Image src="/brand/orrylo-logo-1f95ea3.webp" alt="" width={36} height={36} />
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
