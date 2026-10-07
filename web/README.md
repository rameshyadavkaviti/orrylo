# Orrylo web application

This directory contains Orrylo's application foundation plus the approved
Albedo authentication/session slice. Product and on-chain data remain explicit
demo/unavailable state unless stated otherwise.

## Runtime

- Node.js: 22.x
- npm: 10.9.9
- Next.js: 16.4.0
- React: 19.3.0
- TypeScript: strict mode

## Local setup

```sh
cd web
cp .env.example .env.local
npm ci
npm run dev
```

Open the local URL printed by Next.js.

Run all application gates:

```sh
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
```

## Current data boundary

The application runs product data in explicit `demo` mode. Wallet authentication
is the one live application capability in this phase: Albedo signs a short-lived
server-issued challenge and Orrylo verifies it before establishing an HttpOnly
application session. The UI still does not claim live balances, eligibility,
RYLO holdings, assets, activity, or on-chain transaction state.

`ORRYLO_AUTH_DOMAIN` is server-only configuration used to bind authentication
challenges and validate browser origins. No Stellar secret keys, issuer secrets,
wallet signing keys, session tokens, or private credentials belong in public
environment variables or source control.

## Contract boundary

The application compatibility abstraction supports Contract Interface v1 only:

- `interface_version() -> u32`
- `version() -> u32`
- `state() -> Result<FoundationState, Error>`

It rejects unsupported interface versions and maps the two currently known typed
errors:

- `AlreadyInitialized = 1`
- `StateUnavailable = 2`

No live contract ID is committed and no live contract read is performed yet.

## Wallet authentication

Current authentication flow:

```text
POST /api/auth/challenge
→ server creates a 5-minute single-use challenge
→ Albedo public_key intent signs the exact challenge
→ POST /api/auth/verify
→ server verifies payload, public key, Ed25519 signature, expiry and nonce use
→ 8-hour opaque server session in an HttpOnly SameSite=Lax cookie
→ POST /api/auth/logout invalidates the server session
```

Challenges and sessions are currently stored in process-local memory. This is a
deliberately narrow pre-database implementation: it is replay-safe within one
Node.js process, but it is **not** suitable for horizontally scaled/serverless
multi-instance production deployment because another instance cannot see the
same nonce/session state. Replace it with a shared atomic store before such a
deployment.

No Albedo implicit-flow token, callback URL, transaction intent, secret key, or
wallet signing key is stored by Orrylo.

## Intentionally unavailable

This phase does not implement:
- Stellar transaction submission;
- Shared Issuer mutations or token issuance;
- Dedicated Issuer provisioning;
- RYLO mint, burn, rewards, eligibility mutation, authorization, payments, or
  pricing;
- testnet or mainnet deployment.

The corresponding UI surfaces remain visibly unavailable rather than simulating
success.
