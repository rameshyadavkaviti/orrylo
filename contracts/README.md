# Orrylo Soroban contracts

This directory contains Orrylo's current Soroban contract layer.

## Current scope

Phase 2 locks a minimal, policy-neutral application-facing foundation interface.

The contract still does **not** implement:

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

The stable application integration reference is
[`docs/CONTRACT_INTERFACE.md`](../docs/CONTRACT_INTERFACE.md).

## Workspace

```text
contracts/
  foundation/
    Cargo.toml
    interface.expected.json
    check-interface.sh
    src/
      lib.rs
      test.rs
```

Build reproducibility is bounded by:

- `soroban-sdk = 28.0.0`;
- committed `Cargo.lock`;
- repository Rust toolchain `1.99.0`;
- Stellar CLI `28.0.0`;
- SHA-pinned GitHub Actions used by contract CI.

The GitHub-hosted `ubuntu-latest` runner itself remains a mutable hosted
environment, so bit-for-bit runner-image reproducibility is not claimed.

### Commands

Run unit tests:

```sh
cargo test --workspace --locked
```

Check formatting:

```sh
cargo fmt --all -- --check
```

Build deployable Wasm:

```sh
stellar contract build --locked
```

Run the real-Wasm deployment authorization tests after building:

```sh
cargo test --workspace --locked wasm_ -- --ignored
```

Verify the generated application-facing interface:

```sh
contracts/foundation/check-interface.sh
```

Inspect the complete generated interface:

```sh
stellar contract info interface \
  --wasm target/wasm32v1-none/release/orrylo_foundation.wasm \
  --output json-formatted
```

## Stable foundation interface

| Entrypoint | Purpose | Authorization | Reads | Writes | Error class | Integration status |
| --- | --- | --- | --- | --- | --- | --- |
| `__constructor(initializer)` | Atomically create versioned foundation state | `initializer.require_auth()` | Initialization guard | Foundation state | Host auth / defensive `AlreadyInitialized` | Stable deployment ABI |
| `interface_version()` | Application ABI compatibility level | None | None | None | None | Stable |
| `version()` | Foundation state schema version | None | None | None | None | Stable |
| `state()` | Foundation state/provenance inspection | None | Foundation state | None | `StateUnavailable` | Stable |

The recorded `initializer` is **deployment provenance only**. It grants no
post-deployment administrative, issuer, mint, burn, upgrade, emergency, or
trustline-authorization capability.

## Security baseline

- initialization is atomic with deployment;
- initialization requires explicit address authorization;
- failed real-Wasm construction rolls back completely;
- duplicate deterministic deployment is rejected;
- state is explicitly versioned;
- application ABI compatibility is explicitly versioned;
- reads are deterministic and non-mutating;
- typed errors are locked by generated-spec regression checks;
- no hidden administrator or alternate authority path exists;
- no unresolved RYLO economics or issuer policy is encoded.

The test-only initialization/deployment harnesses exist solely to exercise
authorization and deployment invariants. They are excluded from deployable
contract code.
