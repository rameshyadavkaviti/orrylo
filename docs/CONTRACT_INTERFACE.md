# Orrylo Contract Interface — v1

Status: **Stable application-facing foundation interface**

This document is the application integration reference for the Soroban contract
surface currently implemented by Orrylo.

It describes only behavior that exists in code and is covered by contract/spec
tests. It does not resolve any item in `OPEN_DECISIONS.md`.

## Compatibility rule

The contract exposes two intentionally separate versions:

- `interface_version()` returns the **application-facing ABI compatibility level**.
- `version()` returns the **foundation state schema version**.

Current values:

```text
interface version: 1
foundation state version: 1
```

Application integrations should use `interface_version()` as the primary
compatibility gate.

Interface version `1` means the methods, parameter/return types, and typed-error
semantics documented here are available. The interface version must be increased
before an incompatible change to that stable boundary is merged.

A deliberately additive entrypoint may remain on the same interface version only
when the existing v1 surface remains compatible. Any public-surface change must
also pass the generated Soroban spec regression check.

The state version is independent. It exists for contract storage/migration
awareness and must not be treated as the application ABI version.

## Stable public contract surface

### `__constructor(initializer: Address) -> ()`

Purpose: atomically establish the versioned foundation state at deployment.

Authorization: `initializer.require_auth()`.

State read: checks whether foundation state already exists.

State write: writes `FoundationState { state_version, initializer }`.

Failures:

- missing/invalid initializer authorization is a Soroban host authorization
  failure;
- `Error::AlreadyInitialized = 1` is the contract's defensive initialization
  guard;
- deploying to an already-created deterministic address is rejected by the
  Soroban host before it can be treated as a normal repeat call.

Idempotency: not a repeatable application call. Exactly one successful deployment
may occupy a deterministic contract address. A failed constructor invocation
rolls back without leaving a partial instance.

Stability: stable deployment interface for v1.

The initializer is deployment provenance only. It receives no post-deployment
admin, issuer, mint, burn, authorization, upgrade, emergency, or recovery power.

### `interface_version() -> u32`

Purpose: allow backend/application code to detect ABI compatibility.

Authorization: none.

State read/write: none; returns the compile-time interface constant.

Failures: none.

Idempotency: deterministic and side-effect-free.

Current result: `1`.

Stability: stable application integration method.

### `version() -> u32`

Purpose: inspect the foundation state schema version.

Authorization: none.

State read/write: none; returns the compile-time state-schema constant.

Failures: none.

Idempotency: deterministic and side-effect-free.

Current result: `1`.

Stability: method and return type are stable for interface v1. The returned state
version may increase in a future explicitly reviewed storage migration.

### `state() -> Result<FoundationState, Error>`

Purpose: inspect policy-neutral foundation state and deployment provenance.

Parameters: none.

Authorization: none.

State read: foundation instance state.

State write: none.

Success value:

```text
FoundationState {
  initializer: Address,
  state_version: u32,
}
```

Failure:

- `Error::StateUnavailable = 2` when expected foundation state is unavailable.

Idempotency: deterministic and side-effect-free for unchanged on-chain state.

Stability: stable application integration method and return shape for interface
v1.

## Typed errors

The currently generated contract error enum is:

| Code | Variant | Meaning |
| ---: | --- | --- |
| 1 | `AlreadyInitialized` | Defensive initialization guard detected existing foundation state |
| 2 | `StateUnavailable` | `state()` could not load the expected foundation state |

Backend code may map these numeric contract errors without parsing error strings.

Host-level authorization/deployment failures are not converted into invented
contract-error variants. In particular, missing constructor authorization and an
already-occupied deterministic deployment address are host failures.

## Intentionally unavailable contract methods

No production entrypoint currently exists for:

- RYLO member/trustline authorization or revocation;
- RYLO minting;
- RYLO burning;
- initial or maximum supply configuration;
- reward issuance;
- service-spend handling;
- direct-sale pricing;
- Shared Issuer mutation/configuration;
- Dedicated Issuer template operations;
- admin transfer;
- governance/multisig;
- contract upgrade;
- emergency or recovery powers.

Application code must not fabricate these capabilities or infer them from the
foundation contract.

## Contract versus backend boundary

Currently on-chain:

- atomic contract initialization;
- deployment provenance;
- explicit initializer authorization;
- interface compatibility identity;
- state-schema identity;
- deterministic read-only foundation inspection.

Currently backend/application responsibility:

- qualifying-action detection and product/order orchestration;
- presentation of RYLO eligibility policy;
- Shared Issuer asset-code uniqueness coordination;
- metadata/domain workflows;
- deciding whether a requested operation is unavailable because the required
  contract policy remains unresolved.

A future backend may record that a wallet has completed an approved qualifying
Orrylo action, but it must not imply that a RYLO trustline has been authorized
until the final Stellar authorization mechanism is explicitly decided and
implemented.

## Generated Soroban spec lock

The generated contract spec is an integration boundary.

After building:

```sh
stellar contract build --locked
stellar contract info interface \
  --wasm target/wasm32v1-none/release/orrylo_foundation.wasm \
  --output json-formatted
contracts/foundation/check-interface.sh
```

`check-interface.sh` compares the generated function signatures, typed errors,
and `FoundationState` shape against
`contracts/foundation/interface.expected.json`. An unintended public entrypoint,
signature change, error-code change, or locked type-shape change fails CI.

Do not update the expectation mechanically. Review any ABI change together with
the compatibility version and this document.
