# Orrylo — Minimal Proposed Architecture

Status: **Proposed architecture, not yet implemented**.

```text
Customer browser / Albedo wallet
          │
          ▼
Next.js web application (UI + typed API)
          │
          ├── PostgreSQL: users/sessions, projects, issuance intents/attempts
          │
          ├── Stellar SDK / Horizon: trustline readiness, submit, verify
          │
          └── Private signer: narrow authenticated signing API, secret isolation
```

## Proposed application shape
```text
web/
  app/                     Next.js routes and UI
  lib/
    auth/                  wallet proof/session
    issuance/              validation, state, exact intent and reconciliation
    stellar/               smallest SDK wrapper
    db/                    persistence queries and migration runner
    signing/               bounded private signing client
  tests/                   wallet, retries, trustlines and end-to-end checks
```
This is a target layout. Inherited legacy paths remain present until deliberately replaced.

## Explicit issuance states
`created → prepared → submitted → confirmed`, plus distinct `rejected`, `failed` and `unknown/reconciling` results. Signing attempts and transaction hashes retain immutable evidence. Never treat ambiguous submission as confirmed failure; never produce new equivalent issuance solely because a request timed out.

## Keep vs replace
**Preserve knowledge:** verified Testnet issuer account IDs, Stellar transaction semantics, successful test fixtures, public configuration evidence and safe signing/confirmation invariants.

**Reevaluate:** full legacy workflow engine, generic transaction tables, complex triggers not necessary in the fresh schema, multi-feature UI/service coupling, extra adapters and long policy-loading instructions. Do not weaken protections on an existing live/shared database.

**Defer:** RYLO economy, contract-controlled Dedicated Issuers, advanced governance and Mainnet topology. No separate service for each deferred module.

## Deployment
Target a reproducible low-cost Testnet deployment; use existing Railway/Neon/Cloudflare only where verified compatible. Private signer may remain separately deployed for isolation. No live infrastructure mutation is part of branch setup.

## Reuse gate
Before copying an inherited component, verify what it does, its dependency chain, its tests and whether its interfaces fit the minimal user flow. A small new module is preferable to an entire inherited framework.
