# Market integrity requirements

1. AI agents must be disclosed as software; never pretend they are humans.
2. Separate AI profiles, key pairs and wallets do not prove independent beneficial ownership.
3. Prohibit wash trades, controlled-account self-matching, artificial turnover, coordinated price support, fake liquidity and pump-and-dump tactics.
4. Distinguish live independent fills from order submissions, internal fund transfers and transactions among commonly controlled accounts.
5. Publish independent counterparties, honest fees/price impact and investment performance only when audited.
6. Favor genuine market utility, organic demand and truthful disclosure over generated volume.
7. Do not present the venue as risk-free or guarantee market price, liquidity, asset value or principal preservation.
8. Live agent execution must remain feature-gated and enforce per-order and rolling daily capital caps, minimum free XLM, a maximum buy price, an open-offer cap, related-wallet configuration, non-crossing offers, durable audit records and an emergency pause.
9. A submitted offer is not a fill, revenue, profit or proof of successful trading. Learning from economic success must use reconciled settlement/P&L evidence, not submission alone.

Orrylo's homepage is informational and cannot by itself enforce any network-wide trading rules.

10. Prevent unbounded agent offer accumulation with an enforced per-wallet cap scoped to RYLO/XLM. The cognitive loop must continue even if a BUY/SELL attempt is blocked; record the precise reason.
11. Preserve standing RYLO/XLM orders without an arbitrary 45-minute expiry while an agent wallet has eight or fewer open pair offers. The maximum is eight total RYLO/XLM offers per agent (BUY and SELL combined). Only when over the cap, gradually cancel the oldest excess offers (up to four cancellations per transaction; sweep each wallet at most once every two minutes). Never touch non-RYLO asset pairs or create matching trades while cleaning. Existing legitimate bids are not automatically evidence of real external demand.
12. Maintenance transaction submission is not proof of profit or trading volume; count cancelled offers separately from executed trades. A Horizon maintenance failure must not suspend agent learning.

13. Live RYLO/XLM orders can be configured with a minimum notional (ORRYLO_EXECUTION_MIN_ORDER_XLM). A minimum is a strict funding filter, not a mandate to create bids. If free balance or RYLO holdings are insufficient, skip the offer without reducing reserve or changing independent agent decisions. Do not portray larger offers from commonly controlled wallets as organic independent demand.

14. Agent pricing must consume each agent's own persisted, gradually learned price anchor and learned risk tolerance. A sell order may be above or below reference according to valuation and liquidity stress; no agent is allocated a mandatory price tier, and a submitted offer must never be treated as verified acquisition cost. Higher buy bids remain subject to the configured buy-price cap, non-crossing guard, related-account prohibitions and available capital.
