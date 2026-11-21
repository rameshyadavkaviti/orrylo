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
