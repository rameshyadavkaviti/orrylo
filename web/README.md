# Orrylo web application

This directory contains Orrylo's application foundation, server-verified Albedo
wallet authentication, and the durable application persistence/workflow
foundation. Product and on-chain capabilities remain explicit demo/unavailable
state unless stated otherwise.

## Runtime

- Node.js: 22.x
- npm: 10.9.9
- Next.js: 16.4.0
- React: 19.3.0
- TypeScript: strict mode
- PostgreSQL: relational persistence target; no hosted provider is selected

## Local setup

Install dependencies:

```sh
cd web
cp .env.example .env.local
npm ci
```

Start a minimal local PostgreSQL 17 instance, for example:

```sh
docker run --rm --name orrylo-postgres \
  -e POSTGRES_PASSWORD=orrylo-dev \
  -e POSTGRES_DB=orrylo \
  -p 5432:5432 \
  postgres:17-alpine
```

In another shell, set server-only connection URLs. The test database name must
contain `test` because the integration suite resets its schema:

```sh
export MIGRATION_DATABASE_URL='postgres://MIGRATION_OWNER:PASSWORD@localhost:5432/orrylo'
export DATABASE_URL='postgres://APPLICATION_USER:PASSWORD@localhost:5432/orrylo'
docker exec orrylo-postgres createdb -U postgres orrylo_test
export TEST_DATABASE_URL='postgres://postgres:orrylo-dev@localhost:5432/orrylo_test'
```

Apply migrations and run the compatibility verifier:

```sh
npm run db:migrate
npm run db:verify
```

Both commands above are mutating / migration-capable. In particular,
`npm run db:verify` preserves its existing setup behavior by applying or
reconciling missing migrations before it inspects the resulting schema. Never
use either command during a SAFE READ-ONLY activation phase.

Inspect an already-migrated database without applying or reconciling migrations:

```sh
npm run db:verify:read-only
```

`npm run db:verify:read-only` is the genuinely read-only verifier. It checks the
exact migration names/checksums and required schema/security catalog invariants
inside a PostgreSQL `READ ONLY` transaction. It performs no migration SQL,
writes, DDL, or privilege changes and fails closed if the expected state is
absent or inconsistent.

Run the application:

```sh
npm run dev
```

Run all application gates:

```sh
npm run format:check
npm run lint
npm run typecheck
npm test
npm run test:db
npm run build
```

## Persistence architecture

Orrylo uses a provider-neutral PostgreSQL persistence layer configured only by
the server-side `DATABASE_URL`. No hosted database vendor is considered
selected by this repository.

Schema migrations are source-controlled under `db/migrations/`. `npm run
db:migrate` and the compatibility command `npm run db:verify` are mutating /
migration-capable. `npm run db:verify:read-only` never invokes the migration
runner and inspects the already-applied state in a database-enforced read-only
transaction. These commands require `MIGRATION_DATABASE_URL`; they do not use
the ordinary application `DATABASE_URL`. The migration identity must own the
sensitive issuance tables and enforcement functions, while runtime application
and confirmation-writer logins must not. The migration runner records SHA-256
checksums in `schema_migrations`, rejects modified already-applied migrations,
and can bootstrap a fresh database from zero.

Database-facing code is isolated under `lib/server/persistence/`. Browser UI
does not import database clients or connection strings.

## Durable wallet authentication

The Albedo proof semantics remain unchanged:

```text
POST /api/auth/challenge
→ PostgreSQL stores a 5-minute challenge
→ Albedo public_key intent signs the exact challenge
→ POST /api/auth/verify
→ atomic UPDATE consumes the unexpired challenge once
→ server verifies payload, context, public key and Ed25519 signature
→ PostgreSQL stores an 8-hour server-side session
→ HttpOnly cookie receives only the opaque raw session token
→ POST /api/auth/logout invalidates the database session
```

Challenge consumption is database-atomic, so concurrent application instances
cannot both consume the same challenge.

Session tokens are 32 random bytes. Orrylo stores only SHA-256(token) in
`auth_sessions`; the raw bearer token exists only in the HttpOnly cookie and
request memory. Sessions remain available across application process restarts
and instances that share the same database.

No Albedo implicit-flow token, callback URL, transaction intent, secret key,
issuer key, or wallet signing key is stored.

## Managed Project Profile bridge

