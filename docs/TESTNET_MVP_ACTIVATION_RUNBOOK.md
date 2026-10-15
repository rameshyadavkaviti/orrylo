# ORRYLO Testnet MVP Live Activation Runbook

Status: **Readiness package only — no live activation authorized**

Reviewed baseline: `main` at
`085106d1697bbb14dca8ec10dc29c8ab5abc5bcd`, including merged PR #56.

This runbook is for exactly one bounded customer Shared Issuer issuance on
Stellar Testnet. It does not authorize account creation/funding, key generation,
signer deployment, account mutation, trustline creation, application deployment,
transaction signing/submission, or Mainnet activity.

## 1. Runtime activation inventory

| Runtime input / binding                                        | Current state                                                                                           | Activation requirement                                                                                                                                                                                                                                                                                          |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_STELLAR_NETWORK=testnet`                          | Implemented / ready                                                                                     | Must remain exactly `testnet`.                                                                                                                                                                                                                                                                                  |
| Official Horizon authority                                     | Implemented / ready                                                                                     | Server issuance reader, preflight and submission adapter are pinned to `https://horizon-testnet.stellar.org`; not caller-overridable.                                                                                                                                                                           |
| `NEXT_PUBLIC_STELLAR_HORIZON_URL`                              | Implemented public presentation config                                                                  | If explicitly set for the activation deployment, keep it at the same official Testnet Horizon URL. The authoritative server reader does not trust this browser value.                                                                                                                                           |
| `ORRYLO_AUTH_DOMAIN`                                           | Implemented / operational config required                                                               | Exact deployed hostname; production fails if absent.                                                                                                                                                                                                                                                            |
| `DATABASE_URL`                                                 | Implemented / operational config required                                                               | Dedicated ordinary application login. It must not be superuser, schema/sensitive-object owner, or member of `orrylo_confirmation_writer`, and it must have no direct or nested `SET ROLE` path to a protected schema/table/function owner or superuser.                                                         |
| `MIGRATION_DATABASE_URL`                                       | Implemented / setup-only                                                                                | Schema-owner login. `npm run db:migrate` and `npm run db:verify` are mutating / migration-capable and require explicit authorization. `npm run db:verify:read-only` uses this credential only inside a PostgreSQL `READ ONLY` transaction. Never use it as application or confirmation-writer runtime identity. |
| `ORRYLO_CONFIRMATION_WRITER_DATABASE_URL` | Implemented in PR #57 runtime composition / operational credential still owner-gated | Dedicated LOGIN member of the NOLOGIN `orrylo_confirmation_writer` role; non-superuser and non-owner, with no direct or nested `SET ROLE` path to a protected schema/table/function owner or superuser. The implemented runtime passes this separate connection to `createServerSharedIssuanceOrchestrator`; no live credential or deployment is implied. |
| `ORRYLO_APPROVED_TESTNET_SHARED_ISSUER_PUBLIC_KEY`             | Reservation/immutable-intent path already consumes it                                                   | Owner must supply the public key of one newly generated random Testnet Shared Issuer. Never use RYLO or silently use `GBR7...ASSETS`.                                                                                                                                                                           |
| `ORRYLO_TESTNET_SHARED_ISSUER_FEE_STROOPS`                     | Read-only verifier config; orchestrator already accepts `feeStroops` as an injected runtime value       | Operational value must be a positive integer and at least the stable observed Testnet base fee. No arbitrary extra fee policy is introduced here.                                                                                                                                                               |
| Shared Issuer account state                                    | Code exists / live configuration missing                                                                | Account must exist on Testnet with AUTH_REQUIRED/OFF, AUTH_REVOCABLE/OFF, AUTH_CLAWBACK/OFF, AUTH_IMMUTABLE/OFF, Master weight 1, thresholds 1/1/1 and exactly the expected Master signer.                                                                                                                      |
| Shared Issuer native XLM                                       | Code exists / live funding missing                                                                      | Preflight computes spendable XLM after Stellar reserve and selling liabilities; it must cover the configured transaction fee.                                                                                                                                                                                   |
| Customer destination                                           | Owner/live choice required                                                                              | Must be the authenticated Albedo owner wallet and an existing funded Testnet account.                                                                                                                                                                                                                           |
| Exact customer trustline                                       | Code exists / live trustline missing until owner creates it                                             | Exact `asset code + Shared Issuer` trustline must exist, be usable and have capacity for the complete immutable initial supply.                                                                                                                                                                                 |
| `SharedIssuerSigningPrimitive` | **Implemented in PR #57 / not deployed** | The approved private Railway adapter and isolated signer-service implementation exist in code. No real signer service or seed is provisioned by the repository. |
| `getServerSharedIssuanceOrchestrator()` production composition | **Implemented in PR #57 / operational configuration still owner-gated** | Runtime composition requires the exact Testnet issuer, fee, private Railway signer URL/auth secret and separate confirmation-writer connection and fails closed if any are absent/invalid. This is not deployment evidence. |
| Official one-shot submission adapter                           | Implemented / ready                                                                                     | Never retries. Ambiguous outcomes require exact-hash reconciliation.                                                                                                                                                                                                                                            |
| Authoritative confirmation validator                           | Implemented / ready                                                                                     | Uses exact-hash official Testnet Horizon evidence and the persisted signed-envelope digest.                                                                                                                                                                                                                     |
| Confirmation writer                                            | Implemented boundary / operational credential missing                                                   | Dedicated writer login is required; ordinary app authority cannot create confirmation evidence.                                                                                                                                                                                                                 |
| Schema migrations 001–010                                      | Implemented / deployment database must prove applied                                                    | Run migrations with the schema owner and verify before activation.                                                                                                                                                                                                                                              |
| Deployment | Not authorized | Deploy only after explicit owner authorization and successful activation verification; signer implementation alone is not deployment evidence. |

