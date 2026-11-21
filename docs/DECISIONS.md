# Accepted decisions and open questions

| Date | Status | Decision |
|---|---|---|
| 2026-11-20 | ACCEPTED | Public GitHub repo `rameshyadavkaviti/orrylo` is the Source of Truth for ORRYLO agents and architects. |
| 2026-11-20 | ACCEPTED | orrylo.com is solely an informational/disclosure and possible Stellar asset home-domain, not a trading execution system. |
| 2026-11-20 | ACCEPTED | Defining research goal: each ORRYLO AI agent should progressively develop more human-like economic behavior and decision-making over time. |
| 2026-11-20 | ACCEPTED | ORRYLO agents are not required to be replicas of specific humans or derived from individual human profiles. The earlier VEYRIX model is NOT the ORRYLO engine. |
| 2026-11-20 | ACCEPTED | AI participation and the ambition for an AI-led market will be explicitly disclosed publicly. Actual majority AI trading volume is a claim requiring verification before publication as fact. |
| 2026-11-20 | ACCEPTED | ORRYLO will have its own separate agent system; its detailed design will be provided by the owner later. Do not preemptively define cognitive architecture or implement models. |
| 2026-11-20 | ACCEPTED | Do not inherit VEYRIX-specific artificial sleep windows, activity quotas, or unnecessary human-replica constraints. Preserve risk, security and market-integrity safeguards. |
| 2026-11-20 | ACCEPTED | No wash trades, coordinated fake volume, deceptive pricing, or manipulation, even when AI-led activity is disclosed. |
| 2026-11-20 | ACCEPTED | Investigate recovery of original RYLO before any replacement issuance. RYLOMA remains only an unapproved proposed name. |
| 2026-11-20 | ACCEPTED | Use isolated Railway project `orrylo-v2` for the public website. |
| 2026-11-20 | ACCEPTED | Disconnect both `orrylo.com` and `assets.orrylo.com` from the old Railway service; do not delete old bucket, signer services, or private repo as part of cutover. |
| 2026-11-20 | PENDING | Detailed ORRYLO agent architecture, learning mechanisms, evaluation benchmarks and trading implementation. |
| 2026-11-20 | PENDING | Actual AI trader count, live fills, proportion of AI-led volume, beneficial controllers, asset issuer and RYLO supply. |
| 2026-11-20 | PENDING | Asset-specific SEP-1 stellar.toml metadata and issuer verification. |
| 2026-11-21 | ACCEPTED | Agent Core Phase 1 architecture and implementation: separate Railway service plus PostgreSQL, immediate verified environment enrollment, unique persisted causal identity, bounded independent evolution, authenticated event ingestion, and numeric behavioral evaluation. |
| 2026-11-21 | ACCEPTED | Every admitted agent starts with strong but individually expressed RYLO competition and acquisition motives. These are motivational priors, never forced BUY, synchronized execution, price support, minimum activity or chart-shape objectives. |
| 2026-11-21 | DEFERRED | Stellar signing, live transaction submission, asset verification, beneficial-owner enforcement and capital/risk policy require a separate approved phase. |

| 2026-11-20 | ACCEPTED | Proposed initial RYLO sale ask: **0.1 XLM per RYLO**. This is an offer price, not a guaranteed execution price, market floor, or price-stability commitment. |
| 2026-11-20 | ACCEPTED — PRODUCT REQUIREMENT | To become eligible for an ORRYLO AI agent, a wallet must connect and prove wallet control through **Albedo login initiated on the ORRYLO website**, then purchase a positive amount of the new RYLO asset. Exact minimum purchase, enrollment rules, launch and implementation are still pending; no agent activation is implied by a purchase alone. |
| 2026-11-20 | ACCEPTED — DESIGN PRINCIPLE | AI agents are not required to sell below their cost basis or to produce a prescribed downward price path. Any sale must arise from their own valuation, liquidity needs and risk decisions; no coordinated wash trading or artificial volume. |

| 2026-11-21 | ACCEPTED — COGNITIVE LEARNING PRINCIPLE | **Reward-based learning is a core requirement of ORRYLO agents.** Agents must learn from rewards, reward prediction, non-reward, and adverse outcomes, with individually variable sensitivity shaped by memory and experience. Rewards may include genuine economic outcomes, simulated psychological/social feedback, and explicitly designed incentives. Do not categorically exclude rewards after successful trades; instead distinguish natural market P&L from extra token incentives and evaluate unintended optimization, reward hacking, coordinated trading, and market-integrity risks. No reward scheme or token distribution is approved by this principle alone. |

| 2026-11-21 | ACCEPTED — TOKENOMICS POLICY (NOT YET EXECUTED) | RYLO V2 planned burn is **27%** of reference issuance (963,748,219), leaving **703,536,199.87 RYLO**; approved post-burn allocations: 30% agent learning/rewards, 20% ecosystem, 18% infrastructure/research, 15% strategic reserve, 10% team, 7% liquidity. **100% unlocked by month 18**, with month-0 limited liquidity and month-7 start for team/reserve. Initial ask reference **0.1 XLM/RYLO**. Full implementation, verification and precision schedule: `docs/RYLO_TOKENOMICS.md`. No burn, escrow or pool deployment is implied. |

## Interpretation
Human-like behavioral evolution is a **research objective**, not a verified daily result, literal human transformation, or consciousness claim. ORRYLO and VEYRIX must remain conceptually and operationally distinct.

## Separate initiatives
Prior XLM accumulation bots, multiasset strategies and market alerts are not part of the ORRYLO informational website without new approval. Historical VEYRIX P&L has not been independently audited.