The current public prototype requires Albedo wallet authentication before the
interactive token/project builder flow. The authenticated wallet is the
application identity and ownership boundary from the beginning of that flow:

```text
authenticated wallet session
→ token/project builder state
→ idempotent managed-project creation
→ Project Profile + owner association
→ /my-assets/<project_id>
→ optional Orrylo landing-page publication at /p/<slug>
```

The stable UUID `project_id` remains the application identity. The slug is
routing state only. Stellar metadata hosting remains separate from both.

Managed project creation revalidates builder data on the server and binds the
client-generated UUID idempotency key to the authenticated wallet and canonical
normalized payload through `workflow_intents`. Project Profile creation,
ownership association, slug allocation, and workflow confirmation occur in one
PostgreSQL transaction. Slug uniqueness is database-enforced; deterministic
collision candidates use `<base>-2`, `<base>-3`, and so on.

Newly saved projects are private `draft` profiles. An owner-only publish action
may expose the Orrylo landing page at `/p/<slug>`; this does not publish
`stellar.toml`, issue a Stellar asset, or perform any Stellar transaction.

Builder logo images remain browser-local. No object URL or data URL is persisted
as durable project media.

Production wallet authentication requires an explicit `ORRYLO_AUTH_DOMAIN`
matching the hostname users actually visit. Production no longer silently falls
back to `localhost`; a missing value is a deployment misconfiguration. The
current public hostname must be updated when Orrylo moves from a temporary
Railway hostname to the canonical custom domain.

## Managed metadata publication readiness

Managed Project Profiles now expose an owner-only metadata configuration step
for the existing presentation fields: display name, description, durable logo
URL, website URL, and one generic community/project link. The server derives
the owner exclusively from the authenticated session and updates by stable
`project_id`; asset code, slug, issuer model/network, metadata host, issuer
public key, and publication status are not editable through this boundary.

URL-bearing metadata accepts only normalized `https:` URLs without embedded
credentials. Browser-local `data:` / `blob:` image references, `file:`,
`javascript:`, and plain HTTP URLs are rejected and are also filtered from the
public landing-page renderer as defense in depth. No media-storage provider is
introduced.

The application can deterministically generate an application-side
`[[CURRENCIES]]` stellar.toml preview from Project Profile data. It includes
`code`, `name`, optional `desc`, a checksum-valid issuer only when one is
actually stored, and `image` only for a durable HTTPS image URL.

Readiness deliberately keeps these states separate:

```text
Project metadata configured
TOML generatable/generated locally
TOML published = no
TOML reachable = no
Explorer visibility = unverified
SAC visibility = unverified/not applicable
Public landing-page publication = separate state
Stellar asset creation = separate state
```

Shared Issuer readiness continues to use the canonical
`assets.orrylo.com` metadata-home context. Real publication additionally
requires independently authenticated, immutable ledger confirmation matching
the exact project owner, Testnet network/passphrase, asset code, configured
issuer, destination, amount, full issuance-intent fingerprint, transaction
hash, successful result, source identities, operation set, sequence, and
ledger. A checksum-valid issuer, mutable Project Profile value, reservation
audit, or database status is never sufficient. The production confirmation
reader is intentionally unavailable in this branch, so publication fails
closed. The reserved Shared Issuer candidate is not selected or assigned by
this metadata slice. Dedicated Issuer metadata remains future-facing when no
real issuer or host exists.

## Workflow and idempotency foundation

`workflow_intents` provides an inactive generic workflow record with:

- request ID, scope/type, optional wallet subject and policy version;
- states from `created` through future `approved/signed/submitted/confirmed`
  plus failed/cancelled terminal states;
- idempotency key and canonical payload hash;
- timestamps, retry count, failure code and external/on-chain reference
  placeholders.

A database unique constraint on `(workflow_scope, idempotency_key)` makes
concurrent duplicate creation resolve to one logical intent. Reuse of the same
key with a different canonical request fingerprint fails explicitly.

No workflow currently signs, submits, mints, authorizes, or moves value.

## Audit foundation

`audit_events` is an application append-only evidence chain. Appends serialize
through a locked chain-head row, include the previous event hash, and compute a
deterministic SHA-256 event hash over canonical JSON. A database trigger rejects
normal UPDATE/DELETE of prior audit events.