`TEST_DATABASE_URL`, `ORRYLO_OFFICIAL_LAUNCH_AT`,
`NEXT_PUBLIC_FOUNDATION_CONTRACT_ID`, and the Soroban RPC configuration are
not inputs to this one Shared Issuer issuance execution path.

## 2. Approved bounded Testnet signer/custody decision

The owner approved **Option A — one dedicated private Railway Testnet signer service**
for this bounded MVP. PR #57 implements that architecture in code. This section
describes the approved Testnet implementation boundary; it is not evidence that
the signer is deployed, that a real seed exists, or that any transaction has
been signed/submitted.

### Approved Option A — dedicated private Railway signer service

Architecture: a second minimal service in the same Railway environment, with no
public domain. The web application sends only the already-authorized transaction
hash and unsigned Testnet XDR over Railway private networking. The signer service
independently pins Testnet, the one approved non-RYLO issuer public key, and the
exact transaction hash before returning one signed envelope.

Secret location: a service-scoped Railway secret variable available only to the
signer service. Never expose it to the web application service, database,
browser, logs, GitHub, or chat.

Trust boundary: Railway control plane + isolated signer process. The application
has network access to request signatures but not access to the seed. A separate
request-authentication token protects the private endpoint; that token is not a
Stellar signing secret.

Deployment requirements: one extra private Railway service, no public domain,
service-scoped seed and request-auth variables, private DNS URL in the web
service, strict structured logging with no XDR/secret dumping, and a tiny HTTP
client implementing `SharedIssuerSigningPrimitive`.

Operational risk: compromise of the signer service can use the bounded Testnet
key; Railway operators/control-plane access are in the custody trust boundary.
This is intentionally **not** a Mainnet recommendation.

Cost/complexity: lowest operational complexity for the current prototype hosting
baseline; one small extra service.

Implemented current state: PR #57 contains the narrow private-HTTP
`SharedIssuerSigningPrimitive` adapter, isolated signer-service implementation,
tests, and explicit fail-closed env-based runtime composition. These are code
artifacts only; no signer service, secret, issuer, deployment, signing or
submission is live. Canonical/durable/signature/submission policy remains
unchanged.

