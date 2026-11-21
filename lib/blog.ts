/**
 * Editorial registry. Only publish a reviewed, sourced article after the
 * author supplies it and verifies that product/financial claims are accurate.
 */
export type BlogSection = { heading: string; paragraphs: string[] };
export type BlogArticle = {
  slug: string;
  title: string;
  description: string;
  publishedAt: string; // ISO 8601
  updatedAt?: string;
  author: string;
  sources: { label: string; url: string }[];
  sections: BlogSection[];
};
export const articles: BlogArticle[] = [];
export function getArticle(slug: string): BlogArticle | undefined {
  return articles.find((article) => article.slug === slug);
}