Audit metadata rejects sensitive-key names such as secret, seed, session token,
signature, private key, credential, and password, and is size-bounded.

This is tamper-evident application evidence; it is **not** described as
tamper-proof storage against a database superuser.

## Trusted eligibility and reward preparation

The server-only `EligibilityRewardService` accepts a future trusted
`TOKEN_CREATION_SUCCEEDED` event. It is not exposed through a public browser or
API mutation route, and it does not decide whether token creation succeeded.
That authoritative evidence boundary remains reserved for a reviewed
server-side token-creation integration.

Within one PostgreSQL transaction, the service:

- validates and canonicalizes the Stellar wallet StrKey;
- stores and fingerprints the qualifying event for idempotent replay;
- establishes first-token eligibility once per wallet;
- evaluates the trusted qualifying event's `eventOccurredAt` against the
  server-only `ORRYLO_OFFICIAL_LAUNCH_AT` configuration using a half-open
  60-day interval;
- approves exactly `150.0000000` RYLO when the event is in the launch window;
- creates/reuses one reward workflow and one inactive future mint protected
  operation;
- appends qualifying-event, eligibility, reward, and intent evidence to the
  audit chain.

Missing launch configuration returns `launch_not_configured` without blocking
eligibility. Invalid launch configuration fails before database mutation. The
official timestamp is intentionally unset and is not selected by this
repository phase.

The event that first establishes eligibility records the reward decision.
Later token-creation events reuse that decision: they cannot turn a skipped
first creation into a new launch reward. Already-approved rewards retain their
original evidence and intents, including after the reward window closes;
terminal workflow states are preserved.

The persistence schema also retains inactive foundations for:

- other eligibility and reward types;
- protected authorization, treasury-transfer, and liquidity workflows.

No workflow signs, submits, mints, authorizes, confirms, or moves value.

## Public prototype presentation

The primary application shell is customer-facing rather than an engineering
status dashboard. The homepage leads with wallet authentication and token
creation, then provides direct paths to Products & Services and RYLO. The current
public token builder requires an authenticated Albedo wallet before interactive
configuration. Authenticated users can configure asset code, display name,
description, a browser-local logo preview, Shared Issuer infrastructure context,
and metadata-domain presentation. The live preview stops at one explicit
execution boundary and never presents the configuration as an on-chain asset.

RYLO presentation reflects the approved membership, 50 RYLO-equivalent Free
Build Credit, 150 RYLO launch reward, 60-day reward-window, supply, and direct
sale policies while clearly separating policy from live execution. Unimplemented
Products & Services are labeled Coming soon. Activity and Settings remain
secondary utility/diagnostic routes rather than primary customer navigation.

## Current data boundary

Wallet authentication and its database state are real application behavior.
Managed Project Profile creation, wallet ownership association, owner-scoped
management reads/metadata edits, application-side metadata readiness/TOML
preview generation, Orrylo landing-page publication, and the durable Shared
Issuer TOML publication/verification foundation are real application behavior.
Public project lookup reads the same persisted Project Profile only after its
`public_status` is `published`. Metadata publication remains fail-closed
until the reviewed issuance boundary supplies ledger-confirmed provenance for
the exact asset identity. Canonical domain routing/reachability and explorer
verification remain deployment/integration gates.

Trusted first-token eligibility/reward preparation is real server-only database
behavior, but it has no event producer or public mutation route. Stellar asset
issuance, TOML publication, persistent project-media hosting, balances,
eligibility UI, RYLO holdings, activity, reward execution, protected operation
execution, and on-chain transaction state remain demo/unavailable unless a
future reviewed phase explicitly activates them.

## Contract boundary

The application compatibility abstraction still supports Contract Interface v1
only:

- `interface_version() -> u32`
- `version() -> u32`
- `state() -> Result<FoundationState, Error>`

No live contract ID is committed and no contract mutation is implemented.

## Testnet issuance and confirmation Gate A (code only)

The merged PR #31 integration supersedes the isolated implementation work in PR
#19 and PR #28 without rewriting either branch. It prepares an authenticated, owner-scoped
application reservation for **Testnet Shared Issuer** projects. A request is
durable, project-unique, and idempotent in PostgreSQL. The shared asset code is
reserved once per approved issuer identity.
The initial state is `awaiting_issuer_integration`; neither the request nor
the project's saved profile is a Stellar-issued asset.

