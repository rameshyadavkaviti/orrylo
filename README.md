# ORRYLO — Public Source of Truth

ORRYLO combines an informational/disclosure website with a separately deployed Phase 1 research runtime for persistent software-agent identities. The objective is increasingly human-like economic behavior over time; this is not yet an empirically verified result.

## Public site architecture

The website provides independent routes: `/`, `/vision`, `/technology`, `/rylo`, `/transparency`, and `/status`. Shared fixed navigation and footer live in the Next.js App Router root layout. The non-custodial RYLO buy modal remains Albedo-signed and subject to real Stellar liquidity and a 0.1 XLM/RYLO price cap. Unreleased financial roadmaps and token-allocation proposals are not presented in public website routes or quote API responses. The public focus is human-centered AI research, with clear limitations and market-risk disclosures. Next.js generates the sitemap at `/sitemap.xml`.

## Stack

Next.js App Router, React 19, TypeScript/TSX, Tailwind CSS. Official RYLO logo is available at `/logo.png`.

## Run

Requires Node.js 22.12+.

```sh
npm install
npm run dev
npm run typecheck
npm run build
npm start
```

Railway: set build command `npm run build` and start command `npm start`. Runtime honors `PORT` (default 3000); `/healthz` responds with JSON.

## Agent Core

The isolated service in [`services/agent-core`](services/agent-core) verifies environment-configured Stellar key pairs and immediately creates durable, unique agents with separate causal seeds, state, memory, narratives, episodes and evaluations. It has no transaction-signing or submission adapter. See its README and design manifest for contracts and evidence boundaries.

## Source of truth

Read [AGENTS.md](AGENTS.md), [product scope](docs/PRODUCT_SCOPE.md), [decisions](docs/DECISIONS.md), [architecture](docs/ARCHITECTURE.md), [claims](docs/CLAIMS_AND_EVIDENCE.md), [integrity](docs/MARKET_INTEGRITY.md), and [deployment](docs/DEPLOYMENT.md). The website remains informational and operationally separate from Agent Core. No live trading execution is authorized. Do not import private VEYRIX data, keys or secrets.

## RYLO bonus campaign (inactive until provisioned)

Code provides a 36% RYLO promotional bonus for **at least 500 RYLO purchased through the official site**, limited to one successfully paid reward per wallet per campaign. The promotional preview is not a claim that any reward has been funded or issued. The website must never sign bonus transfers itself.

Server-side API stores a transaction hash **when the site prepares the buyer's exact Stellar XDR**, then the isolated payout worker independently verifies its successful source account, path payment and destination on Horizon. Durable PostgreSQL records, an advisory lock and an on-chain-identifiable signed payout envelope prevent duplicate transfers. A payout that cannot be reconciled stays in manual review, not auto re-signed.

Provision the web service's `DATABASE_URL` via Railway Postgres reference and supply `RYLO_BONUS_CAMPAIGN_MAX_RYLO` (a pre-funded, limited budget). Keep `RYLO_BONUS_CAMPAIGN_ACTIVE=false` and `RYLO_BONUS_FULFILLMENT_READY=false` until the worker is configured and a test receipt has confirmed. **Never put a funding wallet secret into the web service**.

In a separate Railway service from this repository, set start command `npm run bonus:worker`, then configure `DATABASE_URL`, `RYLO_BONUS_SECRET` (sealed secret), `RYLO_BONUS_PUBLIC_KEY`, `RYLO_BONUS_CAMPAIGN_MAX_RYLO`, `RYLO_BONUS_CAMPAIGN_ACTIVE=true` and `RYLO_BONUS_PAYOUT_ENABLED=true`. The source wallet must be different from the issuer and funded with transferable RYLO and XLM. Set optional comma-separated `RYLO_BONUS_EXCLUDED_PUBLIC_KEYS` on both services to exclude related owners. The website can display the campaign as active only after the worker has passed live signing and balance checks and the campaign has been funded.

### Bonus anti-abuse and payout activation

For a bonus-eligible purchase, Albedo signs a fresh, short-lived wallet-ownership challenge before the website prepares a transaction. The server verifies the signature and consumes the nonce atomically with the budget reservation. A purchase prepared without a valid challenge is not enrolled for a bonus. The website also displays that the reward is **one per wallet per campaign** and only applies to purchases **500 RYLO or more (inclusive)**.

The separate payout worker may use Railway cron with `RYLO_BONUS_RUN_ONCE=true` and a 5-minute schedule, with `RYLO_BONUS_PAYOUT_ENABLED=false` until a dedicated funded and verified wallet is available. Its secret belongs **only** in the worker's sealed Railway environment variable. The external-facing web service should have a **dedicated, least-privileged** bonus ledger database role or separate database before activating bonus recording.

### Updated bonus promotion terms (2026-11-25)

Promotion `rylo_bonus_v2` replaces the original unactivated 50%-over-1,000 preview. The new minimum is **500 RYLO inclusive**; the bonus is **36% of the verified purchase** (500 → 180 RYLO, 1,000 → 360 RYLO). The website remains in preview until the dedicated bonus-distribution service has a funded signer, a provisioned ledger, and verified activation. Previous campaign identifiers are retained only in the database history; they are not silently rewritten to new reward amounts.
