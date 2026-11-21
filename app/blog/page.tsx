import type { Metadata } from "next";
import Link from "next/link";
import { articles } from "@/lib/blog";

export const metadata: Metadata = {
  title: "Research & Insights",
  description: "ORRYLO research notes on human-like AI agents, behavioral economic modeling, and financial market integrity.",
  alternates: { canonical: "/blog" },
  robots: articles.length ? { index: true, follow: true } : { index: false, follow: true },
};

export default function BlogIndex() {
  const published = [...articles].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  return <main className="shell section min-h-[60vh]">
    <p className="kicker">Research & insights</p>
    <h1 className="heading mt-6">Ideas worth <span className="gradient-text">testing.</span></h1>
    <p className="description mt-6 max-w-[760px]">Evidence-led perspectives on behavioral AI, market design and the global economy. Hypotheses are clearly distinguished from measured outcomes.</p>
    {published.length ? <div className="mt-12 grid gap-5 md:grid-cols-2">{published.map(article =>
      <article key={article.slug} className="card">
        <p className="text-xs text-muted"><time dateTime={article.publishedAt}>{article.publishedAt.slice(0,10)}</time> · {article.author}</p>
        <h2 className="mt-5 text-2xl font-semibold"><Link href={`/blog/${article.slug}`} className="hover:underline">{article.title}</Link></h2>
        <p className="description mt-4 text-sm">{article.description}</p>
        <Link href={`/blog/${article.slug}`} className="mt-6 inline-block text-sm font-semibold text-[#d9a5b3]">Read article →</Link>
      </article>
    )}</div> : <p className="description mt-12">Research articles are being prepared. No unreviewed financial or scientific claims will be published.</p>}
  </main>;
}
