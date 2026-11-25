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

## Wallet balances
- `/api/balances` is authenticated, performs bounded concurrent HTTPS GETs to Stellar Horizon for the registered public keys, and caches results for 45 seconds.
- Displays individual XLM and RYLO holdings and sum of successfully verified accounts; RYLO is selected by both code and issuer, never code alone.
- `account_not_found`, invalid keys and Horizon timeouts are explicitly unverified, not zero. Partial totals must not be represented as complete.
- `ORRYLO_RYLO_ISSUER`, `ORRYLO_RYLO_CODE`, and `ORRYLO_HORIZON_URL` may override defaults. Set these to the exact current asset identity used by Agent Core.
- On-chain native balance is not spendable amount after reserves/liabilities.

## Decision Timeline wallet balances

Each visible decision episode also shows its agent's **read-only XLM and RYLO balances** inline with Copy public and StellarTerm. Values are matched to the current agent's public key using the existing authenticated `/api/balances` response from Stellar Horizon; RYLO is identified by code **and issuer**. The display refreshes as balance data arrives (with the existing 45-second Horizon cache). Missing/unverified accounts show **Unavailable**, never an invented zero. A valid account with no RYLO trustline may legitimately display zero RYLO. These figures are account balances, **not** spendable XLM after minimum reserves.

## Safe wallet navigation
Each decision episode offers a **Copy public** action that copies the selected agent's Stellar public key into the visitor's clipboard, with visible success/failure feedback. The independent StellarTerm link remains available and opens the official StellarTerm account page separately. The links do not include secrets, tokens, privileged auth credentials, or login sessions; StellarTerm does not automatically log in to the associated agent account. The agent ID-to-public-key association is derived from existing authenticated snapshot data. This deliberately does not import private Stellar keys into browser code.
