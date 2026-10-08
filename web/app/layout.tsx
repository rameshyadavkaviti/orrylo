import type { Metadata } from "next";
import type { ReactNode } from "react";

import { AppShell } from "../components/app-shell";
import "./globals.css";
import "./prototype.css";
import "./brand.css";

export const metadata: Metadata = {
  title: "Orrylo — Build on Stellar",
  description:
    "Create a Stellar token draft, explore RYLO membership, and discover Orrylo products and services.",
  icons: {
    icon: "/brand/orrylo-logo.webp",
    shortcut: "/brand/orrylo-logo.webp",
    apple: "/brand/orrylo-logo.webp",
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