### Scope boundary

This approved private Railway service is for the bounded Testnet MVP only.
Google Cloud KMS, Vault, Mainnet custody/multisig and the broader RYLO signer
architecture are not selected or changed by this decision. Real service
deployment, real secret provisioning, exact issuer creation/funding/configuration
and real signing/submission remain separately owner-gated live actions.

## 3. Read-only activation verifier

After the owner has performed the separately authorized account/funding/trustline
steps, configure only public identifiers and database credentials locally or in
the deployment environment. Never place a seed in these variables.

```sh
cd web

export NEXT_PUBLIC_STELLAR_NETWORK=testnet
export NEXT_PUBLIC_STELLAR_HORIZON_URL=https://horizon-testnet.stellar.org
export ORRYLO_APPROVED_TESTNET_SHARED_ISSUER_PUBLIC_KEY='G...'
export ORRYLO_TESTNET_SHARED_ISSUER_FEE_STROOPS='...'
export MIGRATION_DATABASE_URL='postgres://MIGRATION_OWNER:...'
export DATABASE_URL='postgres://APPLICATION_LOGIN:...'
export ORRYLO_CONFIRMATION_WRITER_DATABASE_URL='postgres://CONFIRMATION_LOGIN:...'

npm run db:verify:read-only

npm run activation:verify:testnet -- \
  --destination 'G_CUSTOMER...' \
  --asset-code 'CODE' \
  --amount '100.0000000'
```

Both commands in this section are repeatable and read-only. The schema verifier
checks exact migration names/checksums and required schema/security catalog
invariants inside a PostgreSQL `READ ONLY` transaction; it never invokes the
migration helper or applies/reconciles migrations. A successful activation
report proves the fixed
official Testnet Horizon is reachable; the exact issuer exists and matches the
approved flags/signer/threshold policy; the issuer sequence and spendable native
balance were read from one stable ledger checkpoint; configured fee is not below
that checkpoint's base fee; the issuer is neither known RYLO nor the reserved
Shared Issuer candidate; the exact customer account and trustline exist; the
trustline is authorized/usable and can receive the entire amount; and the
application/confirmation database identities satisfy the split-authority
boundary. Both database identities are inspected inside explicit PostgreSQL
`READ ONLY` transactions. Catalog-derived protected schema/table/function
owners and superusers must not be usable through inherited authority,
reachable through PostgreSQL `SET ROLE`, or administrable through a role
membership. Direct and indirect `SET TRUE` paths remain unsafe regardless of
`NOINHERIT`.

It deliberately does **not** request a signature or test the signer service.

## 4. First real issuance chronological runbook

