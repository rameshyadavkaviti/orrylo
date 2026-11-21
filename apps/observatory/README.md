# ORRYLO Observatory

Authenticated, read-only monitoring frontend for the independent ORRYLO agent core.

## What it verifies
- Configured wallet count, current persisted cognition and stored revisions
- Latest action *tendencies* (not executions) and 24-hour cognitive episode history
- Read-only detail views: cognitive seeds, state, episodic traces and memories
- Latest RYLO/XLM observation passed into the core and non-routine audit codes

## Explicit limits
- Does not prove on-chain BUY/SELL, executed fills, profit, or human behavior.
- A market snapshot is not a stream of each website purchase.
- Read-only telemetry: all SQL statements are SELECT; session default_transaction_read_only=on. The database login must ideally also be a database-level SELECT-only role. The default Railway Postgres reference is operationally convenient but is NOT database-level least privilege.
- All application routes except /healthz require HTTPS Basic authentication. No credential is stored in this public repository.
- Public site is unaffected; no wallet secret keys, agent signing or trading features are included.

## Railway
- Project: orrylo-v2, service: orrylo-observatory
- Root directory: apps/observatory
- Start: npm start; health check: /healthz
- Required variables: DATABASE_URL, OBSERVATORY_USERNAME, OBSERVATORY_PASSWORD (>=24 characters)
- Custom domain: observatory.orrylo.com
- Ensure private monitoring access is not linked from the public site.
- After deploying, set a dedicated SELECT-only database credential and rotate the initial dashboard password.
