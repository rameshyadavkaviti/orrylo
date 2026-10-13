# ORRYLO Testnet MVP Live Activation Runbook

Status: **Readiness package only — no live activation authorized**

Reviewed baseline: `main` at
`d503feb7412b329773fbe6f59b78951f730eb219`, including merged PR #55.

This runbook is for exactly one bounded customer Shared Issuer issuance on
Stellar Testnet. It does not authorize account creation/funding, key generation,
signer deployment, account mutation, trustline creation, application deployment,
transaction signing/submission, or Mainnet activity.

## 1. Runtime activation inventory

| Runtime input / binding | Current state | Activation requirement |
| --- | --- | --- |
| `NEXT_PUBLIC_STELLAR_NETWORK=testnet` | Implemented / ready | Must remain exactly `testnet`. |
| Official Horizon authority | Implemented / ready | Server issuance reader, preflight and submission adapter are pinned to `https://horizon-testnet.stellar.org`; not caller-overridable. |
| `NEXT_PUBLIC_STELLAR_HORIZON_URL` | Implemented public presentation config | If explicitly set for the activation deployment, keep it at the same official Testnet Horizon URL. The authoritative server reader does not trust this browser value. |
| `ORRYLO_AUTH_DOMAIN` | Implemented / operational config required | Exact deployed hostname; production fails if absent. |
| `DATABASE_URL` | Implemented / operational config required | Dedicated ordinary application login. It must not be superuser, schema/sensitive-table owner, or member of `orrylo_confirmation_writer`. |
| `MIGRATION_DATABASE_URL` | Implemented / setup-only | Schema-owner login used only for `db:migrate` / `db:verify`; never use as application or confirmation-writer runtime identity. |
| `ORRYLO_CONFIRMATION_WRITER_DATABASE_URL` | Verifier config added by this package; runtime composition already accepts a separate writer connection | Dedicated LOGIN member of the NOLOGIN `orrylo_confirmation_writer` role; non-superuser and non-owner. Final signer/runtime wiring must pass this connection to `createServerSharedIssuanceOrchestrator`. |
| `ORRYLO_APPROVED_TESTNET_SHARED_ISSUER_PUBLIC_KEY` | Reservation/immutable-intent path already consumes it | Owner must supply the public key of one newly generated random Testnet Shared Issuer. Never use RYLO or silently use `GBR7...ASSETS`. |
| `ORRYLO_TESTNET_SHARED_ISSUER_FEE_STROOPS` | Read-only verifier config; orchestrator already accepts `feeStroops` as an injected runtime value | Operational value must be a positive integer and at least the stable observed Testnet base fee. No arbitrary extra fee policy is introduced here. |
| Shared Issuer account state | Code exists / live configuration missing | Account must exist on Testnet with AUTH_REQUIRED/OFF, AUTH_REVOCABLE/OFF, AUTH_CLAWBACK/OFF, AUTH_IMMUTABLE/OFF, Master weight 1, thresholds 1/1/1 and exactly the expected Master signer. |
| Shared Issuer native XLM | Code exists / live funding missing | Preflight computes spendable XLM after Stellar reserve and selling liabilities; it must cover the configured transaction fee. |
| Customer destination | Owner/live choice required | Must be the authenticated Albedo owner wallet and an existing funded Testnet account. |
| Exact customer trustline | Code exists / live trustline missing until owner creates it | Exact `asset code + Shared Issuer` trustline must exist, be usable and have capacity for the complete immutable initial supply. |
| `SharedIssuerSigningPrimitive` | **Actual activation code/ops gap** | Interface and fail-closed policy exist, but no operational signer backend is installed. Concrete custody/deployment technology requires owner approval. |
| `getServerSharedIssuanceOrchestrator()` production composition | **Actual activation code gap gated by signer decision** | Currently intentionally throws `issuer_integration_unavailable`. After signer technology is approved, wire only that primitive plus issuer/fee/writer config into the existing `createServerSharedIssuanceOrchestrator`. |
| Official one-shot submission adapter | Implemented / ready | Never retries. Ambiguous outcomes require exact-hash reconciliation. |
| Authoritative confirmation validator | Implemented / ready | Uses exact-hash official Testnet Horizon evidence and the persisted signed-envelope digest. |
| Confirmation writer | Implemented boundary / operational credential missing | Dedicated writer login is required; ordinary app authority cannot create confirmation evidence. |
| Schema migrations 001–010 | Implemented / deployment database must prove applied | Run migrations with the schema owner and verify before activation. |
| Deployment | Not authorized | Deploy only after explicit owner authorization and signer decision. |