The issuance status is read from `project_issuance_intents` and presented on
the managed project page. The read-only UI does **not** enable token issuance.
The database contract and Gate A repositories separate the reservation from an
immutable full issuance intent, append-only transaction attempts, and an
immutable ledger confirmation. Exact replay is idempotent; conflicting replay
fails closed. A transaction attempt permits one immutable transition that
records the decorated signed-envelope SHA-256 digest after signature validation
and before submission. The confirmation binds the request and full-intent fingerprint
to the exact Testnet passphrase hash, envelope/result hashes, successful result,
transaction and operation sources, single payment operation, configured issuer,
asset, destination, amount, source sequence, transaction hash, and ledger. Only
the distinct non-login PostgreSQL role `orrylo_confirmation_writer` may append
a confirmation, and the migrations grant that role to no application login.
Gate A additionally rejects schema owners, superusers, role switching, and
ordinary application identities at the confirmation-writer boundary.
Status fields and application audit events cannot authorize publication.

Gate A includes a typed Testnet ledger-reader contract and a raw-XDR validator.
The validator requires exact equality across the requested hash, provider hash,
result-associated hash, recomputed Testnet transaction hash, and persisted
attempt hash. It separately compares decorated signed-envelope digests and
requires exactly one successful Classic payment result. It validates the
exact immutable issuer, asset, destination, amount, sequence, operation,
network, successful result, ledger, project, and owner before creating a
runtime-only validated confirmation value. Reconciliation cannot permit a
replacement unless an authoritative expired not-found observation and a
non-stale unchanged issuer sequence agree. Confirmed issuer keys, transaction
hashes, ledger confirmations, and explorer verification remain unavailable to
the application until genuine evidence is produced by a reviewed Stellar
service. Older Gate A interfaces retain explicit unavailable implementations for
pre-activation compatibility, but the bounded Testnet MVP execution path uses
the reviewed official Testnet Horizon adapters and PR #57's approved private
Railway signing primitive. POST reservation creation requires an authenticated
wallet, the owned project, a UUID idempotency key and a matching asset-code
assertion; browser-provided issuer, network and wallet authority are rejected.
The owner-authenticated execution route delegates only to the server
orchestration boundary described below; runtime composition fails closed unless
all approved Testnet signer/issuer/fee/confirmation-writer configuration is
present.

## Testnet MVP issuance orchestration

`SharedIssuanceOrchestrator.startOrResume(...)` is the single application entry
point joining the immutable owner-bound intent to the reviewed Testnet stack. It
runs official-Horizon preflight, builds the canonical one-payment envelope,
persists exactly attempt 1, invokes the injected secretless signing primitive,
persists signed-envelope provenance before one-shot submission, validates the
exact hash through the authoritative reader, and writes confirmation only
through the dedicated trusted writer.

Reload/replay reads durable server state. An existing attempt is never submitted
again and never replaced; it can proceed only through exact-hash authoritative
reconciliation. Ambiguous submission becomes `reconciliation_required` and no
browser response can create `confirmed` state. The builder treats Project
Profile persistence, immutable intent creation, and execution start as one
Create Token journey while retaining those server-side boundaries.

The bounded Testnet `SharedIssuerSigningPrimitive` technology is owner-approved
and implemented by PR #57 as a private Railway signer service plus narrow web
adapter. Production activation still requires the real signer service to be
provisioned/deployed, a separately owner-managed Testnet signer secret to exist
only in that service, the exact approved Shared Issuer public key and fee, and a
separately credentialed `orrylo_confirmation_writer` connection. Implementation
is not deployment evidence, and no signer seed or credential belongs in
application source.

This Gate A foundation is code-only and **not deployed or activated** until
independently approved.
Migration 007 follows PR #19 migration 006 and upgrades legacy 006 publication
rows by retaining them but marking them unreachable until exact immutable
confirmation provenance is attached. Migration 008 upgrades 001–007 databases
without rewriting their checksums, binds metadata to confirmation project and
owner scope, and hardens the dedicated-writer login check. Migration 009 adds
the one-time signed-envelope digest transition and binds new confirmations to
that exact digest without rewriting migrations 001–008.
The API fails closed with HTTP 503 until the reviewed issuer identity is explicitly
provided as server-only `ORRYLO_APPROVED_TESTNET_SHARED_ISSUER_PUBLIC_KEY`.
The reserved candidate is never automatically selected. The database enforces
uniqueness for each `(network, reservation_issuer_public_key, asset_code)`. A reservation identity
is immutable, and its audit events commit atomically with its durable
`workflow_intents` record. Requests do not contain destination/amount and
therefore do **not** claim PR #27's complete issuance-intent fingerprint.