| #   | Category                                               | Action                                                                                                                                                                                                                                                                                                                                                                                                                                      | Required evidence                                                                                                                                                                   |
| --- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | OWNER MANUAL LIVE ACTION                               | Generate one new random Stellar Testnet Shared Issuer keypair entirely outside GitHub/chat and outside the application process. Do not reuse any RYLO key or the reserved Shared Issuer candidate.                                                                                                                                                                                                                                          | Public `G...` address recorded in the private activation record; evidence that the seed was retained only in the chosen secure custody location. Never record the seed itself.      |
| 2   | OWNER MANUAL LIVE ACTION                               | Fund that issuer on Testnet.                                                                                                                                                                                                                                                                                                                                                                                                                | Official Horizon account URL/JSON or explorer evidence showing the exact public key exists and its XLM balance.                                                                     |
| 3   | OWNER MANUAL LIVE ACTION                               | Configure issuer flags exactly OFF/OFF/OFF/OFF and Master/threshold policy exactly weight 1 + 1/1/1.                                                                                                                                                                                                                                                                                                                                        | Official Horizon account evidence showing all four flags, thresholds and signer set.                                                                                                |
| 4   | SAFE READ-ONLY                                         | Independently inspect the issuer using official Testnet Horizon before any app configuration.                                                                                                                                                                                                                                                                                                                                               | Timestamp, ledger checkpoint, exact issuer public key, flags, signer set, thresholds, sequence and XLM balance.                                                                     |
| 5   | OWNER MANUAL LIVE ACTION                               | Provision the separately approved signer/custody implementation with this Testnet key only.                                                                                                                                                                                                                                                                                                                                                 | Signer service identity/version, public-key fingerprint, deployment scope and proof the web application does not receive the seed. No secret values in evidence.                    |
| 6   | OWNER MANUAL LIVE ACTION                               | Provision the ordinary application DB login and a distinct dedicated confirmation-writer LOGIN that is a member of `orrylo_confirmation_writer`; retain schema-owner credentials separately.                                                                                                                                                                                                                                                | Role names, non-superuser/non-owner evidence, grants/membership output with passwords redacted.                                                                                     |
| 7   | AUTOMATED LIVE ACTION requiring explicit authorization | Run `npm run db:migrate` to apply migrations 001–010 using the migration/schema-owner identity **only after explicit owner/deployment authorization**. This mutates the deployment database and may create or alter schema objects, roles and grants.                                                                                                                                                                                       | Migration command output/checksums, exact code HEAD and deployment database identifier, with credentials redacted.                                                                  |
| 8   | OWNER MANUAL LIVE ACTION                               | Choose the customer Albedo Testnet wallet. If funding is needed, the owner/customer funds it manually.                                                                                                                                                                                                                                                                                                                                      | Customer public `G...` address and official Horizon evidence that the account exists.                                                                                               |
| 9   | OWNER MANUAL LIVE ACTION                               | Customer manually creates the exact trustline for the intended asset code + exact new Shared Issuer with a limit covering the complete initial supply.                                                                                                                                                                                                                                                                                      | Exact asset code, issuer, destination, trustline limit/balance/authorization from official Horizon.                                                                                 |
| 10  | SAFE READ-ONLY                                         | Run `npm run db:verify:read-only` to inspect exact migration checksums and schema/security invariants without applying/reconciling migrations or changing grants. Then run `npm run activation:verify:testnet` with the exact issuer, destination, asset code, amount and fee. Never run a migration-capable compatibility verifier in this phase. Repeat only the non-mutating inspection if the stable-ledger check races a ledger close. | Read-only schema verification output, read-only role-verifier result, and full activation-verifier JSON with `ok: true`; public identifiers only.                                   |
| 11  | OWNER MANUAL LIVE ACTION                               | Explicitly approve activation of the signer adapter/runtime composition and application deployment for this one bounded Testnet issuance.                                                                                                                                                                                                                                                                                                   | Written approval referencing exact code HEAD, issuer public key, destination, asset code, amount, fee, signer implementation and deployment target.                                 |
| 12  | AUTOMATED LIVE ACTION requiring explicit authorization | Deploy/configure the application and signer only after step 11. The runtime must use the ordinary app DB credential, distinct confirmation-writer credential, exact issuer/fee, fixed official Horizon and approved signer primitive.                                                                                                                                                                                                       | Deployment IDs/commit SHA, redacted config-key names, signer public-key consistency result, health evidence. Never capture secret values.                                           |
| 13  | SAFE READ-ONLY                                         | Run the activation verifier again against the deployed configuration immediately before issuance.                                                                                                                                                                                                                                                                                                                                           | Fresh `ok: true` verifier evidence and stable ledger checkpoint.                                                                                                                    |
| 14  | AUTOMATED LIVE ACTION requiring explicit authorization | Authenticate with the selected Albedo wallet, enter/review the exact token details and invoke Create Token once.                                                                                                                                                                                                                                                                                                                            | Issuance request ID, project ID, owner public key, immutable intent fingerprint, exact amount/code/issuer/network.                                                                  |
| 15  | AUTOMATED LIVE ACTION requiring explicit authorization | Existing orchestration persists attempt 1, invokes the approved signer once, persists signed-envelope digest, and performs one Horizon submission. **Never manually retry or create attempt 2.**                                                                                                                                                                                                                                            | Attempt ID/number 1, transaction hash, unsigned-envelope digest, signed-envelope digest, source sequence, fee, timebounds, operation identity and submission/reconciliation status. |
| 16  | VERIFICATION/EVIDENCE                                  | Look up the exact transaction hash through official Testnet Horizon. If submission was ambiguous, reconcile this exact hash only.                                                                                                                                                                                                                                                                                                           | Official Horizon transaction record, ledger, successful flag, envelope/result XDR hashes and observation checkpoint.                                                                |
| 17  | VERIFICATION/EVIDENCE                                  | Verify the dedicated writer persisted the authoritative confirmation and that the ordinary app identity still lacks confirmation authority.                                                                                                                                                                                                                                                                                                 | Confirmation ID, intent/attempt/hash binding, verifier identity/policy version, DB role evidence.                                                                                   |
| 18  | VERIFICATION/EVIDENCE                                  | Verify the application transitions to Confirmed only from the persisted authoritative evidence and displays the exact transaction/explorer evidence truthfully.                                                                                                                                                                                                                                                                             | UI screenshot/recording with exact transaction hash, project/asset identity and confirmed state, cross-checked against Horizon and DB.                                              |
| 19  | VERIFICATION/EVIDENCE                                  | Stop. Do not issue another token as part of this milestone.                                                                                                                                                                                                                                                                                                                                                                                 | Final evidence bundle and explicit record that there was one attempt and no retry/replacement.                                                                                      |

