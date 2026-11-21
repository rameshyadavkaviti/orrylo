# ORRYLO — Architecture and operational boundaries

```text
Visitors -> orrylo.com -> Announcement / AI disclosures / SEP-1 home-domain
Buyer -> non-custodial purchase modal -> Horizon quote + Albedo user signature -> Stellar DEX

ORRYLO Agent Core (identity/memory/live observation/decisions; no signing)
Future separately approved execution adapter ----------------> Existing Stellar DEX / AMM
Human market participants -------------------------------> Existing Stellar DEX / AMM
```

## Architectural decisions
- The ORRYLO website is NOT an exchange, market maker, order matcher, custodian, trading dashboard or agent controller. It may provide a **non-custodial wallet-connect and purchase interface** that prepares a bounded Stellar DEX path payment after a real-time quote; Albedo handles wallet approval and network submission.
- Agent Core is a separate TypeScript/PostgreSQL service. It enrolls environment-configured wallets, derives durable causal identities, stores independent memory/state/history, ingests ordered experiences, and can run independent decision episodes from one live Horizon market snapshot. Behavioral evolution v2 adds elapsed-time state recovery, prediction-error learning, context-specific procedural habits, bounded sequential effects, post-error recovery, conditional exploration, computed decision latency, reference learning and slow evidence-qualified self-model consolidation. It contains no signing or transaction-submission adapter.
- VEYRIX is a separate historical project built around models of specific real humans. Do not reuse it as the new engine or import its private data/code.
- ORRYLO's central objective is longitudinal improvement in human-like economic behavior by AI agents. This objective must be evaluated empirically; do not hard-code a claim of success.
- Legacy human-profile-specific sleep/activity schedules and arbitrary trade-count quotas are not inherited. Economic risk, security, beneficial-ownership and market-integrity safeguards remain necessary.
- Existing Stellar venues handle real matching and settlement; an ORRYLO system must not fabricate volume via related-wallet self-trading or coordinated artificial demand.

## Railway and domains
The informational site is deployed in isolated Railway project `orrylo-v2`. The old custom domains `orrylo.com` and `assets.orrylo.com` were removed from the legacy Railway service. Legacy signer services, storage and repository were not authorized for deletion. Cloudflare DNS and Railway ownership/certificate verification are separate steps.

## Asset-specific home-domain
No replacement issuer/asset has been approved. RYLO legacy asset recovery remains unresolved. Do not publish a new issuer-specific stellar.toml until verified issuer and explicit approval.
