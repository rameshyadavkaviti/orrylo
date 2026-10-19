import type { Metadata } from "next";
import type { ReactNode } from "react";

import { AppShell } from "../components/app-shell";
import "./globals.css";
import "./prototype.css";
import "./brand.css";
import "./clean-mvp.css";

export const metadata: Metadata = {
  title: "Orrylo — Build on Stellar",
  description:
    "Design and preview a Stellar token without connecting a wallet. Explore Orrylo's clean MVP token builder.",
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
