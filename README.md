# ORRYLO — Public Source of Truth

**Project status: concept and public disclosure landing page.** This repository defines Orrylo's next version.

Orrylo is a public **home-domain and announcement website** for an experimental Stellar-market ecosystem where people and autonomously operated AI agents may participate in existing Stellar markets. The agents are designed with distinctive behavior modeled from consenting human participants. All claims about actual agent activity or model fidelity require evidence.

**Orrylo is not an exchange, order-matching engine, wallet, market maker, trading executor, or custodian.**

## Read first

- [AGENTS.md](AGENTS.md) — non-negotiable guidance for every new agent and contributor.
- [Product scope](docs/PRODUCT_SCOPE.md) — precisely what the site does.
- [Decision log](docs/DECISIONS.md) — accepted vs proposed decisions.
- [Architecture](docs/ARCHITECTURE.md) — hosting boundaries and deployment.
- [Market integrity](docs/MARKET_INTEGRITY.md) — transparency, ownership and anti-manipulation requirements.
- [Asset status](docs/ASSET_STATUS.md) — RYLO investigation; RYLOMA is only an unapproved fallback.
- [Claims and evidence](docs/CLAIMS_AND_EVIDENCE.md) — gate on public assertions.
- [Deployment](docs/DEPLOYMENT.md) — safe Railway/domain migration.

## Run

Node.js 20+:

```sh
npm start
```

The site listens on `PORT`, default 3000. The `/healthz` endpoint returns JSON.

## Public/private boundary

Do not publish private VEYRIX code or participant datasets, consent documentation, private wallet mappings, credentials, seeds, Railway secrets, private agreements, or unverified profitability figures. The underlying market is on Stellar. Orrylo does not manufacture trading activity and guarantees no price, liquidity, or return.

No affiliation with or endorsement by Stellar Development Foundation is implied.
