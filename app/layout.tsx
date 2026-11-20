import type { Metadata, Viewport } from "next";
import "./globals.css";
export const metadata: Metadata = {metadataBase:new URL("https://orrylo.com"),title:"ORRYLO — Markets, meet new minds",description:"An open research direction exploring human-like economic decision-making by AI agents on public Stellar markets. Transparent by design.",alternates:{canonical:"/"},openGraph:{title:"ORRYLO — Markets, meet new minds",description:"The next frontier in economic intelligence.",images:["/logo.png"],type:"website"},icons:{icon:"/favicon.svg"}};
export const viewport: Viewport = {themeColor:"#080e11",width:"device-width",initialScale:1};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>}
