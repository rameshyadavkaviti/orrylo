# Orrylo — Clean MVP Rebuild

This branch is a **clean architectural restart**, not a release. It starts at original main commit `3197e9492fc5001891e08cb5e8e1ac7deb967a66` and deliberately keeps all legacy files until they can be evaluated or replaced safely. Its ancestry is shared with main; **existing files do not define the new design**.

## Goal
One customer connects Albedo, requests a Stellar Testnet Shared Issuer token, and sees actual issuer, code, amount, destination, transaction hash and explorer link after independent ledger confirmation.

## Development status
**Documentation and branch preparation only.** The fresh implementation has not replaced the inherited legacy web stack, and end-to-end Testnet success has not been demonstrated by this rebuild branch. Do not confuse inherited code or previous Testnet exercises with successful clean-rebuild delivery.

## First implementation milestone
1. Define a tiny typed API to validate a creation request and prepare an immutable issuance intent.
2. Implement Albedo session and owner binding with the minimum persistence needed for safe replay.
3. Check exact known issuer/signer identities and destination trustline readiness.
4. Integrate the protected signer and Stellar SDK transaction submission.
5. Independently reconcile exact Testnet transaction and display the verified result.

Start with a thin vertical slice. Reuse known-good pieces only after checking dependencies, tests and operational assumptions.

## Minimal documentation
- [Source of truth](docs/SOURCE_OF_TRUTH.md): active scope and safety invariants
- [Architecture](docs/ARCHITECTURE.md): proposed small component layout
- [Roadmap](docs/ROADMAP.md): steps and objective completion gates
- [Agent rules](AGENTS.md): concise workflow
- [Legacy backup branch](https://github.com/rameshyadavkaviti/orrylo/tree/legacy/pre-rebuild): original full history, implementation and policies

## Boundary
`main` and live services must not be changed as part of this rebuild. Existing migrations cannot be blindly applied to shared databases. Financial/on-chain actions need separate owner approval.