`TEST_DATABASE_URL`, `ORRYLO_OFFICIAL_LAUNCH_AT`,
`NEXT_PUBLIC_FOUNDATION_CONTRACT_ID`, and the Soroban RPC configuration are
not inputs to this one Shared Issuer issuance execution path.

## 2. Signer/custody decision package

The signer technology remains an owner decision. Do not implement one merely by
choosing a provider in code.

### Option A — dedicated private Railway signer service (**recommended for this bounded Testnet MVP**)

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
request-authentication token should protect the private endpoint; that token is
not a Stellar signing secret.

Deployment requirements: one extra private Railway service, no public domain,
service-scoped seed and request-auth variables, private DNS URL in the web
service, strict structured logging with no XDR/secret dumping, and a tiny HTTP
client implementing `SharedIssuerSigningPrimitive`.

Operational risk: compromise of the signer service can use the bounded Testnet
key; Railway operators/control-plane access are in the custody trust boundary.
This is intentionally **not** a Mainnet recommendation.

Cost/complexity: lowest operational complexity for the current prototype hosting
baseline; one small extra service.

Integration change after owner approval: add one narrow private-HTTP
`SharedIssuerSigningPrimitive` adapter plus signer-service implementation and
tests, then replace the current fail-closed runtime stub with explicit env-based
composition. Do not change canonical/durable/signature/submission policy.

### Option B — Google Cloud KMS Ed25519

Architecture: create an asymmetric `EC_SIGN_ED25519` KMS key and have a narrow
signer adapter attach the returned Ed25519 signature to the exact canonical
Stellar envelope. Google Cloud KMS supports PureEdDSA Ed25519 signing of raw
data.

Secret location: non-exportable KMS key material held by Google Cloud KMS.

Trust boundary: Google Cloud KMS/IAM and the principal allowed to call the sign
operation. For stronger separation, give signing IAM only to a small signer
service rather than the public application process.

Deployment requirements: Google Cloud project, KMS key ring/key, IAM/service
identity, public-key-to-Stellar-address derivation/verification, and an adapter
that signs the exact Stellar transaction hash and constructs the decorated
signature.

Operational risk: IAM misconfiguration can broaden sign authority; integration
is more complex than the bounded Railway service and the issuer account must be
created from the KMS public key.

Cost/complexity: low transaction volume cost but medium setup/integration
complexity.

Integration change after owner approval: KMS-specific
`SharedIssuerSigningPrimitive`, public-key consistency check, IAM setup and
deterministic tests. No seed is imported into Orrylo.

### Option C — HashiCorp Vault Transit Ed25519

Architecture: an isolated Vault Transit `ed25519` key signs the exact
authorized input; a narrow adapter attaches the signature to the canonical
envelope.

Secret location: Vault Transit key storage; Orrylo receives signatures, not the
private key.

Trust boundary: Vault deployment/operators, Transit policy and client token.

Deployment requirements: a separately operated Vault/HCP Vault instance,
Transit key/policy, authentication and rotation/backup operations, and a
`SharedIssuerSigningPrimitive` adapter.

Operational risk: materially more infrastructure and recovery/availability
surface than needed for one Testnet issuance.

