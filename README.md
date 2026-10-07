# Orrylo

Orrylo is a Stellar-focused product company and platform for creating assets, contract-controlled token infrastructure, and higher-level products.

## Canonical project documentation

The repository's current source of truth is:

- [docs/SOURCE_OF_TRUTH.md](docs/SOURCE_OF_TRUTH.md) — canonical product and architecture decisions
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — system boundaries and intended architecture
- [docs/RYLO_POLICY.md](docs/RYLO_POLICY.md) — RYLO ecosystem-token rules
- [docs/OPEN_DECISIONS.md](docs/OPEN_DECISIONS.md) — unresolved decisions that must not be treated as final
- [docs/CONTRACT_INTERFACE.md](docs/CONTRACT_INTERFACE.md) — stable application-facing Soroban interface
- [AGENTS.md](AGENTS.md) — rules for developers and AI agents working in this repository

## Current status

**Application Phase 1 — Full-stack Foundation.**

The repository contains the security-reviewed Soroban foundation interface plus
a Next.js application shell under `web/`. The application is explicit demo
state only: it provides the approved dashboard/screens, typed adapter boundaries,
Contract Interface v1 compatibility logic, form validation, tests, and web CI
without performing live wallet, issuer, contract, testnet, or mainnet mutations.

It does not yet implement RYLO economics, issuer configuration, trustline
authorization, final contract governance, Dedicated Issuer templates, real
wallet connection, real token issuance, or any testnet/mainnet deployment.

See [docs/CONTRACT_INTERFACE.md](docs/CONTRACT_INTERFACE.md) for the exact stable
contract surface, [contracts/README.md](contracts/README.md) for reproducible
contract verification, and [web/README.md](web/README.md) for application setup
and current mock/live boundaries.

No production contract, issuer, testnet/mainnet deployment, or token economics
parameter should be inferred as implemented unless the repository contains
explicit implementation evidence and the source-of-truth documents say so.

## Brand

- Company: **Orrylo**
- Ecosystem token: **RYLO**
- Network: **Stellar**
