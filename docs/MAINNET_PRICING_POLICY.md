# Orrylo — Mainnet Token Creation Pricing Policy v1

Status: **Approved product policy; implementation NOT enabled.**
Scope: customer-created tokens on Stellar Mainnet, initially the Shared Issuer path. Effective when a separately reviewed Mainnet release is explicitly activated. Does not authorize on-chain activity.

## Price and entitlement
- **No free Mainnet creation**. Every new successful customer token creation costs exactly **10 XLM**, including the first. Remove any free-build entitlement/credit from Mainnet creation eligibility and pricing.
- The charge is **Orrylo's service price**, not the Stellar network fee or account reserve. Disclose any wallet/network reserve needs independently.
- **Only Mainnet XLM is accepted as payment**. Testnet issuance/testing cannot debit real XLM and does not create a transferable free Mainnet entitlement. Preserve the currently working Testnet creation path.
- One distinct creation request/order is charged once; a retry, refresh or recovery is not a new purchase. A new token/project requires a new paid order. No automatic subscriptions or hidden charges.
- Launch reward of **150 RYLO** and all RYLO reward eligibility/minting remain **suspended pending explicit policy review and separate activation**. Do not mint or promise RYLO based on paid creation. This document does not change RYLO issuer security, supply cap or signer policy.

## Mainnet payment safety
- This is a future implementation specification, not evidence of deployed payment logic.
- Server creates an authenticated, owner-bound, immutable order: order ID, network passphrase, token code, issuer identity, issuance amount, destination, price (10 XLM), approved Treasury destination, memo/transaction binding and expiry. Only an explicitly configured approved **Mainnet Treasury** may receive payment; never use the Operations account as the sale destination.
- Client shows exact token and price and explicitly asks wallet to approve payment. Never store wallet or issuer secrets in browser/backend/logs.
- Independently confirm the payment in the Mainnet ledger: exact currency, amount, sender, recipient, memo/order binding, operation contents, result and finality. A client callback or payment hash alone is insufficient.
- Enforce single settlement per order and single consumption per payment transaction, including across concurrency/retries, with database uniqueness and transactional state transitions. Multiple payments for one order must not produce duplicate issuance; surface excess amounts for review/refund.
- Never issue before confirmed payment. If payment confirmed and issuance is ambiguous, preserve the paid order as **reconciling** and verify exact signed Stellar transaction and ledger result before any retry.
- Do not refund or restore entitlement merely for timeout or unknown result. Confirm terminal failure and absence of issuance first.
- When issuance is definitively unsuccessful, offer safe **same-order retry without a second 10 XLM** or approved refund to a verified destination. Refunds require authorized Treasury signing, amount/fee disclosure and a unique auditable refund reference. Do not silently treat irreversible network fees as reimbursed.
- Account for expired orders, wrong network, underpayment, overpayment, wrong destination/memo, unsupported sender, payment after expiry, repeated user actions and malicious replay. Such cases require explicit reconciliation or refund policy, never automatic asset issuance.
- Store durable append-only audit evidence for orders, payment verification, attempt identities, confirmation, refunds and owner actions. No financial operation may be triggered merely by visiting a GET page.

## Abuse prevention
- No free Mainnet quota to bypass by rotating wallets. Bind authenticated user, wallet and order; apply reasonable rate limits to order creation, wallet proof, and failed payments.
- Reserve unique asset codes safely per issuer and release only when definitively unused; do not allow failed or ambiguous orders to lock names forever or allow conflicting issuance.
- Protect signing/issuance and Treasury boundaries, require fixed allowable amount and approved asset settings; monitor bursts, automation and duplicate payment identifiers.
- Never require invasive identity proof solely to enforce a nonexistent free quota. Escalate suspicious volume conservatively.

## Acceptance gates before any Mainnet launch
1. Independently verified Treasury public key, configured Mainnet passphrase, and secure signer authority; no secret exposed.
2. Tests for successful first/second paid issue at 10 XLM, no free path, wrong network/memo/amount, double-click, concurrent orders, delayed payment, ambiguous responses and exact on-chain reconciliation.
3. Tests for no duplicate charging/issuance, terminal failure same-order retry and controlled refunds.
4. User-facing exact price, fee/reserve distinction and plain-language state changes.
5. Explicit owner approval for Mainnet activation after independent code/security review and observed Testnet rehearsal.

## Delivery status
**Documentation only.** No payment API, migration, issuance integration, Treasury, signer, deployment or Mainnet transaction is approved or represented as finished here.
