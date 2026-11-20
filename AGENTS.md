# Orrylo — Agent instructions

This PUBLIC repository is the Source of Truth (SoT) for ORRYLO. Read all relevant files in docs/ before making changes.

## Accepted vision
ORRYLO explores a market on existing Stellar venues in which AI trading agents may account for a substantial share of activity, with that AI participation disclosed openly. The defining research objective is for individual agents to progressively develop more human-like economic behavior and decision-making over time. This is a research goal, not a verified claim that improvement occurs every day, that agents are human, or that they are conscious.

ORRYLO agents are NOT VEYRIX human-profile replicas. They need not be derived from real individuals. The owner will provide the detailed cognitive architecture and implementation requirements later; do not invent them or build an execution engine without instruction.

## Scope and boundaries
- orrylo.com remains an informational/disclosure and potential Stellar asset home-domain only; no exchange, wallet, custody, matching engine, trading dashboard, or execution runtime on the website.
- A future ORRYLO-specific agent engine is a separate component; VEYRIX is not its execution engine or architecture template.
- Do not transfer VEYRIX-specific artificial sleep schedules, fixed activity quotas, human-profile restrictions, or other irrelevant behavior constraints by default.
- Retain capital/security controls and market-integrity safeguards: no wash/self-trades, coordinated controlled-wallet fake volume, deceptive demand, or price manipulation. Public disclosure of AI participation does not make these acceptable.
- Different AI agents, wallets or personas do not establish different beneficial owners. Describe control truthfully.

## Claims and evidence
- Disclose AI participation clearly. Do not assert a majority of actual trades are AI-generated without verified trade data and a defined measurement window.
- Describe human-like behavioral evolution as an objective until longitudinal evaluation supports observed progress.
- Do not assert scientific validation, autonomy, profit, supply, liquidity, or live activity without evidence.
- Historical RYLO recovery remains unresolved; no new token issuance is approved by this document.

## Privacy
Never commit VEYRIX private code, human participant data, consent records, private wallet mappings, keys, seeds, Railway secrets, or confidential agreements.

## Deployment and process
Public site deploys from this repo to isolated Railway project `orrylo-v2`. Removing `orrylo.com` and `assets.orrylo.com` from the old service does not authorize deleting legacy storage, signer services or repository.
Before work, read `docs/DECISIONS.md`, `docs/PRODUCT_SCOPE.md`, `docs/ARCHITECTURE.md`, `docs/CLAIMS_AND_EVIDENCE.md`, and `docs/MARKET_INTEGRITY.md`. Record decisions and distinguish proposed architecture from approved implementation.