**Ambiguity rule:** any timeout, non-2xx submission response, malformed response,
process interruption after signed provenance, or uncertainty about whether the
transaction reached Horizon is potentially successful. Stop all signing and
submission activity and reconcile only the already-persisted exact hash.

## 4.1 Bounded owner-local manual signing bridge

For the first Testnet issuance only, the repository also provides an
operator-local handoff path that preserves the same immutable attempt,
signature validation, signed-envelope provenance, one-shot submission and
exact-hash reconciliation guarantees as the private signer path.

This is **not** a browser API, generic XDR-signing endpoint, replacement signer
architecture, or Mainnet facility. It never loads a Stellar secret key. The
owner's Stellar CLI identity remains entirely in the local Stellar secure store.

After the normal application flow has created the immutable full issuance
intent, run the existing read-only checks, then prepare attempt 1:

```sh
cd web

npm run db:verify:read-only

npm run activation:verify:testnet -- \
  --destination "$CUSTOMER" \
  --asset-code "$ASSET_CODE" \
  --amount "$INITIAL_SUPPLY"

npm run issuance:manual:testnet -- prepare \
  --request-id "$REQUEST_ID" \
  --project-id "$PROJECT_ID" \
  --owner "$CUSTOMER" \
  --unsigned-xdr-file ./orrylo-attempt-1-unsigned.xdr
```

The prepare command persists/reloads **attempt 1 only**, rechecks the official
Testnet preflight, verifies the reconstructed unsigned envelope against durable
intent/attempt evidence, writes the non-secret exact XDR to the requested local
file, and stops before any signing or submission.

Sign that exact file locally through the owner's secure-store identity:

```sh
stellar tx sign \
  --network testnet \
  --sign-with-key orrylo-mvp-testnet-shared-issuer \
  ./orrylo-attempt-1-unsigned.xdr \
  > ./orrylo-attempt-1-signed.xdr
```

The Stellar CLI accepts a base64 transaction-envelope XDR file as the
`stellar tx sign` input and appends the selected local identity's signature.
No seed export is required.

Return the signed file through the local operator command:

```sh
npm run issuance:manual:testnet -- submit \
  --request-id "$REQUEST_ID" \
  --project-id "$PROJECT_ID" \
  --owner "$CUSTOMER" \
  --signed-xdr-file ./orrylo-attempt-1-signed.xdr
```

