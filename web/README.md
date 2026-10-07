# Orrylo web application

This directory contains Application Phase 1: the production-oriented Orrylo web
foundation. It is intentionally limited to demo data and non-mutating
integration boundaries.

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

The application runs in explicit `demo` data mode. Demo state is separated from
future adapters and is labeled in the UI. It does not claim live wallet,
eligibility, balance, asset, activity, or on-chain transaction state.

The committed environment example contains public configuration only. No Stellar
secret keys, issuer secrets, wallet secrets, or private credentials belong in
the web application.

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

## Intentionally unavailable

Application Phase 1 does not implement:

- Albedo connection or session verification;
- Stellar transaction submission;
- Shared Issuer mutations or token issuance;
- Dedicated Issuer provisioning;
- RYLO mint, burn, rewards, eligibility mutation, authorization, payments, or
  pricing;
- testnet or mainnet deployment.

The corresponding UI surfaces remain visibly unavailable rather than simulating
success.
