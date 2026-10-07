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

**Contract Interface Lock implementation.**

The repository contains a minimal Soroban workspace and a policy-neutral,
versioned foundation interface that future backend/application code can inspect
without depending on unresolved RYLO economics or governance.

It does not yet implement RYLO economics, issuer configuration, trustline
authorization, final contract governance, Dedicated Issuer templates, or any
testnet/mainnet deployment.

See [docs/CONTRACT_INTERFACE.md](docs/CONTRACT_INTERFACE.md) for the exact stable
surface and [contracts/README.md](contracts/README.md) for reproducible
build/test/spec-verification commands.

No production contract, issuer, testnet/mainnet deployment, or token economics
parameter should be inferred as implemented unless the repository contains
explicit implementation evidence and the source-of-truth documents say so.

## Brand

- Company: **Orrylo**
- Ecosystem token: **RYLO**
- Network: **Stellar**