Before Horizon submission, Orrylo independently reconstructs the current exact
attempt, requires the unchanged Testnet issuer/source, transaction hash,
one-payment operation, asset, destination, amount, sequence, fee and time
bounds, validates the approved issuer signature, and persists the decorated
signed-envelope SHA-256 digest. Only then may the existing official-Horizon
one-shot submission adapter run.

If the command returns `confirming` or `reconciliation_required`, never run
`submit` again. The signed-envelope path is consumed once and every second
signed-envelope attempt is rejected. Reconcile the same exact transaction hash
only:

```sh
npm run issuance:manual:testnet -- reconcile \
  --request-id "$REQUEST_ID" \
  --project-id "$PROJECT_ID" \
  --owner "$CUSTOMER"
```

The manual transaction keeps the existing 300-second validity window. If the
persisted unsigned attempt expires before its first valid signed envelope is
accepted, this bridge fails closed: it does not rebuild, re-sign, create
attempt 2, or silently replace the transaction.

## 5. Dry-run proof already present on current main

The merged deterministic suites already prove the production-shaped control
flow without live mutation:

- missing trustline fails before attempt/signing;
- signer failure creates zero submit calls;
- submission uncertainty causes one submission only and replay reconciles the
  existing exact hash;
- an existing attempt is never resubmitted and attempt 2 is never created;
- RYLO issuer identities fail before signer/digest/submission;
- exact-hash authoritative ledger validation rejects forged/mismatched evidence;
- confirmation requires the signed-envelope digest and exact immutable
  intent/attempt;
- ordinary application DB identities are rejected at the trusted confirmation
  boundary, while the dedicated writer role is independently verified;
- browser/API status cannot manufacture a confirmed issuance.

This readiness package adds deterministic tests for the read-only activation
verifier itself: valid non-RYLO readiness, all known RYLO identities, reserved
Shared Issuer candidate, missing/capacity-insufficient trustline and database
boundary failure. PostgreSQL regressions additionally cover the normal
application login, bounded confirmation writer, harmless memberships, direct
`NOINHERIT` + `SET TRUE` owner escalation, writer escalation, nested `SET TRUE`
owner escalation, and database-enforced read-only inspection.

## 6. Residual classification

### LIVE-ACTIVATION BLOCKER

- The bounded Testnet signer technology decision is resolved and PR #57
  implements the private Railway signer adapter/service and runtime composition
  in code.
- Remaining owner live actions include creating/funding/configuring the new
  Testnet issuer, provisioning/deploying the real private signer service and its
  service-scoped secret material, selecting/funding the customer wallet if
  needed, and creating the exact trustline.
- Operational: create least-privilege application and confirmation-writer DB
  logins; after explicit owner/deployment authorization, apply migrations with
  the migration/schema-owner identity; then separately perform read-only schema
  and authority verification and pass the activation verifier before deployment
  and the one issuance.

### POST-MVP

- Crash after `pending_execution` before attempt persistence can strand the
  lifecycle.
- Authoritative Horizon `failed` currently remains `confirming`.

These two already-approved post-MVP issues are intentionally untouched here.

### MAINNET / PRODUCTION ONLY

- Mainnet account identities/custody/multisig and all Mainnet activation.
- Broad-public abuse/rate-limit infrastructure and final production hardening.
- RYLO execution, rewards/mints/liquidity and Dedicated Issuer workflows.

## 7. Activation readiness statement

The bounded Testnet signer/custody technology is owner-approved and PR #57
implements the private Railway signer architecture plus fail-closed runtime
composition in code. The repository is **not yet evidence of a live Testnet
issuance**: no real signer service or seed, issuer account/funding/configuration,
customer trustline, application deployment, signing or submission is established
by this implementation. Those remain separately owner-gated live actions.
Mainnet signer/custody decisions and the broader RYLO signer architecture remain
unchanged.
