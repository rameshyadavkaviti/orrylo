# Shared Issuer Testnet Issuance Boundary

Status: **Implemented preparation boundary / live issuance blocked by open policy and operational authorization**

This document describes the bounded Stellar-specific integration surface for
creating customer Classic Stellar assets through Orrylo's Shared Issuer on
Testnet. It does not resolve any open Shared Issuer policy decision and is not
deployment evidence.

## Current canonical blockers

Current `main` still records the Shared Issuer address only as a reserved
candidate:

`GBR7SEZD4ITXQPAWEVBX2BULS76ERDRTRMIS3LUYKZ7DNLGZZ6ASSETS`

The repository does **not** currently authorize using that account as the live
Shared Issuer. `docs/OPEN_DECISIONS.md` also leaves the final Shared Issuer
account authorization flags and detailed lifecycle rules unresolved.

A real issuance additionally requires an explicit customer destination account,
an explicit issuance amount, a destination trustline for the exact asset, and a
reviewed signer-custody/submission path. This implementation intentionally
supplies no defaults for those values.

Therefore no live Testnet signing, account mutation, or token issuance is
authorized by this slice.

## Implemented server-only Stellar boundary

`web/lib/stellar/shared-issuer-issuance.ts` provides the pure preparation and
verification boundary. It:

- hard-fails outside Stellar Testnet;
- verifies the exact Testnet network passphrase;
- requires explicit project, asset code, issuer, destination, amount, fee,
  sequence, and time bounds;
- requires the application layer to prove the asset code is already atomically
  reserved for that project;
- requires an existing authorized destination trustline with enough remaining
  limit;
- requires sufficient issuer spendable XLM for the proposed fee;
- constructs exactly one Classic Stellar payment operation from issuer to
  destination;
- computes the transaction hash before signing;
- creates a signer request containing only public/canonical transaction
  material;
- verifies returned signed XDR hashes to the exact reviewed transaction;
- verifies the submission response hash;
- classifies lost-response recovery without blindly resubmitting after expiry or
  sequence advancement.

The module contains **no secret-key loading**, Horizon credentials, environment
issuer selection, database writes, HTTP routes, or automatic signer invocation.

## Full-stack integration contract

The Full-stack boundary remains responsible for durable application state and
must perform these steps before invoking the Stellar preparation function:

1. authenticate the project owner using the existing server-side wallet session;
2. load the managed project by stable `project_id`;
3. verify `issuer_model = shared` and `network = testnet`;
4. atomically reserve the normalized asset code under the approved Shared Issuer
   identity so concurrent projects cannot claim the same `asset_code + issuer`;
5. create/reuse one `workflow_intents` record using the issuance intent
   fingerprint/idempotency key;
6. supply the explicit customer destination and issuance amount selected by
   approved product policy;
7. query current ledger state for issuer sequence/fee headroom and destination
   trustline state;
8. persist the unsigned transaction hash/XDR or a safe reference before any
   signer call;
9. invoke the independently reviewed signer boundary only after policy approval;
10. submit, reconcile, and confirm the exact hash;
11. persist ledger/transaction evidence and only then mark Stellar asset
    creation confirmed;
12. publish/update metadata independently. Metadata publication success is not
    equivalent to on-chain issuance success, and issuance success is not
    equivalent to metadata publication success.

PR #19's metadata model should consume the same confirmed
`asset_code + issuer_public_key` identity. Its
`https://assets.orrylo.com/.well-known/stellar.toml` publication state remains
independent from the issuance workflow.

## Signer boundary

The signer implementation must live outside browser code and must not receive
project-controlled free-form transaction instructions.

For each request it must independently verify at minimum:

- Testnet network/passphrase;
- expected approved Shared Issuer public key;
- one payment operation only;
- exact asset code and issuer;
- exact customer destination;
- exact amount;
- explicit time bounds;
- transaction hash matches the reviewed unsigned envelope;
- request/policy identity has not been superseded.

No issuer secret may be logged, returned to the application, stored in GitHub,
or exposed to analytics.

## Retry and reconciliation rules

The logical issuance intent is stable across rebuilt transaction envelopes.
Changing sequence, fee, or time bounds does not change the intent fingerprint;
changing project, asset identity, destination, or amount does.

After an ambiguous submission result:

- check the canonical transaction hash on-chain first;
- if confirmed, record confirmation and do not resubmit;
- if terminally failed, rebuild only under the same logical intent;
- if not found and the issuer sequence is unchanged and time bounds are still
  valid, the same signed envelope may be retried;
- if expired, rebuild with fresh time bounds under the same logical intent;
- if issuer sequence advanced, reconcile ledger state before constructing any
  replacement.

## Verification matrix

Covered by deterministic tests in this slice:

- successful canonical issuance envelope construction;
- stable idempotency fingerprint across safe envelope rebuilds;
- changed amount changes the logical intent;
- duplicate/unreserved asset-code rejection;
- invalid asset code;
- wrong network/passphrase;
- missing/unauthorized/insufficient-capacity trustline;
- insufficient issuer fee headroom;
- invalid sequence/time bounds/amount;
- unauthorized signer request mutation;
- signed-envelope mutation detection;
- submission-hash mismatch;
- lost-response confirmed transaction recovery;
- same-envelope retry vs expiry vs sequence-advance reconciliation.

Still requires Full-stack/database integration tests:

- concurrent asset-code reservation across projects;
- durable duplicate request replay through `workflow_intents`;
- application database/on-chain disagreement reconciliation;
- durable partial-failure state transitions and audit events.

Still requires real Testnet acceptance after policy/operations are authorized:

- approved Shared Issuer account identity and configuration;
- real customer destination/trustline;
- explicit approved issuance amount;
- signer custody;
- actual submission and ledger confirmation;
- asset visibility by `asset_code + issuer`;
- metadata publication/explorer visibility.

## No mutation in this implementation

This branch does not:

- use the reserved Shared Issuer candidate for a transaction;
- configure a Stellar account;
- create a trustline;
- sign or submit any transaction;
- issue any asset;
- touch RYLO;
- modify Mainnet;
- merge PR #19;
- change Full-stack database schema, APIs, or UI.