Cost/complexity: highest of these three for the bounded MVP.

**Recommendation:** approve Option A only for the first bounded Testnet
demonstration. It matches the already-selected Railway prototype environment,
keeps the seed out of the application process, and requires the least new
infrastructure. Re-evaluate custody independently before any Mainnet work.

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
export DATABASE_URL='postgres://APPLICATION_LOGIN:...'
export ORRYLO_CONFIRMATION_WRITER_DATABASE_URL='postgres://CONFIRMATION_LOGIN:...'

npm run activation:verify:testnet -- \
  --destination 'G_CUSTOMER...' \
  --asset-code 'CODE' \
  --amount '100.0000000'
```

The verifier is repeatable and read-only. A successful report proves the fixed
official Testnet Horizon is reachable; the exact issuer exists and matches the
approved flags/signer/threshold policy; the issuer sequence and spendable native
balance were read from one stable ledger checkpoint; configured fee is not below
that checkpoint's base fee; the issuer is neither known RYLO nor the reserved
Shared Issuer candidate; the exact customer account and trustline exist; the
trustline is authorized/usable and can receive the entire amount; and the
application/confirmation database identities satisfy the split-authority
boundary.

It deliberately does **not** request a signature or test the signer service.

## 4. First real issuance chronological runbook

| # | Category | Action | Required evidence |
| --- | --- | --- | --- |
| 1 | OWNER MANUAL LIVE ACTION | Generate one new random Stellar Testnet Shared Issuer keypair entirely outside GitHub/chat and outside the application process. Do not reuse any RYLO key or the reserved Shared Issuer candidate. | Public `G...` address recorded in the private activation record; evidence that the seed was retained only in the chosen secure custody location. Never record the seed itself. |
| 2 | OWNER MANUAL LIVE ACTION | Fund that issuer on Testnet. | Official Horizon account URL/JSON or explorer evidence showing the exact public key exists and its XLM balance. |
| 3 | OWNER MANUAL LIVE ACTION | Configure issuer flags exactly OFF/OFF/OFF/OFF and Master/threshold policy exactly weight 1 + 1/1/1. | Official Horizon account evidence showing all four flags, thresholds and signer set. |
| 4 | SAFE READ-ONLY | Independently inspect the issuer using official Testnet Horizon before any app configuration. | Timestamp, ledger checkpoint, exact issuer public key, flags, signer set, thresholds, sequence and XLM balance. |
| 5 | OWNER MANUAL LIVE ACTION | Provision the separately approved signer/custody implementation with this Testnet key only. | Signer service identity/version, public-key fingerprint, deployment scope and proof the web application does not receive the seed. No secret values in evidence. |
| 6 | OWNER MANUAL LIVE ACTION | Provision the ordinary application DB login and a distinct dedicated confirmation-writer LOGIN that is a member of `orrylo_confirmation_writer`; retain schema-owner credentials separately. | Role names, non-superuser/non-owner evidence, grants/membership output with passwords redacted. |
| 7 | SAFE READ-ONLY | Apply/verify migrations 001–010 using the migration identity, then verify application/writer boundaries. | Migration output/checksums, schema verification output, read-only role-verifier result. |
| 8 | OWNER MANUAL LIVE ACTION | Choose the customer Albedo Testnet wallet. If funding is needed, the owner/customer funds it manually. | Customer public `G...` address and official Horizon evidence that the account exists. |
| 9 | OWNER MANUAL LIVE ACTION | Customer manually creates the exact trustline for the intended asset code + exact new Shared Issuer with a limit covering the complete initial supply. | Exact asset code, issuer, destination, trustline limit/balance/authorization from official Horizon. |
| 10 | SAFE READ-ONLY | Run `npm run activation:verify:testnet` with the exact issuer, destination, asset code, amount and fee. Repeat if the stable-ledger check races a ledger close. | Full verifier JSON result with `ok: true`; public identifiers only. |
| 11 | OWNER MANUAL LIVE ACTION | Explicitly approve activation of the signer adapter/runtime composition and application deployment for this one bounded Testnet issuance. | Written approval referencing exact code HEAD, issuer public key, destination, asset code, amount, fee, signer implementation and deployment target. |
| 12 | AUTOMATED LIVE ACTION requiring explicit authorization | Deploy/configure the application and signer only after step 11. The runtime must use the ordinary app DB credential, distinct confirmation-writer credential, exact issuer/fee, fixed official Horizon and approved signer primitive. | Deployment IDs/commit SHA, redacted config-key names, signer public-key consistency result, health evidence. Never capture secret values. |
| 13 | SAFE READ-ONLY | Run the activation verifier again against the deployed configuration immediately before issuance. | Fresh `ok: true` verifier evidence and stable ledger checkpoint. |
| 14 | AUTOMATED LIVE ACTION requiring explicit authorization | Authenticate with the selected Albedo wallet, enter/review the exact token details and invoke Create Token once. | Issuance request ID, project ID, owner public key, immutable intent fingerprint, exact amount/code/issuer/network. |
| 15 | AUTOMATED LIVE ACTION requiring explicit authorization | Existing orchestration persists attempt 1, invokes the approved signer once, persists signed-envelope digest, and performs one Horizon submission. **Never manually retry or create attempt 2.** | Attempt ID/number 1, transaction hash, unsigned-envelope digest, signed-envelope digest, source sequence, fee, timebounds, operation identity and submission/reconciliation status. |
| 16 | VERIFICATION/EVIDENCE | Look up the exact transaction hash through official Testnet Horizon. If submission was ambiguous, reconcile this exact hash only. | Official Horizon transaction record, ledger, successful flag, envelope/result XDR hashes and observation checkpoint. |
| 17 | VERIFICATION/EVIDENCE | Verify the dedicated writer persisted the authoritative confirmation and that the ordinary app identity still lacks confirmation authority. | Confirmation ID, intent/attempt/hash binding, verifier identity/policy version, DB role evidence. |
| 18 | VERIFICATION/EVIDENCE | Verify the application transitions to Confirmed only from the persisted authoritative evidence and displays the exact transaction/explorer evidence truthfully. | UI screenshot/recording with exact transaction hash, project/asset identity and confirmed state, cross-checked against Horizon and DB. |
| 19 | VERIFICATION/EVIDENCE | Stop. Do not issue another token as part of this milestone. | Final evidence bundle and explicit record that there was one attempt and no retry/replacement. |

**Ambiguity rule:** any timeout, non-2xx submission response, malformed response,
process interruption after signed provenance, or uncertainty about whether the
transaction reached Horizon is potentially successful. Stop all signing and
submission activity and reconcile only the already-persisted exact hash.

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
boundary failure.

## 6. Residual classification

### LIVE-ACTIVATION BLOCKER

- Owner decision: approve one signer/custody implementation.
- Code after that decision: implement only the selected
  `SharedIssuerSigningPrimitive` adapter and replace the intentional
  `getServerSharedIssuanceOrchestrator()` unavailable stub with explicit
  runtime composition using the approved issuer, fee and confirmation-writer
  connection.
- Owner live actions: create/fund/configure the new Testnet issuer, provision
  signer custody, select/fund the customer wallet if needed, and create the
  exact trustline.
- Operational: create least-privilege application and confirmation-writer DB
  logins, run migrations/schema verification, pass the read-only activation
  verifier, then explicitly authorize deployment and the one issuance.

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

After this readiness package, the repository is **code-ready for the next
owner decision**, but it is **not yet ready to perform a live Testnet issuance**
because signer/custody technology is still unapproved and the runtime
composition intentionally remains unavailable. Once the owner approves the
signer option and separately authorizes the required live account/trustline/
deployment actions, no new generalized Stellar execution architecture should be
needed.
