import type { Metadata } from "next";
import Link from "next/link";
import PageIntro from "@/components/page-intro";
import RyloPurchase from "@/components/rylo-purchase";
import { ArrowUpRight, BrainCircuit, ChartNoAxesCombined, Fingerprint, ShieldCheck, Wallet } from "lucide-react";

export const metadata: Metadata = {
  title: "RYLO",
  description: "Explore RYLO on Stellar and the research vision for more human-centered AI market participation. User-authorized purchases via Albedo."
};

const issuer = "GDG7SGYLJQBLSN55ASHD7VCXYBEPYDK4EUIUTW6XWTBUDUHXK6ORRYLO";
const benefits = [
  {
    Icon: Fingerprint,
    title: "More diverse decision-making",
    text: "Behaviorally distinct agents could respond differently to the same market conditions, helping researchers study a broader range of economic decisions instead of identical rule-based reactions."
  },
  {
    Icon: ChartNoAxesCombined,
    title: "Better-informed price discovery",
    text: "Agents that learn from public information and outcomes could contribute additional perspectives to price formation. Whether they improve market efficiency needs to be measured."
  },
  {
    Icon: BrainCircuit,
    title: "Adaptive market participation",
    text: "Memory, feedback and individually evolving preferences may help software participants adapt to changing conditions rather than follow one unchanging strategy."
  },
  {
    Icon: ShieldCheck,
    title: "Transparency by design",
    text: "Clear AI disclosure and independent verification can help participants distinguish genuine activity from manufactured demand. Diverse software identities do not necessarily mean different owners."
  }
];

export default function Rylo() {
  return <main>
    <PageIntro eyebrow="03 / RYLO on Stellar"
      title={<>Markets powered by <span className="gradient-text">new perspectives.</span></>}
      description="RYLO is a Stellar asset associated with ORRYLO's exploration of human-centered AI market participation. Our focus is on how individual learning, behavioral diversity and transparent participation might contribute to financial markets—not on promising outcomes.">
      <RyloPurchase/>
      <a href={"https://stellar.expert/explorer/public/asset/RYLO-" + issuer}
        target="_blank" rel="noopener noreferrer" className="button-outline">
        Explore the asset on Stellar <ArrowUpRight size={17}/>
      </a>
    </PageIntro>

    <section className="shell section">
      <div className="kicker">Why human-centered agents?</div>
      <h2 className="heading mt-6 max-w-[900px]">
        Better questions for <span className="gradient-text">better markets.</span>
      </h2>
      <p className="description mt-6 max-w-[860px]">
        Financial markets are shaped by many motivations, perspectives and reactions to uncertainty.
        Human-centered AI research asks whether richer behavioral models can support more varied
        participation, learning and analysis. These are potential benefits to investigate,
        not verified effects of ORRYLO agents.
      </p>
      <div className="mt-12 grid gap-4 md:grid-cols-2">
        {benefits.map(({Icon,title,text}) => <article className="card" key={title}>
          <Icon size={30} className="text-[#dca2af]"/>
          <h3 className="mt-8 text-2xl font-semibold">{title}</h3>
          <p className="description mt-4 text-sm">{text}</p>
        </article>)}
      </div>
    </section>

    <section className="border-y muted-border bg-[#111217]">
      <div className="shell grid gap-10 py-16 lg:grid-cols-[1fr_.9fr] lg:items-center">
        <div>
          <div className="kicker">Explore RYLO</div>
          <h2 className="heading mt-6">Your wallet.<br/><span className="gradient-text">Your approval.</span></h2>
          <p className="description mt-6">
            View real Stellar order-book liquidity, choose an available RYLO amount
            and authorize a non-custodial transaction through Albedo.
            The 0.1 XLM per RYLO reference is a maximum payment limit in this flow,
            not a guaranteed market price or investment return.
          </p>
          <div className="mt-8"><RyloPurchase/></div>
        </div>
        <div className="rounded-2xl border muted-border bg-[#181B21] p-7 sm:p-9">
          <Wallet size={30} className="text-[#dca2af]"/>
          <h3 className="mt-6 text-xl font-semibold">Stellar mainnet asset</h3>
          <p className="description mt-3 text-sm">
            Verify the asset issuer and market conditions independently before signing.
            The website never needs your wallet secret key.
          </p>
          <p className="mt-6 break-all font-mono text-xs leading-6 text-[#c2bbc0]">{issuer}</p>
          <a href={"https://stellar.expert/explorer/public/account/"+issuer}
            target="_blank" rel="noopener noreferrer" className="mt-5 inline-flex items-center gap-2 text-sm text-[#d9a5b3] hover:underline">
            Inspect issuer on Stellar <ArrowUpRight size={15}/>
          </a>
        </div>
      </div>
    </section>
    <section className="shell py-16">
      <p className="description max-w-[920px] text-sm">
        Research into human-centered agents does not mean they are people, that they create
        guaranteed liquidity, or that they improve prices in every market. RYLO purchases
        do not automatically enroll a wallet as an AI agent. Independent evidence remains
        essential to evaluate real market impact.
      </p>
      <Link href="/transparency" className="button-outline mt-7">
        Research integrity and risks <ArrowUpRight size={16}/>
      </Link>
    </section>
  </main>;
}
