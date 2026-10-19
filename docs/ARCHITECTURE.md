# Orrylo — Lean Architecture (proposed)

## MVP shape
```
Albedo Wallet → Next.js UI/API → PostgreSQL
                         │
                         ├→ trusted Horizon/Stellar read + reconciliation
                         └→ isolated private signer → Stellar Testnet
```

One modular application, one database, one protected signing boundary. No microservices for ordinary business modules.

## Current execution lifecycle
1. Authenticate wallet.
2. Reserve issuer-scoped asset code and commit full immutable transaction intent.
3. Verify configured Testnet issuer and signer public identities, authenticating the isolated signer.
4. Verify receiving trustline and transaction preflight.
5. Submit exactly the approved signed transaction.
6. Reconcile exact ledger outcome, including unknown/timeout outcomes.
7. Show issuance result and project profile only when verified.

Never substitute a draft project, asset code reservation, signer readiness, or successful HTTP response for on-chain success. Preserve DB security triggers and privilege separation.

## Components
- `web/`: UI, server routes, application orchestration.
- `web/lib/server/persistence/` and `web/db/migrations/`: durable authoritative application state, immutable history, privileges and auditing.
- Private Railway signer: isolated Stellar signing keys and bounded validated requests.
- Stellar Testnet: authoritative asset/trustline/transaction state.
- Project Profile: stable internal ID, separately editable public slug and presentation metadata.
- Metadata: issuer `home_domain` and hosted `stellar.toml` are distinct from public project URLs.

## Deliberate exclusions
RYLO transactions/rewards/liquidity, Dedicated Issuer, Soroban templates, complex multi-party governance operations and Mainnet are not prerequisites to the first automated Testnet Shared Issuer issuance. Existing approved protections are not disabled by this scope decision.

## Implementation rule
Stabilize deployed integration before large code, schema or security refactors. Later simplification needs evidence of equivalent enforcement and regression tests. Full previous architecture: `docs/archive/2026-10-19/ARCHITECTURE.md`.
