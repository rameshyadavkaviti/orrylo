# Orrylo balanced architecture simplification — proposal

Status: **Proposed / documentation-only / not approved product-policy change**
Baseline inspected: `main` at `3197e9492fc5001891e08cb5e8e1ac7deb967a66` (2026-10-19).
Owner: Product Architect. This document does not supersede `docs/SOURCE_OF_TRUTH.md`, `docs/ARCHITECTURE.md`, `docs/RYLO_POLICY.md`, `docs/OPEN_DECISIONS.md`, or `AGENTS.md`.

## Goal and guardrails

Deliver the shortest **safe, automatic, end-to-end customer Shared Issuer asset creation on Stellar Testnet**, from authenticated wallet through exact verified ledger outcome to truthful managed Project Profile. Simplify the work needed to reach it, **not** the security invariants. No broad rewrite, table deletion, live signer/key change, production deployment, or policy mutation is authorized by this proposal.

Keep a modular Next.js/TypeScript application, one PostgreSQL persistence system, the independent private Testnet signing service, and Stellar as source of truth for ledger facts. This is a **logical boundary recommendation**, not a claim that deployment currently works.

## Non-negotiable trust boundaries

1. Wallet authentication, session identity and project ownership are server-verified; browser payload cannot choose the authoritative owner.
2. Customer Shared Issuer remains distinct from RYLO issuer and its signing/authorization model. The dedicated RYLO 2-of-3 policy is **not** replaced by the bounded Testnet Shared Issuer signing arrangement.
3. No issuer private key in browser, ordinary web service, repository, logs or application database; signer has separate secrets, identity and policy checks.
4. Asset-code reservation is issuer-scoped and concurrency-safe. Never release a code while submission/ledger outcome might be successful; preserve auditable evidence.
5. Bind immutable full issuance intent (network, issuer, owner, destination, code, exact initial amount and relevant transaction characteristics) before signing. Application status alone does not establish on-chain facts.
6. Signing/submission is bounded, request-authenticated and idempotent. MVP Lite's approved one-attempt constraint remains. Unknown, lost-response, or timeout outcomes require reconciliation; never blindly retry or create another issuance attempt.
7. Independently verify the exact submitted signed envelope/transaction, successful ledger outcome and immutable intent before displaying 'issued' or publishing metadata as reachable.
8. Preserve DB ownership, least privilege, dedicated trusted confirmation writer, signed-envelope-bound publication guards, append-only audit records and migration compatibility. Do not edit historic migrations in place.
9. Never present a saved draft/Project Profile, TOML preview, HTTP readiness, or approved architecture as deployed token creation.
10. Mainnet issuance, RYLO mint/reward/liquidity, Dedicated Issuer/Soroban templates, new wallets and custom domains are not prerequisites to the first Testnet MVP.

## Simplified logical topology

```text
Customer wallet / Albedo
          |
          v
Single Next.js application (UI + authenticated API + orchestration)
          |
          +--> PostgreSQL (orders, durable immutable intent, attempts, project, audit)
          |
          +--> private signer boundary (separate deployed runtime and key custody)
          |
          +--> Stellar Testnet (transaction submission + independent confirmation)
```

Distinct interfaces and DB identities remain where independent trust boundaries require them. 'Single application' does not mean placing issuer secrets in the web process or replacing trusted confirmation-writer identity with the ordinary application DB login.

## One customer journey, five conceptual stages

| Stage | Responsible boundary | Exit evidence |
| --- | --- | --- |
| Prepare | Authenticated app + Stellar reader | Wallet owner, pinned network/issuer/signer identities, receiver trustline readiness |
| Commit | Server + PostgreSQL | Atomic code reservation and immutable full intent with idempotency key |
| Execute | App orchestration + isolated signer | Exactly reviewed transaction/envelope, authenticated protected signing and bounded submission |
| Reconcile | Trusted ledger confirmation path | Exact signed-envelope/transaction and immutable-intent match, or explicit unknown/failed state |
| Present | Project Profile / public view | Truthful result and explorer evidence only after verification |

These are conceptual phases, **not** five microservices, a replacement schema, or authorization to bypass existing transitions.

## Evidence-driven architecture audit

