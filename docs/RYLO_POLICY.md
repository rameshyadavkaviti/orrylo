# RYLO — Independent Tradable Asset Policy v2

Status: **Owner-approved economic direction; documentation only, NOT deployment or transaction authorization.**
Scope: RYLO as a standalone Stellar asset. This policy supersedes RYLO Policy v1 economics, eligibility, direct sale, rewards, controlled-access trading and bootstrap allocation. Historical implementation/account facts require independent on-chain verification.

## Identity and separation
- RYLO is a standalone, transferable, potentially tradable Stellar asset; not a payment, membership, utility, or reward prerequisite for Orrylo.
- Orrylo customer token creation is paid in 10 XLM on Mainnet per distinct creation, including the first. No RYLO payment, reward, purchase, eligibility, or trustline step is required.
- RYLO has its own issuer identity, administration, supply, distribution, treasury and risk disclosures, separated from the customer Shared Issuer and the customer-payment Treasury.
- Tradability does not guarantee a listing, buyer, market value, liquidity, or appreciation.

## Fixed supply
- Target total and maximum supply: **100,000,000 RYLO**.
- Issue the entire approved supply once through a reviewed, auditable issuance ceremony. No additional minting after supply finalization.
- Before any irreversible issuer lock, independently verify network, issuer, signer access/recovery, supply and destination allocations, flags, metadata and ledger results.
- The technical mechanism for permanently disabling further issuance must be reviewed for Stellar correctness; never assume that a policy statement alone enforces a hard cap.
- Do not claim that tokens have been issued or supply has been locked without exact ledger evidence.

## Allocation (percent of fixed total)
| Allocation | Share | RYLO |
| --- | ---: | ---: |
| Long-term reserve | 60% | 60,000,000 |
| Market liquidity allocation | 20% | 20,000,000 |
| Development and operations | 15% | 15,000,000 |
| Future distribution | 5% | 5,000,000 |
| **Total** | **100%** | **100,000,000** |

- Allocation does not mean immediate public circulation or guaranteed liquidity.
- Record distinct holding accounts, control, vesting/release decisions and transfers publicly before distribution. Detailed release schedule and custodians remain to be approved.
- No automatic minting, airdrops, rewards or market operations follow merely from these allocations.

## Open transfers and issuer permissions
- Target: permissionless RYLO trustline establishment and ordinary peer-to-peer transfer, without Orrylo user eligibility.
- Proposed flags: AUTH_REQUIRED=OFF and AUTH_CLAWBACK=OFF. Review AUTH_REVOCABLE and any immutable authorization state before activation; no flag changes are authorized by this document.
- Existing Testnet issuer/signer mappings in v1 are historical reference, not approved production setup. Independently reconcile before reusing any account.

## Liquidity approach
- A **small illustrative initial pool/order-book provision** is 100,000 RYLO paired with 10 XLM, giving an initial ratio of 0.0001 XLM/RYLO. This ratio is not a guaranteed price or valuation.
- This is a planning example, **not** authorization to fund a pool, submit offers or launch public trading. Small liquidity can cause extreme price impact and slippage.
- Of the reported 50 XLM available for Orrylo preparation, do not earmark or spend 10 XLM on RYLO until Mainnet infrastructure costs, reserves and operational buffer are established and a separate liquidity approval is given.
- Liquidity allocation (20 million RYLO) is not an instruction to deploy all of it. Further provisioning requires a separate budget, market/risk review and explicit approval.

## No investment promises
- No guaranteed yield, buyback, floor price, return, profit sharing, or representation that fixed supply ensures appreciation.
- Public materials should disclose issuer/control risks, concentration, volatility, thin markets, operational dependencies and applicable legal/compliance considerations.
- Confirm legal and jurisdictional requirements before public offering or exchange/liquidity launch.

## Metadata and evidence
- Public metadata must use the actual HTTPS URL served by the site. A Next.js file at `public/logo.png` normally resolves as `https://orrylo.com/logo.png`, not `/public/logo.png`; verify deployment and content.
- Verify RYLO issuer home_domain, TOML currency entry, issuer public key and image URL independently before claiming metadata validity.
- Maintain on-chain evidence for supply, issuer configuration, allocations, liquidity and transactions.

## Explicitly superseded v1 rules
- Hybrid/on-demand minting and initial 0 supply.
- 0.1 XLM/RYLO direct Orrylo sale, Treasury-first direct sale, service-spend recycling.
- 150 RYLO first-build reward, 50 RYLO-equivalent free build credit, 60-day reward campaign.
- Wallet eligibility gating and issuer-required authorization for RYLO transfers.
- Old 3,000,000 RYLO bootstrap cap and 1,000 RYLO + 100 XLM initial pool plan.
- v1 operational co-signing workflows tied to sales, rewards or trustline eligibility. Security architecture must be redesigned/reviewed, not automatically discarded.

## Activation gates / outstanding decisions
1. Reconcile current Testnet and intended Mainnet issuer identities, account flags, balances, thresholds and signers.
2. Approve custody, allocation wallets, lock/freeze mechanism, recoverability and any vesting/release schedule.
3. Review open-trading flag choices and test trustlines, transfer, supply lock and recovery on Testnet.
4. Verify TOML/logo availability and disclose ownership, concentration and market risks.
5. Decide exact liquidity venue, timing, spending authority, budget and legal requirements.
6. Require a separate explicit owner authorization for any Mainnet funding, issuance, signer/flag change, liquidity transaction or launch.

No code, issuer, deployment, database, wallet or Mainnet state is changed by this policy.
