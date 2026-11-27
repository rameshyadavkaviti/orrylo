"use client";
import {useState} from "react";
import Image from "next/image";
import Link from "next/link";
import {usePathname} from "next/navigation";
import {Menu,X,ArrowUpRight} from "lucide-react";
const links=[{href:"/vision",label:"Vision"},{href:"/technology",label:"Technology"},{href:"/rylo",label:"RYLO"},{href:"/transparency",label:"Transparency"},{href:"/status",label:"Status"}];
export default function Header(){
const [open,setOpen]=useState(false);const pathname=usePathname();
return <header className="fixed inset-x-0 top-0 z-50 border-b muted-border bg-[#08090C]/95 backdrop-blur-xl" role="banner">
<div className="shell flex h-[76px] items-center justify-between gap-5">
<Link href="/" onClick={()=>setOpen(false)} aria-label="ORRYLO home" className="flex shrink-0 items-center gap-3"><Image src="/logo-red.svg" width={44} height={44} alt="" className="h-10 w-10 object-contain" priority/><span className="text-lg font-black tracking-[.18em]">ORRYLO</span></Link>
<nav aria-label="Main navigation" className="hidden items-center gap-6 lg:flex">{links.map(link=><Link key={link.href} href={link.href} aria-current={pathname===link.href?"page":undefined} className={"text-[13px] transition hover:text-white "+(pathname===link.href?"font-semibold text-[#e8afbe]":"text-muted")}>{link.label}</Link>)}</nav>
<Link href="/create-token" className="hidden shrink-0 items-center gap-2 rounded-full border border-crimson/60 bg-crimson/10 px-4 py-2.5 text-xs font-bold text-[#e4b7c3] transition hover:bg-crimson/20 lg:inline-flex">Create Token <ArrowUpRight size={15}/></Link>
<button onClick={()=>setOpen(v=>!v)} type="button" aria-label={open?"Close navigation":"Open navigation"} aria-expanded={open} aria-controls="mobile-nav" className="rounded-lg border muted-border p-2 lg:hidden">{open?<X size={22}/>:<Menu size={22}/>}</button>
</div>
{open&&<nav id="mobile-nav" aria-label="Mobile navigation" className="shell flex flex-col border-t muted-border py-3 lg:hidden">{links.map(link=><Link href={link.href} aria-current={pathname===link.href?"page":undefined} key={link.href} onClick={()=>setOpen(false)} className={"rounded-lg px-3 py-3.5 text-sm hover:bg-white/5 "+(pathname===link.href?"text-[#e8afbe]":"text-muted")}>{link.label}</Link>)}<Link href="/create-token" onClick={()=>setOpen(false)} className="mt-2 inline-flex items-center justify-between rounded-xl border border-crimson/50 bg-crimson/10 px-4 py-3 text-sm font-bold text-[#e4b7c3]">Create Token <ArrowUpRight size={16}/></Link></nav>}
</header>;
}