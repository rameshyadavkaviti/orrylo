# Deploy, migrate and rollback

1. This public repository's `main` branch deploys to isolated Railway project `orrylo-v2`, service `orrylo-home`.
2. Next.js requires Node 20+, **build command `npm run build`**, and **start command `npm start`**. The start script respects Railway's `PORT`.
3. Verify `/`, `/healthz`, `/logo.png`, mobile layout, HTTPS, metadata and public disclosures.
4. Domain `orrylo.com` belongs to the new Railway service. Follow Railway's actual ownership and DNS instructions; do not guess Cloudflare records.
5. Both `orrylo.com` and `assets.orrylo.com` were removed from old service at owner's request. Do not delete old buckets, signers, private repository or legacy service. Retain them for rollback.
6. Do not publish `/.well-known/stellar.toml` until issuer and asset identity are verified and approved.

The site is informational only; no trading, wallet, custody, exchange, matching or agent execution functionality.

## Agent Core Phase 1

Deploy `services/agent-core` as a separate Railway service with its own PostgreSQL service. Build with `npm run build`, start with `npm start`, and configure the variables documented in the service README. Keep `ORRYLO_EXECUTION_ENABLED=false`. `/healthz` is a process signal; `/readyz` requires database migration, healthy enrollment and an unpaused runtime.

Rollback: stop or roll back only `orrylo-agent-core`; retain its PostgreSQL data and leave `orrylo-home` untouched. Rotating the identity master key version affects only newly enrolled wallets; existing identities remain persisted.
