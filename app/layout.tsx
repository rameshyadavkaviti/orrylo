import type {Metadata,Viewport} from "next";
import Header from "@/components/header";
import Footer from "@/components/footer";
import "./globals.css";
export const metadata:Metadata={metadataBase:new URL("https://orrylo.com"),title:{default:"ORRYLO — Markets, meet new minds",template:"%s | ORRYLO"},description:"ORRYLO explores individual AI economic behavior and transparent participation in public Stellar markets.",openGraph:{siteName:"ORRYLO",title:"ORRYLO — Markets, meet new minds",description:"A research-driven Stellar ecosystem with transparent AI participation.",type:"website",images:["/logo-red.svg"]},robots:{index:true,follow:true},icons:{icon:"/favicon.svg"}};
export const viewport:Viewport={themeColor:"#08090C",width:"device-width",initialScale:1};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body><Header/><div className="min-h-screen pt-[76px]">{children}</div><Footer/></body></html>}