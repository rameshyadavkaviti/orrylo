# Search indexing rebuild — 2026-11-24

## Canonical source of truth

- One sitemap endpoint: https://orrylo.com/sitemap.xml, generated from `app/sitemap.ts`.
- One robots source: `public/robots.txt`; do not create `app/robots.ts` alongside it.
- List only canonical, public, indexable routes. Do not include API, internal routes, old asset-token pages or unreviewed blog drafts.
- Each page uses a unique canonical URL; absolute URL origin is https://orrylo.com.
- Do not invent `lastModified` values; add them for newly published articles only when based on their actual edits.
- Never submit stale `sitemap_index.xml`, `post-sitemap.xml`, `page-sitemap.xml`, or old domain/staging URLs.

## Release and verification steps

1. Confirm CI typecheck and Next build pass.
2. Confirm production deployment serves 200 on /, /vision, /technology, /rylo, /transparency, /status, /robots.txt and /sitemap.xml.
3. Verify sitemap contains precisely those public routes, correct host, no duplicates.
4. Verify rendered canonical, robots meta and JSON-LD are valid on each route.
5. Verify HTTPS and preferred host normalization, non-existent pages give 404, removed routes use 301 redirects when there is a meaningful replacement or 410/404 otherwise.
6. In Google Search Console for the domain property orrylo.com, manually remove all outdated submitted sitemap records from Sitemaps. Then submit ONLY https://orrylo.com/sitemap.xml after production is verified.
7. Run URL Inspection and request indexing of the home page and important independent routes. Track Page Indexing, Crawl Stats, Core Web Vitals and Security Issues.
8. New vetted research articles: add indexable route, internal links, article structured data, and real dates; then add exact canonical URL to sitemap.

Removing a submitted sitemap in Search Console does not remove URLs from Google index. Use correct HTTP responses and redirects for retired routes, and do not request site-wide removal for an active domain.

This code change does not assert Search Console access, successful production deployment, Google crawl or indexing.
