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
export DATABASE_URL='postgres://postgres:orrylo-dev@localhost:5432/orrylo'
docker exec orrylo-postgres createdb -U postgres orrylo_test
export TEST_DATABASE_URL='postgres://postgres:orrylo-dev@localhost:5432/orrylo_test'
```

Apply and verify migrations:

```sh
npm run db:migrate
npm run db:verify
```

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

Schema migrations are source-controlled under `db/migrations/`. The migration
runner records SHA-256 checksums in `schema_migrations`, rejects modified
already-applied migrations, and can bootstrap a fresh database from zero.

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

The anonymous token builder remains usable before authentication. When a visitor
chooses **Save & manage project**, the application uses the existing Albedo
session only as an ownership boundary:

```text
anonymous builder state
→ authenticated wallet session
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
status dashboard. The homepage leads with token creation and wallet connection,
then provides direct paths to Products & Services and RYLO. The anonymous token
builder does not require wallet authentication: visitors can configure asset
code, display name, description, a browser-local logo preview, Shared Issuer
infrastructure context, and metadata-domain presentation. The live preview stops
at one explicit execution boundary and never presents the configuration as an
on-chain asset.

RYLO presentation reflects the approved membership, 50 RYLO-equivalent Free
Build Credit, 150 RYLO launch reward, 60-day reward-window, supply, and direct
sale policies while clearly separating policy from live execution. Unimplemented
Products & Services are labeled Coming soon. Activity and Settings remain
secondary utility/diagnostic routes rather than primary customer navigation.

## Current data boundary

Wallet authentication and its database state are real application behavior.
Managed Project Profile creation, wallet ownership association, owner-scoped
management reads, and Orrylo landing-page publication are real application
behavior. Public project lookup reads the persisted Project Profile only after
its `public_status` is `published`.

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

## Remaining production gates

This phase intentionally does not add general network abuse/rate-limit
infrastructure or proxy-level request-body limits. Those remain production gates
before exposing authentication broadly on public infrastructure.

It also does not implement:

- Stellar transaction submission;
- Shared Issuer mutations or token issuance;
- Dedicated Issuer provisioning;
- RYLO mint, burn, reward execution, eligibility activation, authorization, or
  payments;
- trustline mutation;
- Soroban mutation;
- liquidity operations;
- testnet or mainnet deployment.
