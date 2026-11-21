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

### Production record — 2026-11-21

- Railway project: `orrylo-v2` (`1639ec87-8792-41f4-b5fd-77256d6dfbfb`)
- Environment: `production` (`a2eb3b01-c879-42ca-ba3c-d61f76cc7df4`)
- Agent Core: `orrylo-agent-core` (`9fda3715-4977-4b17-a51f-ff7297e6358f`)
- PostgreSQL: `Postgres` (`db77d008-3bc6-4373-966e-fd98bcd3f4a1`)
- Verified Agent Core deployment: `8013e7fc-b1b8-41e9-b858-57c17c13b1ce`, status `SUCCESS`
- Verified source commit: `93ff46df3fbe7c40a815ea0a75fefc86279cc26a`
- Service URL: `https://orrylo-agent-core-production.up.railway.app`
- Pre-deploy evidence: 58/58 tests passed, including the PostgreSQL concurrency/atomicity integration test; TypeScript typecheck passed; the production dependency audit reported zero vulnerabilities.
- Runtime evidence: `/healthz` returned `ok: true`; `/readyz` returned database, migration, and enrollment health as true with zero invalid candidates.
- Expected empty-state behavior: zero enrolled agents is healthy until valid `ORRYLO_AGENT_<ALIAS>_PUBLIC_KEY` and `ORRYLO_AGENT_<ALIAS>_SECRET_KEY` pairs are configured.

A stale staged, unattached volume named `agent-postgres-data` may still appear in Railway pending changes after the connector's staged-deploy failure. It is not provisioned, mounted, or used by the live Agent Core or live PostgreSQL service. Discard that one pending volume change from the Railway dashboard; do not apply it.

Rollback: stop or roll back only `orrylo-agent-core`; retain its PostgreSQL data and leave `orrylo-home` untouched. Rotating the identity master key version affects only newly enrolled wallets; existing identities remain persisted.