Before application execution is activated, the Stellar owner must still provide
the final issuer identity, explicit approved destination and amount, ledger
preconditions, separately owned migration/application/confirmation database
logins and least-privilege grants, and live provisioning/deployment evidence for
the approved private Railway Testnet signer. The reviewed official Testnet
Horizon reader/submission adapters and PR #57 signer implementation are code
artifacts only and do not prove live deployment or issuance.
The distinct pure `prepareReservedSharedIssuerPlan` entrypoint accepts PR #27
types but is not exposed by any public API and cannot sign or submit.
Project publication and PR #19 metadata hosting remain separate. The issuance UI is in an additive managed-project layout, not PR #19's page or view.

## Testnet MVP activation readiness

The owner-approved bounded signer architecture is implemented as an isolated
private Railway Testnet signer service plus a narrow
`SharedIssuerSigningPrimitive` HTTP adapter. Production composition fails
closed unless the exact Testnet issuer, fee, private signer URL,
signer-authentication secret and dedicated confirmation-writer database
connection are explicitly configured. The web application never loads the
Stellar signer seed.

A repeatable read-only activation verifier is available for the account,
trustline, fee, official-Horizon and database-role prerequisites. It never
signs, submits, funds, changes account settings or creates a trustline:

```sh
export ORRYLO_APPROVED_TESTNET_SHARED_ISSUER_PUBLIC_KEY='G...'
export ORRYLO_TESTNET_SHARED_ISSUER_FEE_STROOPS='...'
export DATABASE_URL='postgres://APPLICATION_USER:...'
export ORRYLO_CONFIRMATION_WRITER_DATABASE_URL='postgres://CONFIRMATION_LOGIN:...'

npm run activation:verify:testnet -- \
  --destination 'G...' \
  --asset-code 'NOVA' \
  --amount '25.0000000'
```

The command uses only the fixed official Stellar Testnet Horizon endpoint and
read-only PostgreSQL privilege inspection. It rejects every known RYLO issuer
identity and the reserved `GBR7...ASSETS` candidate, requires the exact
OFF/OFF/OFF/OFF + 1/1/1 issuer policy, checks the destination's exact trustline
and complete-supply capacity, verifies the configured fee against the stable
ledger base fee and spendable issuer XLM after reserve/liabilities, and proves
that the ordinary application identity cannot insert authoritative
confirmations while the dedicated confirmation-writer login can.

The private signer is built from the same package but runs as a separate
Railway service:

```sh
npm run signer:build
npm run signer:start
```

The web service receives only `ORRYLO_TESTNET_SIGNER_PRIVATE_URL` and
`ORRYLO_TESTNET_SIGNER_REQUEST_AUTH_SECRET`. The signer service receives the
approved issuer public key, the same request-auth secret, Railway `PORT`, and
its service-scoped Stellar signer secret through runtime secret configuration.
The signer has no PostgreSQL connection and no Horizon submission adapter.

See `../docs/PRIVATE_RAILWAY_TESTNET_SIGNER.md` for the exact two-service
boundary and `../docs/TESTNET_MVP_ACTIVATION_RUNBOOK.md` for the remaining
owner-gated activation sequence.

## Remaining production gates

This phase intentionally does not add general network abuse/rate-limit
infrastructure or proxy-level request-body limits. Those remain production gates
before exposing authentication broadly on public infrastructure.

The reviewed Testnet code includes canonical Shared Issuer transaction
construction, a one-shot official-Horizon submission adapter, exact-hash
authoritative confirmation, the server orchestration path and PR #57's private
Railway signer implementation. Those capabilities are **not live** because
signer secret provisioning, Railway service deployment and the real issuance
remain owner-gated.

It still does not activate or implement:

- a deployed Testnet signer service or live Shared Issuer issuance;
- Dedicated Issuer provisioning;
- RYLO mint, burn, reward execution, eligibility activation, authorization, or
  payments;
- trustline mutation;
- Soroban mutation;
- liquidity operations;
- testnet or mainnet deployment.
