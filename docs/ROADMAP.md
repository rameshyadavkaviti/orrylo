# Orrylo Clean Rebuild — Delivery Roadmap

Applies only to `rebuild/clean-mvp`. Complete means observed and verified, not documented intent.

## 0. Preserve and prepare
- [x] Record original main: `3197e9492fc5001891e08cb5e8e1ac7deb967a66`.
- [x] Create backup `legacy/pre-rebuild`.
- [x] Create rebuild `rebuild/clean-mvp`.
- [x] Replace active rebuild guidance with lean documentation.
- [ ] Inventory inherited modules; classify as preserve, rewrite or defer before code removal.

## 1. Product skeleton
- [ ] Small Next.js UI: connect Albedo, input asset code and amount, confirm request.
- [ ] Authenticated owner-bound server validation and immutable exact issuance request.
- [ ] Atomic issuer-scoped uniqueness, idempotent retries and explicit persistent states.
- [ ] Build and exercise minimal tests.

## 2. Stellar Testnet integration
- [ ] Independently verify configured issuer, signing authority and trustline prerequisites.
- [ ] Securely integrate isolated bounded signer; keep issuer secret outside web runtime.
- [ ] Sign/submit exactly authorized issuance, with separate owner authorization for live Testnet mutations.
- [ ] Reconcile unknown outcomes and exact signed transaction with Stellar.
- [ ] Show confirmed issuer, code, amount, destination, transaction hash and explorer link.

## 3. Reliability and release preparation
- [ ] Test double-click, concurrency, timeouts, retries, lost responses and release of unissued reservations.
- [ ] Confirm signer authorization/secrets, reproducible deployment and rollback process.
- [ ] Demonstrate real end-to-end UI-to-ledger Testnet issuance with evidence.

## 4. Consider mainline (owner gate)
- [ ] Owner confirms acceptance.
- [ ] Prepare reviewed history-preserving integration or clean-tree replacement plan.
- [ ] No merge, force-push, live deployment or main replacement without explicit owner approval.

## First code task
Map inherited auth, routes, database mutations, issuance adapters, signer and Stellar dependencies. Select a minimal rewrite surface. The first vertical slice must not claim on-chain issuance before it exists.
