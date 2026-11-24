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
11. Old agent-wallet RYLO/XLM offers are eligible for signed cancellation after 45 minutes without an update; when above the cap, offers older than five minutes may also be retired. Limit each cleanup transaction to four cancellations and rate-limit sweeps to every two minutes per wallet. Do not touch non-RYLO asset pairs or create matching trades while cleaning.
12. Maintenance transaction submission is not proof of profit or trading volume; count cancelled offers separately from executed trades. A Horizon maintenance failure must not suspend agent learning.
