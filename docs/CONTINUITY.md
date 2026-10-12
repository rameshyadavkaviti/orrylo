# Orrylo Continuity Checkpoint

Status: **Operational handoff snapshot**

Checkpoint date: **2026-10-12**

This file is a continuity aid for replacement agents. It does **not** override `SOURCE_OF_TRUTH.md`, `ARCHITECTURE.md`, `RYLO_POLICY.md`, `OPEN_DECISIONS.md`, `CONTRACT_INTERFACE.md`, or `AGENTS.md`. GitHub `main` and those canonical documents remain authoritative. Reconcile live repository/deployment/on-chain state before acting.

## Repository baseline

At this checkpoint, GitHub `main` is at commit:

```text
533e89b3b844f11d95dff78db016aa91b7366c5f
```

That commit is the merge of PR #24, **DB: reconcile legacy migration ledger drift safely**.

PR #24 is merged. Its reviewed repair preserves migrations 001–005 and adds narrowly scoped migration-002 reconciliation for the verified legacy partial state. The implementation verifies the exact existing PostgreSQL UNIQUE constraint/backing index and original migration checksum under serialized migration execution before recording migration 002. Conflicting states fail closed.

The PR's isolated CI passed before merge, including formatting/lint, typecheck, unit tests, database migration/verification, database integration regressions, and production build.

**Important:** merge/CI evidence is not production rollout evidence. At this checkpoint, successful post-merge Railway migration/deployment, production ledger reconciliation through migrations 002–005, and end-to-end `POST /api/projects` / “Save & manage project” recovery have not yet been recorded here as verified facts.

## Confirmed production database defect evidence

Read-only inspection of the actual Neon production database established:

- `schema_migrations` recorded only `001_application_persistence.sql` before the repair rollout;
- migration 002 was absent from the ledger;
- `reward_records_wallet_reward_type_unique` already existed as a genuine PostgreSQL UNIQUE constraint;
- exact definition: `UNIQUE (wallet_public_key, reward_type)`;
- its backing unique index existed with the same name and columns;
- Railway's prior migration attempt failed with PostgreSQL `42P07` when unrecorded migration 002 tried to recreate that already-correct object.

The approved repair must not drop/recreate that constraint or reset production data.

## Immediate production gate

After PR #24 merge, the Full-stack Product Agent owns controlled rollout verification:

1. verify the merged `main` and CI;
2. observe the normal Railway predeploy path;
3. verify migrations 002–005 complete and `db:verify` passes;
4. verify `https://orrylo.com` remains healthy;
5. verify authenticated `POST /api/projects` succeeds;
6. verify “Save & manage project” end to end;
7. verify existing production data and the reward UNIQUE constraint remain intact.

Manual production SQL is not the default repair path. Do not expand this rollout into Shared Issuer, RYLO, Stellar, or unrelated feature work.

## RYLO metadata / home-domain decision

The user explicitly approved:

```text
RYLO home_domain = orrylo.com
RYLO metadata endpoint = https://orrylo.com/.well-known/stellar.toml
```

RYLO metadata is separate from customer Shared Issuer metadata. `assets.orrylo.com` remains the Shared Issuer metadata domain and must not silently become the RYLO issuer `home_domain`.

PR #23, **DOCS: lock RYLO home_domain to orrylo.com**, remains open at this checkpoint and was created before PR #24 moved `main`. Reconcile/update it against current `main` before merge rather than treating the open PR itself as merged canonical evidence.

The approved RYLO logo for TOML/public metadata is the exact latest user-approved generated purple RYLO logo from the project conversation. Repository replacement/deployment of that image has **not** been verified at this checkpoint. Do not claim the existing repository logo was replaced until repository/deployment evidence proves it.

Before the RYLO issuer `home_domain` mutation, the intended RYLO TOML and exact approved logo must be published and reachable over HTTPS at the approved domain.

## RYLO Testnet state

Canonical identifiers remain:

- verified RYLO Testnet issuer: `GDNSIP2SKNJIKN6IG3XZBQMHIKKDET25J33F4R5V6DALKHIUDTVZOPKX`;
- abandoned candidate: `GDPKHRFAGZHDJFKLBERV7IXF2XX4TGW6MYYUDGME3MIJ3HES5SGICG5H` — never use for RYLO/SAC evidence;
- deterministic RYLO Testnet SAC address: `CAPB6JBF466Y6TY4UBAQDSN24KTILN2R2CLINBGJSIGS5BTTEEDW3GMI`.

The latest canonical repository state still describes the issuer ceremony as incomplete: Master weight 1, A/B/C weight 1, thresholds 0/0/0, required/revocable/clawback flags OFF, and no intentional RYLO mint. The target remains Master 0; A/B/C 1; thresholds 2/2/2; AUTH_REQUIRED ON; AUTH_REVOCABLE ON; AUTH_CLAWBACK OFF, with an A+B protected-operation proof before Master is reduced to 0.

The deterministic SAC address is not deployment evidence by itself. SAC deployment and StellarExpert visibility must be verified separately.

## Open work streams

- PR #23: RYLO `home_domain` documentation decision; reconcile with current `main` before merge.
- PR #19: Shared Issuer managed metadata publication on Testnet; remains a separate work stream and must not be conflated with RYLO TOML publication.
- PR #24: merged; production rollout verification is the immediate database/application gate.

## Approved final Testnet acceptance gate

The user approved the final Testnet acceptance operation order:

```text
new wallet
→ Albedo login
→ project creation
→ token creation
→ TOML / explorer verification
→ eligibility
→ RYLO trustline
→ issuer authorization
→ 150 RYLO reward
→ visible RYLO balance
→ RYLO/XLM liquidity pool
→ successful swap
→ project management
→ logout
→ login again
```

After the clean path passes, repeat with controlled failure/retry at sensitive points. The sequence is locked as the final Testnet-to-Mainnet acceptance gate unless the user explicitly approves a later change.

## Mainnet direction

The approved execution direction is Mainnet preparation **after** Testnet acceptance evidence, not immediate Mainnet mutation.

The working release framework is:

```text
Testnet acceptance
→ Mainnet readiness blueprint
→ dry-run / production simulation
→ minimal Mainnet bootstrap
→ Mainnet verification gate
→ activate product capabilities one at a time behind Security review
```

Detailed Mainnet execution steps that are not already canonical remain planning material until explicitly approved/persisted. Do not infer Mainnet deployment from reserved addresses, Testnet state, or preparation documents.

## Replacement-agent startup

A replacement Orrylo agent should:

1. fetch current GitHub `main`;
2. read `SOURCE_OF_TRUTH.md`, `ARCHITECTURE.md`, `RYLO_POLICY.md`, `OPEN_DECISIONS.md`, `CONTRACT_INTERFACE.md`, `AGENTS.md`, and this file;
3. reconcile relevant open/merged PRs, CI, deployment state, and on-chain state for its assigned task;
4. treat chat summaries and this snapshot as navigation aids where newer repository/runtime evidence exists;
5. never silently resolve an open decision or cross another agent's ownership boundary.