| Observed or documented finding | Why it matters | Recommendation | Classification |
| --- | --- | --- | --- |
| `web/package.json` runs a Next.js app and separate `signer:build`/`signer:start` entrypoints | Signing boundary already exists | Keep separate signer runtime; do not add independent product microservices | Keep |
| `web/README.md` documents durable Albedo sessions, Project Profile, generic workflow, audit, metadata readiness, eligibility foundations | Foundations span capabilities beyond P0 issuance | Keep proven foundations; do not activate additional business flows on P0 critical path | Scope reduction |
| `web/db/migrations/010_mvp_lite_db_security_hardening.sql` guards one attempt via `CHECK (attempt_number = 1) NOT VALID`, signed-envelope metadata provenance and dedicated writer boundary | DB protections are intentional, including historical upgrade compatibility | Keep and regression-test; never simplify by removing constraints | Keep |
| `SOURCE_OF_TRUTH.md` section 17.0.1 records 2026-10-17 deployed signer identity mismatch | Runtime readiness is not the same as successful HTTP health | Verify expected network + issuer + signer + service identity and deployment version across web and signer; do not infer approval of unexpected keys | P0 blocker, historical evidence requiring current verification |
| Mainnet, RYLO economy, Dedicated Issuer templates and expanded publishing are defined but not P0 | Cross-feature dependencies delay actual customer issuance | Defer integration/activation; preserve approved intent | Defer |
| Repeated application lifecycle concepts (project, reservation, workflow, attempt, publication) | May cause redundant state or confusion | Map source-of-truth for each fact; create read-only customer-facing status projection only after checking boundaries | Investigate, **not** confirmed duplication |

Scope limitation: This is a targeted repo/canonical-document review, **not** an exhaustive source-tree analysis, CI certification, current Railway environment verification or full PR inventory. Do not claim duplicate state or unnecessary classes/files without a concrete code-path map and failing/test evidence.

## Ordered delivery / GitHub work packages

### P0 — Reconcile exact current baseline and active work

**Owner:** Security / Enablement with Product Architect coordination.
- Record current `main`, active PR heads, review decisions, and CI; verify read-only migration/schema state and deployment build identity.
- Produce one compact critical-path issue map with one accountable owner per blocker; avoid duplicate issues or restarting already merged work.
- Compare known signer identity mismatch with *current* deployed identity, not October 17 evidence alone.
**Done when:** each blocking gate has current reproducible evidence and one next owner action.

### P1 — Unify identity and readiness contract (no signing bypass)

**Owner:** Stellar / Contract + Full-stack; independent security review.
- Define an exact typed public identity tuple (Testnet passphrase, issuer public key, operational signer public key, service identity, runtime/deployment version).
- Web preflight validates full tuple against trusted configured values; signer independently validates its own expected key/transaction policy. Health alone never authorizes issuance.
- Check receiver trustline state against exact code+issuer on Testnet; surface actionable prerequisite in UI.
- Keep secure provisioning/backup and owner authorization gates for secrets, Railway changes and live probes.
**Done when:** safe cross-service identity/auth and trustline checks are reproducible; mismatch fails closed.

### P2 — Complete automated Testnet Shared Issuer creation

**Owner:** Full-stack integration + Stellar execution; Security validation.
- Trace existing endpoints/functions/tables and reuse reviewed reservation, immutable-intent, DB privilege, signer and confirmation controls.
- Implement/repair only missing connections in a single customer journey; no new generalized workflow framework.
- Preserve one-attempt MVP Lite model, unknown-submission handling, exact signed-envelope verification and truthful project state.
**Done when:** one explicitly owner-authorized fresh customer UI journey ends in independently confirmed Testnet issuer/code/amount/destination and project evidence.

### P3 — Simplify code and state after a working baseline

**Owner:** Full-stack; Security approves boundary changes.
- Create a dependency table enumerating actual endpoints, server functions, tables, secrets, network calls and owners.
- Find **demonstrated** duplicate data transforms, unnecessary API round trips and overlapping orchestrators.
- Consolidate only when tests cover auth, races, crash/restart, stale state, timeout, unknown outcome, no double issue, and migration from existing records.
- Prefer one application-facing *derived* status over replacing immutable attempts or ledger evidence.
**Done when:** measured code-path simplification, fewer redundant calls/branches, zero regression to trust boundaries.

### P4 — Project experience and metadata

**Owner:** Full-stack / UI.
- Center creation result around stable project ID and Project Profile; clear create/publish/manage distinction.
- Keep `/p/<slug>` presentation independent of immutable Stellar asset identity and TOML hosting.
- Display publication states accurately; don't claim reachable TOML/explorer indexing from an in-app preview.
**Done when:** user can see reliable token results and manage profile without internal workflow jargon.

### P5 — Activate separately after P0-P4

**Owner:** Product Architect schedules specialist work.
- RYLO eligibility/reward and protected minting only from independently trusted successful-creation event; maintain separate issuer/security policy.
- Dedicated Issuer and Soroban templates only through explicit product/policy decisions.
- New wallets, custom domains, infrastructure expansion only when justified.
**Done when:** each extension has a separate tested vertical slice and does not regress basic issuance.

## Change control and acceptance

- First refactor PR is **documentation and inventory only**. Subsequent PRs must each solve one reproducible problem with tests and deployment evidence.
- No new policy is ratified by this proposal. Any modification to approved supply, RYLO signer thresholds, issuer flags, ownership, payment, retries, key custody, or Mainnet topology requires owner decision and coordinated canonical doc updates.
- Never merge a refactor just because lint/unit tests pass if it changes security-sensitive behavior: require relevant DB integration tests, signer boundary tests and independent review.
- For P2 live signing, submission, account mutation and deployment, retain explicit owner authorization and security approval.
