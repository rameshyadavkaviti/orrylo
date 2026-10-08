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

**Public prototype application / pre-execution Stellar workflows.**

The repository contains the security-reviewed Soroban foundation interface plus
a customer-facing Next.js prototype under `web/`. Visitors can understand
Orrylo, authenticate with Albedo, create and validate a local Shared Issuer token
draft, preview it safely, and explore current RYLO policy and future products.

Token issuance remains unavailable: the application does not perform issuer,
contract, trustline, RYLO execution, liquidity, testnet issuance, or mainnet
mutations. The server-side eligibility/reward preparation foundation also remains
inactive until a reviewed qualifying-event producer and later execution layers
exist.

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
