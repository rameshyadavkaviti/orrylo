import type { MetadataRoute } from "next";
import { articles } from "@/lib/blog";
const base = "https://orrylo.com";
export default function sitemap(): MetadataRoute.Sitemap {
  const core = ["", "/vision", "/technology", "/rylo", "/transparency", "/status"].map(path => ({
    url: base + (path || "/"),
    changeFrequency: "monthly" as const,
    priority: path ? 0.7 : 1,
  }));
  if (!articles.length) return core;
  return [
    ...core,
    { url: base + "/blog", changeFrequency: "weekly" as const, priority: 0.8 },
    ...articles.map(a => ({
      url: base + "/blog/" + a.slug,
      lastModified: new Date(a.updatedAt ?? a.publishedAt),
      changeFrequency: "monthly" as const,
      priority: 0.7,
    })),
  ];
}
