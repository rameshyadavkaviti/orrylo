import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { articles, getArticle } from "@/lib/blog";

type Params = Promise<{ slug: string }>;
export function generateStaticParams() {
  return articles.map(({ slug }) => ({ slug }));
}
export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const article = getArticle(slug);
  if (!article) return { title: "Article not found", robots: { index: false, follow: false } };
  return {
    title: article.title,
    description: article.description,
    alternates: { canonical: `/blog/${article.slug}` },
    openGraph: {
      type: "article", title: article.title, description: article.description,
      url: `https://orrylo.com/blog/${article.slug}`,
      publishedTime: article.publishedAt, modifiedTime: article.updatedAt ?? article.publishedAt,
      authors: [article.author],
    },
  };
}
export default async function BlogArticlePage({ params }: { params: Params }) {
  const { slug } = await params;
  const article = getArticle(slug);
  if (!article) notFound();
  const schema = {
    "@context": "https://schema.org", "@type": "BlogPosting",
    headline: article.title, description: article.description,
    datePublished: article.publishedAt, dateModified: article.updatedAt ?? article.publishedAt,
    mainEntityOfPage: `https://orrylo.com/blog/${article.slug}`,
    author: { "@type": "Organization", name: article.author },
    publisher: { "@type": "Organization", name: "ORRYLO", url: "https://orrylo.com" },
    citation: article.sources.map(source => source.url),
  };
  return <main className="shell section max-w-[960px]">
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema).replace(/</g, "\\u003c") }} />
    <Link href="/blog" className="text-sm text-[#d9a5b3]">← Research & insights</Link>
    <article>
      <header className="mt-9">
        <h1 className="heading">{article.title}</h1>
        <p className="description mt-6 text-lg">{article.description}</p>
        <p className="mt-6 text-xs text-muted">{article.author} · <time dateTime={article.publishedAt}>{article.publishedAt.slice(0,10)}</time></p>
      </header>
      <div className="mt-12 space-y-12">
        {article.sections.map(section => <section key={section.heading}>
          <h2 className="text-2xl font-semibold">{section.heading}</h2>
          {section.paragraphs.map((paragraph, index) => <p key={index} className="description mt-5 leading-8">{paragraph}</p>)}
        </section>)}
      </div>
      {article.sources.length > 0 && <section className="mt-14 border-t muted-border pt-8">
        <h2 className="text-xl font-semibold">Sources & further reading</h2>
        <ul className="mt-5 space-y-3">{article.sources.map(source => <li key={source.url}><a href={source.url} target="_blank" rel="noopener noreferrer" className="text-[#d9a5b3] underline underline-offset-4">{source.label}</a></li>)}</ul>
      </section>}
      <p className="description mt-12 border-t muted-border pt-7 text-sm">Research commentary, not financial advice. Possible market effects should not be confused with verified ORRYLO agent outcomes.</p>
    </article>
  </main>;
}
