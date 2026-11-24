import Link from "next/link";
import {ArrowUpRight, Gift, Sparkles} from "lucide-react";
import {BONUS_CAMPAIGN_ACTIVE, BONUS_RATE, BONUS_THRESHOLD_RYLO} from "@/lib/bonus";

export default function BonusPromo() {
  return <section aria-labelledby="bonus-campaign-heading" className="relative isolate overflow-hidden border-y border-[#edb6b8]/25 bg-[radial-gradient(ellipse_at_75%_5%,rgba(239,182,167,.24),transparent_58%),linear-gradient(110deg,#34212b,#17141b_72%)]">
    <div aria-hidden="true" className="pointer-events-none absolute -right-16 -top-32 h-96 w-96 rounded-full border-[46px] border-[#e5a0ae]/[.07]"/>
    <div className="shell relative grid gap-7 py-9 sm:py-12 md:grid-cols-[1.15fr_.85fr] md:items-center">
      <div>
        <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-[#e9aab4]/35 bg-white/[.04] px-4 py-2 text-[11px] font-bold uppercase tracking-[.16em] text-[#f1c1c7]"><Sparkles size={15}/> {BONUS_CAMPAIGN_ACTIVE ? "Limited bonus offer" : "Upcoming bonus campaign"}</p>
        <h2 id="bonus-campaign-heading" className="max-w-2xl text-[clamp(32px,4.4vw,62px)] font-bold leading-[1.05] tracking-[-.05em]">
          More RYLO. <span className="text-[#f4b7c3]">50% extra.</span>
        </h2>
        <p className="mt-4 max-w-[670px] text-sm leading-7 text-[#dfcdd3] sm:text-base">
          A proposed bonus for buying <strong>more than {BONUS_THRESHOLD_RYLO.toLocaleString("en-US")} RYLO</strong> through ORRYLO.
          Example: 1,200 RYLO would earn an additional 600 RYLO.
        </p>
        {!BONUS_CAMPAIGN_ACTIVE && <p className="mt-3 max-w-[670px] text-xs leading-6 text-[#f3c6ce]">
          Promotion preview only — bonus distribution has not been activated or funded and no bonus is currently guaranteed.
        </p>}
      </div>
      <div className="flex flex-wrap items-center gap-5 md:justify-end">
        <div className="flex items-center gap-4 rounded-2xl border border-[#edb1ba]/30 bg-[#110f15]/75 px-6 py-5">
          <Gift size={35} className="shrink-0 text-[#f3b7c3]" strokeWidth={1.5}/>
          <div><p className="text-[10px] font-bold uppercase tracking-[.2em] text-[#c7a3ad]">Bonus rate</p>
            <p className="mt-1 text-4xl font-bold tracking-tight text-[#f8d7df]">+{BONUS_RATE * 100}%</p>
          </div>
        </div>
        <Link href="/rylo" className="inline-flex items-center gap-2 rounded-full bg-[#e5a9b6] px-6 py-3 text-sm font-bold text-[#1a1117] transition hover:bg-[#ffd1db]">
          Offer details <ArrowUpRight size={18}/>
        </Link>
      </div>
    </div>
  </section>;
}
