# Deploy, migrate and rollback

1. Deploy this public repository into new independent Railway project `orrylo-v2`, branch `main`, start command `npm start` (Node 20+).
2. Verify auto-generated Railway domain, `/`, `/healthz`, responsive design, HTTPS, SEO and transparency statements.
3. User explicitly requested removing **both** old domains `orrylo.com` and `assets.orrylo.com` from old Railway service. This will make the latter unavailable and may break old token metadata links; underlying assets bucket and signer services are NOT to be deleted.
4. Remove old custom domain associations in Railway when ready; add `orrylo.com` to new project/service.
5. Check Railway domain-status instructions and update DNS in Cloudflare using actual records (do not guess target).
6. Verify certificate, DNS, apex homepage and health checks. If domain cutover is unavailable, retain preview and provide manual DNS steps.
7. Keep old service and private repo intact for rollback. Do not restore obsolete `assets.orrylo.com` unless the user explicitly asks.

`/.well-known/stellar.toml` must not be invented: asset identity and issuer-home-domain metadata remain pending approval.