# ORRYLO Agent Core

Phase 1 is a private, separate runtime for durable ORRYLO software-agent identities. It verifies configured Stellar key pairs, derives a unique versioned causal seed, stores independent state/memory/history in PostgreSQL, and accepts ordered authenticated experiences. It cannot sign or submit transactions.

## Commands

```sh
npm install
npm test
npm run typecheck
npm run build
npm start
```

## Required variables

- `DATABASE_URL`
- `ORRYLO_IDENTITY_MASTER_KEY` (minimum 32 characters)
- `ORRYLO_IDENTITY_KEY_VERSION` (positive integer; applies only to new agents)
- `ORRYLO_INTERNAL_API_KEY` (minimum 32 characters)
- `ORRYLO_EXECUTION_ENABLED=false`

Optional: `ORRYLO_INTERNAL_API_KEY_PREVIOUS`, `ORRYLO_PAUSED`, `ORRYLO_RECONCILE_INTERVAL_MS`, `ORRYLO_AGENT_ENV_PREFIX`, `PORT`, and `HOST`.

Wallet pairs use `ORRYLO_AGENT_<TOKEN>_PUBLIC_KEY` and `ORRYLO_AGENT_<TOKEN>_SECRET_KEY`. `<TOKEN>` permits uppercase letters, digits and underscores. The secret is verified in memory and never persisted, returned, or intentionally logged. Invalid candidates make readiness unhealthy without blocking valid candidates.

## HTTP

Open redacted endpoints: `GET /healthz`, `GET /readyz`.

Bearer-protected endpoints: `GET /v1/agents`, `GET /v1/agents/:id`, `POST /v1/events`, `GET /v1/metrics`.

Accepted external event types are `market_observation`, `decision_outcome`, `social_signal`, `operator_feedback`, and `evaluation_probe`. Each agent requires a strictly increasing sequence. Duplicate event IDs with identical canonical payloads are idempotent; changed duplicates and out-of-order events return conflict.

## Operational boundary

This service establishes mechanisms and measurements, not proof of consciousness, humanity, profit, scientific validation, or observed improvement. Strong RYLO competition/acquisition motives remain bounded inputs to appraisal; they never force BUY. Live signing and execution require a separately approved phase.
