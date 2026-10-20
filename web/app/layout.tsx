import type { Metadata } from "next";
import type { ReactNode } from "react";

import { AppShell } from "../components/app-shell";
import "./globals.css";
import "./prototype.css";
import "./brand.css";
import "./clean-mvp.css";
import "./theme.css";
import "./tailwind.css";

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
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{var saved=localStorage.getItem("orrylo-theme");var theme=saved==="dark"||saved==="light"?saved:(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light");document.documentElement.dataset.theme=theme;}catch(e){document.documentElement.dataset.theme="light";}})();` }} />
      </head>
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
