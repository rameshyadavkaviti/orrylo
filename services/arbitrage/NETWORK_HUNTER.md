# Stellar Classic — ORRYLO Network Hunter v3 (research/paper only)

This phase does **not** depend on any observed wallet's trading behavior. It uses publicly documented Stellar Horizon endpoints for network-level discovery and strict-send path quote validation.

## Run locally (Node.js 22+)

From `services/arbitrage/`:

```bash
npm test
node network-hunter.mjs --once
```

Or run continuous, read-only monitoring:

```bash
node network-hunter.mjs
```

It prints JSON lines: `started`, `market_scan`, `paper_candidate`, `network_activity_sample`, `fail_closed` and `discovery_warning`.

## What it does

- Uses `/paths/strict-send` with `source_asset_type=native` and `destination_assets=native` at 2, 5 and 10 XLM. **Provider support for circular native→native quote paths must be tested against live Horizon** before this approach can be relied on. If no supported paths are returned, no trade is inferred.
- Validates full-path response, exact asset identifiers, per-quote `Latest-Ledger` headers, current ledger close time and cross-request ledger consistency. Rejects empty/self-only routes.
- Classifies quotes involving assets outside an exact issuer allowlist as `UNVETTED_RESEARCH_ONLY` regardless of apparent gains. Default eligible research assets: native XLM, USDC issued by Circle, and VELO by the explicitly configured issuer. **All are subject to independent issuer and market-risk diligence before any real execution.**
- Quotes that pass a profit threshold are labeled `PAPER_CANDIDATE`. This is **not executed profit**. Simulated quote amounts can change or vanish before execution.
- Samples the network-wide latest 200 trade records for activity statistics. This is a **sample**, not an exhaustive crawl of every token or venue.
- Makes no changes to existing `main.mjs`, no transactions, no signatures and does not read `TREASURY_SECRET_KEY`.

## Risk assumptions (NOT validated forecasts)

700 XLM reference capital, 600 XLM paper reserve, 10 XLM maximum per examined path; round-trip friction haircut of 100 bps, assumed 0.03 XLM maximum fee and 0.01 XLM failure-cost allowance. Candidates need both a minimum 0.03 XLM conservative net *estimated* edge and 70 bps. These assumptions do not guarantee positive expected profit. Fees can rise in surge conditions and can be paid for failed transactions.

The paper engine has **no live execution path** and no realized PnL. Runtime JSON logs are ephemeral on Railway unless explicitly persisted to a database or external logging sink.

## Scope limitations

- Only the classic Stellar SDEX and liquidity pools surfaced by Horizon path finding are in scope; Soroban DEX/AMMs and centralized exchanges are **not** automatically included.
- Horizon path search can omit paths or return no native→native cycles; this scanner does **not** exhaustively enumerate every order or AMM pool and cannot guarantee discovering every profit opportunity.
- The quote engine does not yet simulate ledger-level path consumption by other arbitrageurs, dynamically forecast failed-tx fees, or maintain a historical strategy equity curve.
- Self-match prevention, executed path reconciliation, fee estimation from current network, safe signing, trustline and account-reserve checks, event journal, replay-based backtest, daily-loss kill switch and execution approval are prerequisites to any live phase.
- **Do not connect this source to the production service start command or set a LIVE mode.** This module has no LIVE mode; adding one requires a separate reviewed implementation and user confirmation.

## References

- https://developers.stellar.org/docs/data/apis/horizon/api-reference/list-strict-send-payment-paths
- https://developers.stellar.org/docs/data/apis/horizon/api-reference/structure/consistency
- https://developers.stellar.org/docs/data/apis/horizon/api-reference/aggregations/order-books/object
- https://stellar.org/blog/developers/failed-transaction-mitigation-faq