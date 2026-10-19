# Orrylo — Lean Agent Rules

1. Reconcile current GitHub main, active relevant PRs, tests and runtime evidence before implementation. Read `docs/SOURCE_OF_TRUTH.md` and only the **task-relevant** companion document; do **not** automatically load entire historical archives or all companion policies.
2. Current milestone: one safe automated customer Shared Issuer asset creation on Stellar Testnet, with verified exact ledger confirmation and truthful dashboard state.
3. Roles: Architect (scope/decisions), Full-stack (app, database integration), Stellar (transactions/issuer/signer), Security (independent boundary review). One observable blocker, one accountable implementer, one bounded review.
4. Keep current critical safety controls: isolated secret custody, authorized customer ownership, issuer separation, immutable issuance identity, durable idempotency, unknown-outcome reconciliation, exact ledger verification and database privilege boundaries.
5. No live signing, issuer/account mutation, funding, secrets, migrations on deployed DB, or Mainnet action without applicable owner authorization. No feature claim without test/deployment/on-chain evidence.
6. Defer RYLO economics/authorization, complex governance, liquidity, Dedicated Issuers and contract templates from MVP execution. Do not interpret deferral as permission to weaken existing live security or silently change approved on-chain policy.
7. Changes to policy go through a reviewed PR. Preserve previous policy snapshots in `docs/archive/2026-10-19/`; read archived sections only if relevant to the task.
8. Keep handoffs concise: exact repo/ref, one objective, acceptance criteria, non-goals, tests and relevant security constraints.
