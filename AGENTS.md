# Orrylo Clean Rebuild — Agent Rules

Scope: `rebuild/clean-mvp` only. Never modify, merge, force-push, or replace `main` without explicit owner approval.

1. Read `docs/SOURCE_OF_TRUTH.md` and `docs/ROADMAP.md`, then only the task-relevant files. Do not preload legacy policy histories.
2. Preserve the established Testnet issuance while implementing the owner-approved, strictly gated 10 XLM customer Mainnet journey documented in `docs/SOURCE_OF_TRUTH.md`. Work in minimal complete vertical slices.
3. Treat inherited code as reference, not as mandatory architecture. Mark reused code explicitly and justify dependencies.
4. Keep the separate issuer-secret signing boundary, authenticated ownership, immutable request identity, concurrency/idempotency guarantees, safe unknown-outcome reconciliation and exact on-chain verification.
5. Do not conflate successful UI/API responses with confirmed token issuance.
6. RYLO financial operations, Dedicated Issuers, Soroban templates, advanced governance and **live Mainnet activation** remain deferred. Mainnet *preparatory code and specifically authorized account/database setup* are in scope; see the canonical `SOURCE_OF_TRUTH.md` checkpoint. Do not undo or re-create completed infrastructure.
7. One change, one observable acceptance test, one reviewer only where risk justifies review. Avoid speculative frameworks or multiple redundant PRs.
8. Do not alter live deployments, keys, accounts, issuer authority, signer configuration, funded wallets or shared databases without specific owner authorization.
9. Report exactly what changed and what is still unverified. Do not claim build/test success without executing them.
