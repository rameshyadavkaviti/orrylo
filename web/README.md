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

## Future-domain schema only

The migration prepares inactive tables for:

- eligibility records;
- reward records with a database-unique reward uniqueness key;
- protected operation intents for future mint, authorization, treasury-transfer,
  and liquidity workflows.

These tables are not wired to public mutation endpoints and do not activate any
RYLO or Stellar behavior.

## Current data boundary

Wallet authentication and its database state are real application behavior.
Balances, eligibility UI, RYLO holdings, assets, activity, rewards, protected
operations, and on-chain transaction state remain demo/unavailable unless a
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
