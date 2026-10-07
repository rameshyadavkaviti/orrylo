# Orrylo

Orrylo is a Stellar-focused product company and platform for creating assets, contract-controlled token infrastructure, and higher-level products.

## Canonical project documentation

The repository's current source of truth is:

- [docs/SOURCE_OF_TRUTH.md](docs/SOURCE_OF_TRUTH.md) — canonical product and architecture decisions
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — system boundaries and intended architecture
- [docs/RYLO_POLICY.md](docs/RYLO_POLICY.md) — RYLO ecosystem-token rules
- [docs/OPEN_DECISIONS.md](docs/OPEN_DECISIONS.md) — unresolved decisions that must not be treated as final
- [AGENTS.md](AGENTS.md) — rules for developers and AI agents working in this repository

## Current status

**Contract Foundation implementation.**

The repository contains a minimal Soroban workspace and policy-neutral foundation
contract. It does not yet implement RYLO economics, issuer configuration,
trustline authorization, final contract governance, Dedicated Issuer templates,
or any testnet/mainnet deployment.

See [contracts/README.md](contracts/README.md) for the implemented contract
surface and reproducible build/test commands.

No production contract, issuer, mainnet deployment, or token economics parameter should be inferred as implemented unless the repository contains explicit implementation evidence and the source-of-truth documents say so.

## Brand

- Company: **Orrylo**
- Ecosystem token: **RYLO**
- Network: **Stellar**
