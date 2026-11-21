# RYLO V2 — Accepted tokenomics policy (2026-11-21)

**Status:** Owner-approved policy/design; NOT executed on-chain. Burn, vesting/escrow, liquidity pool and issuer finalization each require separately verified transactions. The actual network state takes precedence over this document.

## Asset and supply

- Asset: RYLO, Stellar Classic Asset on mainnet, issuer `GDG7SGYLJQBLSN55ASHD7VCXYBEPYDK4EUIUTW6XWTBUDUHXK6ORRYLO`.
- Reference issued supply: **963,748,219.0000000 RYLO** (verify current on-chain balances and supply immediately before execution).
- **Approved planned burn: 27%** of reference supply = **260,212,019.1300000 RYLO**.
- **Target post-burn supply: 73%** = **703,536,199.8700000 RYLO**.
- Burn is from project-controlled tokens only, never third-party balances. On Stellar Classic Asset, an issuer receiving its own asset extinguishes that asset's circulating outstanding amount; verify issuer-specific accounting and transaction evidence before labeling a burn completed.
- Proposed initial ask / pool reference price: **0.1 XLM per RYLO**. Not a price peg, guaranteed floor, or market valuation. At that price the post-burn *notional* fully diluted value is **70,353,619.987 XLM**, not realizable liquidity or project revenue.
- Burn timing: initial independent market observation may precede the burn, but the percentage and tokenomics are fixed as policy here; no implication that price reaction determines a guaranteed return. Publish transparent transaction proof and actual issuer controls. The issuer's authorization-immutable flag does **not** prevent further issuance; a separate irrevocable issuer-control policy must be designed and audited before claiming fixed maximum supply.

## Allocation of the post-burn supply

| Bucket | % | RYLO (7 decimals) | Unlock window |
|---|---:|---:|---|
| Agent cognitive evolution and rewards | 30% | 211,060,859.9610000 | Months 1–18 |
| Ecosystem and contributors | 20% | 140,707,239.9740000 | Months 1–18 |
| Infrastructure and research | 18% | 126,636,515.9766000 | Months 1–18 |
| Strategic treasury reserve | 15% | 105,530,429.9805000 | Months 7–18 |
| Development team | 10% | 70,353,619.9870000 | Months 7–18 |
| Liquidity and market inventory | 7% | 49,247,533.9909000 | Month 0 small initial tranche; remainder months 1–18 |
| **Total** | **100%** | **703,536,199.8700000** | **Fully unlocked by end of month 18** |

## Deterministic release specification

- Month 0 (launch): unlock **0.5% of total post-burn supply** = **3,517,680.9993500 RYLO**, sourced exclusively from the liquidity bucket. This is an *upper availability* tranche, not an instruction to deposit or sell all of it.
- Months 1–18: unlock agent rewards (30%), ecosystem (20%), infrastructure (18%) in **18 equal monthly installments** for each bucket. Unlock remaining liquidity allocation (**6.5% of post-burn supply**) in **18 equal monthly installments**.
- Months 7–18: unlock strategic treasury (15%) and team (10%) in **12 equal monthly installments**, with no unlock in months 0–6.
- By end of month 18, **100% of the post-burn supply is unlocked**, not necessarily sold, distributed to users, or held in AMM liquidity. Implement 7-decimal rounding and assign residual dust to each bucket's final tranche; no unlock should exceed its bucket cap.
- Unlock schedule must be implemented through verifiable escrow/claim mechanisms or equivalent auditable controls. Wallet labeling and a published schedule alone are not on-chain locks. Vesting does not imply compulsory distribution, market sales, or immediate spend.

## Liquidity and economic behavior

- Illustrative launch AMM position: **500 XLM + 5,000 RYLO** at a starting 0.1 XLM/RYLO ratio, assuming a compatible equal-value AMM and its actual fee/rules. This is only a *proposed example*, not a deployed pool or guaranteed execution price.
- LP shares must remain redeemable unless separately locked; withdrawing yields the holder's proportional pool balances at withdrawal time, not a guaranteed return of the initial 500 XLM. Token vesting must not be confused with locking LP shares.
- Rewards and reward-based learning are a defining cognitive requirement: agent-specific sensitivity to genuine economic outcomes, prediction errors, non-rewards and psychological/social signals. Any token reward mechanism must be separately specified and audited for reward hacking, coordinated volume, and misleading market activity. No incentives solely for fake trades or fabricated volume.
- Independent demand, real liquidity depth, price impact, active circulating float, treasury financing and **operating revenue** must be measured separately. Token allocations, unlocked supply and nominal token valuations are not realized revenue.
- Preserve `docs/MARKET_INTEGRITY.md`: disclose AI participation; prohibit wash trades, common-controller self-trading, price support and false claims of demand or liquidity.

## Execution gates / pending decisions

1. Verify current issuer supply, distribution balance, and all asset controls on Stellar mainnet.
2. Define and test burn transaction, issuer supply-finalization, custody and emergency procedures.
3. Define on-chain escrow/vesting contracts and beneficiary governance for all six buckets.
4. Validate AMM parameters and initial budget; separate liquidity wallet and vesting wallets.
5. Publish actual on-chain transaction references only after confirmation; update asset metadata to match completed state.

This document supersedes earlier **47% burn** and **36–42-month** unlock proposals. The selected burn is **27%** and all post-burn tokens become unlocked within **18 months**.
