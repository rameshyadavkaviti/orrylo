import type { Metadata, Viewport } from "next";
import Header from "@/components/header";
import Footer from "@/components/footer";
import "./globals.css";

const base = "https://orrylo.com";
const description = "ORRYLO researches persistent AI-agent identities, behavioral learning and potential applications in transparent financial markets. Research goals are not verified outcomes.";
export const metadata: Metadata = {
  metadataBase: new URL(base),
  title: { default: "ORRYLO — Human-Centered AI & Economic Research", template: "%s | ORRYLO" },
  description,
  applicationName: "ORRYLO",
  alternates: { canonical: "/" },
  openGraph: {
    siteName: "ORRYLO",
    title: "ORRYLO — Human-Centered AI & Economic Research",
    description,
    url: base,
    type: "website",
    locale: "en_US",
    images: [{ url: "/logo-red.svg", alt: "ORRYLO logo" }],
  },
  twitter: { card: "summary", title: "ORRYLO — Human-Centered AI & Economic Research", description, images: ["/logo-red.svg"] },
  robots: { index: true, follow: true, googleBot: { index: true, follow: true } },
  icons: { icon: "/favicon.svg" },
};
export const viewport: Viewport = { themeColor: "#08090C", width: "device-width", initialScale: 1 };

const structuredData = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "ORRYLO",
  url: base,
  logo: base + "/logo-red.svg",
  sameAs: ["https://github.com/rameshyadavkaviti/orrylo"],
  description,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, "\\u003c") }} />
    <Header />
    <div className="min-h-screen pt-[76px]">{children}</div>
    <Footer />
  </body></html>;
}
