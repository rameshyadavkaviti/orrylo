import type { Metadata, Viewport } from "next";
import Header from "@/components/header";
import Footer from "@/components/footer";
import "./globals.css";

const siteUrl = "https://orrylo.com";
const description = "ORRYLO investigates persistent AI agent identities, behavioral learning, and possible applications in transparent financial markets. Research outcomes require independent verification.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { default: "ORRYLO — Human-Centered AI Research", template: "%s | ORRYLO" },
  description,
  alternates: { canonical: "/" },
  openGraph: {
    siteName: "ORRYLO",
    title: "ORRYLO — Human-Centered AI Research",
    description,
    url: siteUrl,
    type: "website",
    locale: "en_US",
    images: [{ url: "/logo-red.svg", alt: "ORRYLO" }],
  },
  twitter: {
    card: "summary",
    title: "ORRYLO — Human-Centered AI Research",
    description,
    images: ["/logo-red.svg"],
  },
  robots: { index: true, follow: true, googleBot: { index: true, follow: true } },
  icons: { icon: "/favicon.svg" },
};
export const viewport: Viewport = { themeColor: "#08090C", width: "device-width", initialScale: 1 };
const organization = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "ORRYLO",
  url: siteUrl,
  logo: siteUrl + "/logo-red.svg",
  sameAs: ["https://github.com/rameshyadavkaviti/orrylo"],
  description,
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(organization).replace(/</g, "\\u003c") }} />
    <Header />
    <div className="min-h-screen pt-[76px]">{children}</div>
    <Footer />
  </body></html>;
}
