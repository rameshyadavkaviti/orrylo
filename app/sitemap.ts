import type { MetadataRoute } from "next";

/**
 * Canonical, public, indexable pages only.
 * Do not publish fabricated lastModified dates or private/API routes.
 * When reviewed articles go live, add their real canonical URLs here.
 */
const SITE_URL = "https://orrylo.com";
const indexableRoutes = [
  "/",
  "/vision",
  "/technology",
  "/rylo",
  "/transparency",
  "/status",
] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  return indexableRoutes.map((pathname) => ({
    url: new URL(pathname, SITE_URL).toString(),
  }));
}
