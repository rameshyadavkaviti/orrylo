# Stellar Classic — ORRYLO Network Hunter v3 (research/paper only)

This phase does **not** depend on any observed wallet's trading behavior. It uses publicly documented Stellar Horizon endpoints for network-level discovery and strict-send path quote validation.

## Run locally (Node.js 22+)

From `services/arbitrage/`:

```bash
npm test
node paper-trading.mjs --once --journal /path/to/paper-results.json
```

Omit `--once` to poll every 30 seconds. The journal saves the latest successful
scan in `lastScan` and simulated fills or failures in `results`. The terminal
prints the same scan as a JSON line with candidate count, paper balance and
daily loss. Use a local journal path outside the checkout.

For quote discovery only, use `node network-hunter.mjs --once` or omit
`--once` for continuous monitoring.

## What it does

- Uses `/paths/strict-send` with `source_asset_type=native` and `destination_assets=native` at up to three sizes (2, 5 and 10.5 XLM), subject to the paper budget. If Horizon returns only the same-asset identity path, the simulator checks the vetted XLM–USDC–VELO–XLM and XLM–VELO–USDC–XLM routes using separate direct quotes. Each accepted route must pass the same quote window, ledger checks and risk limits.
- Validates full-path response, exact asset identifiers, per-quote `Latest-Ledger` quote headers, current ledger close time and cross-request ledger consistency. The latest ledger collection can supply its sequence from the validated record body. Rejects empty/self-only routes.
- Classifies quotes involving assets outside an exact issuer allowlist as `UNVETTED_RESEARCH_ONLY` regardless of apparent gains. Default eligible research assets: native XLM, USDC issued by Circle, and VELO by the explicitly configured issuer. **All are subject to independent issuer and market-risk diligence before any real execution.**
- Eligible quotes with current, in-budget paper state are labeled `PAPER_CANDIDATE`. Without paper state, those quotes are `PAPER_RISK_UNAVAILABLE`. Candidates are indicative quotes and can change or vanish.
- Samples the network-wide latest 200 trade records for activity statistics. This is a **sample**, not an exhaustive crawl of every token or venue.
- Makes no changes to existing `main.mjs`, no transactions, no signatures and does not read `TREASURY_SECRET_KEY`.

## Experimental paper limits

The scanner uses 700 XLM of reference capital, a protected reserve of 595 XLM (85%),
an initial active budget of 105 XLM, and a maximum route notional of 10.5 XLM (1.5%).
Quote sizing leaves room for the modeled 0.03 XLM fee above the reserve, using the lower
of the reported paper balance and the reference capital. A 100 bps friction haircut
and 0.01 XLM failure-cost allowance also apply to the estimated edge. Candidates need
both 0.03 XLM and 70 bps of conservative net estimated edge.

The simulator starts with 700 XLM on an empty journal path. It checks the
current paper balance and the recorded loss before scanning. It then takes the
highest-ranked eligible candidate and asks Horizon for a fresh quote for the
same path and size. An eligible confirmation produces `PAPER_FILL` with the
modeled net result. If the fresh quote loses that path or falls below the
threshold, `PAPER_NO_FILL` charges a modeled 0.01 XLM failure cost. Stale or
failed requests stop the cycle without a simulated fill.

The journal enforces the daily loss limit of 3.5 XLM (0.5%) using cumulative
simulated losses, including failure costs. Gains do not replenish the loss
allowance. The simulator budgets the failure cost before a new attempt. Losses
reset at midnight UTC while the balance and prior results carry forward. The
journal prevents retrying the same ledger after a restart. It is replaced
atomically under an exclusive local lock. If a terminated process leaves a
`.lock` file, verify the process has stopped before removing that lock.

## Scope limitations

- Only the classic Stellar SDEX and liquidity pools surfaced by Horizon path finding are in scope; Soroban DEX/AMMs and centralized exchanges are **not** automatically included.
- Horizon path search can omit paths or return no native→native cycles; this scanner does **not** exhaustively enumerate every order or AMM pool and cannot guarantee discovering every profit opportunity.
- The simulation uses consecutive indicative quotes. It does not model order-book consumption, transaction inclusion, or actual network fees.
- Self-match prevention, executed path reconciliation, fee estimation from current network, safe signing, trustline and account-reserve checks, event journal, replay-based backtest, daily-loss kill switch and execution approval are prerequisites to any live phase.
- The research scanner and simulator use read-only public requests. Mainnet execution uses the separate service entry point below.

## References

- https://developers.stellar.org/docs/data/apis/horizon/api-reference/list-strict-send-payment-paths
- https://developers.stellar.org/docs/data/apis/horizon/api-reference/structure/consistency
- https://developers.stellar.org/docs/data/apis/horizon/api-reference/aggregations/order-books/object
- https://stellar.org/blog/developers/failed-transaction-mitigation-faq

## Prepare a candidate as a Stellar transaction

From `services/arbitrage/`, install the isolated worker's dependencies with
`npm install`, then run:

```bash
npm run prepare:arbitrage -- --account PUBLIC_STELLAR_ACCOUNT --journal /path/to/paper-results.json --fee-stroops 1000
```

The command reads public quotes and, for an eligible candidate, the account's
public sequence and native balance. It builds one unsigned Mainnet
`PathPaymentStrictSend` envelope ending at the same account. The envelope
requires a minimum XLM return large enough to cover the input, the encoded fee
ceiling and the minimum net edge. It expires after 20 seconds or after the
ledger bound. The builder applies the experimental reserve and loss limits to
preparation and checks the Stellar minimum balance and native selling liabilities.

Output contains `unsignedXdr`, the transaction ID to expect if signed without
changing the envelope, and the bound amounts. If no candidate qualifies, the
command prints `NO_PAPER_CANDIDATE`. Preparation does not sign, submit, or
reconcile any transaction. The paper journal tracks simulated outcomes only.

## Mainnet service

The separately authorized Railway worker runs `npm run start:live` when
`ORRYLO_LIVE_ARBITRAGE=true`. It uses the existing treasury key variables and
requires a persistent volume. Keep the worker at one replica. Its account must
have no open offers or liquidity-pool shares. The approved account is the only
owner-controlled account in the XLM/USDC/VELO routes.

The worker commits one pending transaction to SQLite before submitting it and
checks that hash before considering another trade. An expired transaction is
released only after the Horizon ledger and account sequence show it was not
included. A confirmed result records actual XLM proceeds minus the input and
network fee. Cumulative negative results for the UTC day stop the worker at
3.5 XLM, including the maximum fee allowance for a new submission.

Railway logs distinguish startup, scans without candidates, submission pending
settlement, and settled results. Disable `ORRYLO_LIVE_ARBITRAGE` to stop new
submissions and retain the volume for transaction reconciliation.
