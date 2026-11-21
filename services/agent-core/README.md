# ORRYLO Agent Core

This private runtime creates durable ORRYLO software-agent identities, stores independent state/memory/history in PostgreSQL, and runs an optional non-overlapping decision loop from the live Stellar mainnet RYLO/XLM order book. It cannot sign or submit transactions.

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

Optional: `ORRYLO_INTERNAL_API_KEY_PREVIOUS`, `ORRYLO_PAUSED`, `ORRYLO_RECONCILE_INTERVAL_MS`, `ORRYLO_AGENT_ENV_PREFIX`, `ORRYLO_DECISION_ENABLED`, `ORRYLO_DECISION_INTERVAL_MS`, `ORRYLO_HORIZON_URL`, `ORRYLO_RYLO_CODE`, `ORRYLO_RYLO_ISSUER`, `ORRYLO_REFERENCE_PRICE_XLM`, `PORT`, and `HOST`.

Wallets use `ORRYLO_AGENT_<TOKEN>_SECRET_KEY`; the matching public key is derived in memory. An optional `ORRYLO_AGENT_<TOKEN>_PUBLIC_KEY` is accepted and must match. `<TOKEN>` permits uppercase letters, digits and underscores. The secret is verified in memory and never persisted, returned, or intentionally logged. Invalid candidates make readiness unhealthy without blocking valid candidates.

When `ORRYLO_DECISION_ENABLED=true`, one Horizon snapshot is shared as environmental evidence per cycle, while each configured agent independently appraises it through its own identity, state, memory and deterministic decision draw. The service stores one audited episode per agent and logs only aggregate action counts and public market depth.

## HTTP

Open redacted endpoints: `GET /healthz`, `GET /readyz`.

Bearer-protected endpoints: `GET /v1/agents`, `GET /v1/agents/:id`, `POST /v1/events`, `GET /v1/metrics`.

Accepted external event types are `market_observation`, `decision_outcome`, `social_signal`, `operator_feedback`, and `evaluation_probe`. Each agent requires a strictly increasing sequence. Duplicate event IDs with identical canonical payloads are idempotent; changed duplicates and out-of-order events return conflict.

## Operational boundary

This service establishes mechanisms and measurements, not proof of consciousness, humanity, profit, scientific validation, or observed improvement. Strong RYLO competition/acquisition motives remain bounded inputs to appraisal; they never force BUY. Live signing and execution require explicit capital limits and related-wallet controls in addition to operator approval.
