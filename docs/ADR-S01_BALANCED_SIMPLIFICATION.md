# ADR-S01 — Balanced architecture simplification (proposal)

Status: **PROPOSED — not yet canonical product policy**
Baseline inspected: `main` at `3197e9492fc5001891e08cb5e8e1ac7deb967a66` (2026-10-19).

## Goal

Deliver the smallest *safe and working* Orrylo: authenticate with Albedo, confirm a real Shared Issuer token-creation request, safely issue on Stellar Testnet, independently confirm the exact transaction, and show a truthful persistent project. Simplify orchestration **after** this critical path works. The existing `docs/SOURCE_OF_TRUTH.md`, `docs/RYLO_POLICY.md`, `docs/ARCHITECTURE.md`, `docs/OPEN_DECISIONS.md` and `AGENTS.md` remain authoritative. This ADR does **not** override them.

## Keep: non-negotiable boundaries

- A modular Next.js application and one PostgreSQL persistence system; application-level project identity remains a stable `project_id`.
- A distinct private signer with issuer keys outside browser, regular web runtime, source control, logs and database.
- Customer Shared Issuer distinct from RYLO issuer; respect on-chain Stellar issuer flags/thresholds and the separately approved RYLO 2-of-3 model.
- Authenticated, owner-bound, issuer-scoped unique reservations; immutable exact issuance intent persisted before any signature.
- Replay/idempotency/concurrency controls, DB privilege and trigger enforcement, immutable attempts, audit evidence.
- No blind retry after submission uncertainty; reconcile exact signed-envelope/transaction hashes and ledger evidence before confirming or releasing authority.
- Trustline readiness checked against the correct network, recipient and asset; accurate distinction between created, submitted, confirmed, and published metadata.
- No unapproved live Testnet/Mainnet signing, account mutation, secret provisioning, or key rotation.

## Simplify: candidate targets, not assumed defects

1. One customer-facing Create workflow; reservations and verification are internal operations, not separate products.
2. One documented application-facing issuance orchestration interface, using existing persistence and signer adapters. Do not collapse distinct trust boundaries or erase history.
3. One versioned public identity/readiness contract between web application and private signer: expected Testnet, issuer public key, signer public key, service identity, and deployment/config identity. Signer independently validates its policy; matching `/healthz` status by itself is not proof of readiness.
4. One user-facing projection for issuance status sourced from durable intent, attempt and independent confirmation, without replacing their authoritative protected records.
5. One persistent managed Project Profile for dashboard/page information, with metadata publication and on-chain confirmation explicitly separate.
6. Future RYLO reward, payments, liquidity, Dedicated Issuer and Soroban products remain modular and outside the first creation critical path; their approved policies remain intact.
7. Reuse the current Railway / Neon / Cloudflare prototype baseline; add no service, queue, framework or database without observed need.

## Ordered delivery gates

### P0 — Evidence baseline and blockers
- Reconcile exact `main`, open PRs, tests/CI, migrations/roles, signer deployment and safe public identity tuples.
- Diagnose recorded web-to-signer identity mismatch rather than automatically changing approved keys. The latest `main` merge (#74) adds diagnostic evidence, **not** proof of successful customer issuance.
- Gate: one reproducible failing observable, accountable specialist, and current deployment evidence.

### P1 — Testnet signing readiness
- Align configured *issuer* and *operational signer* roles with on-chain authorization, secure service-scoped Railway secrets and authenticated signer endpoint.
- Check from deployed web service: network, service identity, issuer, signer, deployment identity and authenticated malformed-input rejection, without live signing.
- Gate: independently reviewed, reproducible readiness; live signing remains owner-gated.

### P2 — One automated customer issuance
- Prove wallet session, trustline prerequisite, atomic reservation, durable complete intent, controlled signing/submission, exact-hash independent confirmation, truthful project result.
- Test unknown outcome, timeout and duplicate requests; preserve the MVP Lite one-attempt DB rule.
- Gate: owner-authorized fresh UI-to-Stellar Testnet success; operator-assisted issuance is insufficient.

### P3 — Remove evidenced duplication
- Map all APIs, modules, DB records and trust boundaries for that working path. Remove only verified redundant transformations/state/protocol layers, one small reversible PR at a time.
- Gate: existing database, authorization, concurrency, retry and ledger-evidence tests remain green; no migration-history rewriting.

### P4 — Finish the simple project UX
- Expose created asset, exact verification status, profile, and safe publication/readiness using one Project Profile.
- Gate: customer can inspect the result and distinguish an unconfirmed asset from a confirmed one.

### P5 — Activate other products independently
- RYLO eligibility and reward activation consumes verified trusted creation events; Dedicated Issuer/contract products follow separate reviewed flows.
- Gate: no dependency from ordinary Shared Issuer creation to RYLO, liquidity, or contract deployments.

## Proposed execution rules

- `Product Architect`: product boundaries, sequence, and canonical decision proposals.
- `Full-stack`: UI, application orchestration, persistence integration.
- `Stellar/Contract`: transaction build/sign/submit interface, on-chain verification.
- `Security/Enablement`: narrow independent review of actually changed high-risk invariants and database privilege boundaries.
- Each task has one observable failure/acceptance criterion, minimal scoped fix, specific tests and deployment evidence. Avoid repeated handoff loops.

## Rejected shortcuts

No big-bang rewrite, microservice decomposition, speculative queue, generic cross-chain layer, bypass of signer isolation, weakening of idempotency/confirmation, unsafe reservation release, migration rewrites, or unreviewed Mainnet activation.

## Documentation adoption

If the owner approves ADR-S01, link it from the canonical architecture and source-of-truth documentation in a separate small documentation change. Changes to previously approved product or financial/issuer policy require explicit owner decisions and corresponding updates to `OPEN_DECISIONS.md` and relevant canonical policies. Code refactors should be separately scoped and reviewed.

## Evidence limitation

This proposal is based on canonical repository documents and targeted inspection of web configuration, the database-hardening migration and the recorded runtime signer mismatch. It is not a claim of full-file audit, working deployed signing, Testnet success, or Mainnet readiness.
