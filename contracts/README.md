# Orrylo Soroban contracts

This directory is the technical foundation for Orrylo's Soroban layer.

## Current scope

Phase 1 intentionally implements only a policy-neutral foundation contract.

It does **not** implement:

- RYLO mint, burn, maximum-supply, or service-spend behavior;
- RYLO trustline authorization or revocation;
- Shared Issuer lifecycle rules;
- Dedicated Issuer token templates;
- final contract admin/governance;
- admin transfer;
- contract upgrades;
- emergency powers;
- testnet or mainnet deployment.

Those items remain governed by the canonical documents under `docs/`, including
`docs/OPEN_DECISIONS.md`.

## Workspace

```text
contracts/
  foundation/
    Cargo.toml
    src/
      lib.rs
      test.rs
```

The workspace pins `soroban-sdk = 28.0.0`.

### Commands

Run unit tests:

```sh
cargo test --workspace
```

Check formatting:

```sh
cargo fmt --all -- --check
```

Build deployable Wasm with Stellar CLI 28:

```sh
rustup target add wasm32v1-none
stellar contract build
```

## Foundation interface

| Entrypoint | Purpose | Authorization | Reads | Writes | Errors | Invariant |
| --- | --- | --- | --- | --- | --- | --- |
| `__constructor(initializer)` | Atomically create versioned foundation state at deploy time | `initializer.require_auth()` | Existing state guard | Foundation state | `AlreadyInitialized` internally | No uninitialized takeover window; initializer substitution requires authorization |
| `version()` | Inspect foundation schema version | None | Constant | None | None | Deterministic, side-effect-free |
| `state()` | Inspect foundation state/provenance | None | Foundation state | None | `StateUnavailable` | Deterministic, side-effect-free |

The constructor is a Soroban host-only deployment hook, not a normal callable
entrypoint. This prevents a later transaction from re-running initialization.

The recorded `initializer` is **deployment provenance only**. It grants no
post-deployment administrative, issuer, mint, burn, upgrade, emergency, or
trustline-authorization capability.

## Security baseline established

- initialization is atomic with deployment;
- initialization logic requires explicit address authorization;
- initialization is single-use;
- state is explicitly versioned for future migration awareness;
- reads are deterministic and non-mutating;
- missing foundation state returns a typed contract error;
- there is no hidden administrator or alternate authority path;
- no RYLO economics or unresolved issuer policy is encoded.

The test-only initialization harness exists solely to exercise the constructor's
shared authorization and duplicate-initialization logic. It is excluded from
deployable contract code.
