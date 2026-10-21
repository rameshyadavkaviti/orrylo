# Orrylo — Clean MVP Source of Truth

Status: **Active rebuild scope / requirements**, not proof of a functioning replacement.

## Purpose
Orrylo is a Stellar token-creation platform. The approved core product story is **connect a pre-funded wallet → pay 10 XLM → create the first token → verify and show the real result**. A first token is **not free**. Each subsequent distinct Mainnet token creation also costs 10 XLM. The payment-enabled Mainnet path is a product target, not an assertion of live availability.

## Primary user journey (product truth)
1. User arrives with an existing, sufficiently funded Stellar wallet; Orrylo does not require wallet creation or funding as part of the primary journey.
2. User connects/authenticates the wallet and enters the new token's details.
3. Orrylo shows the exact 10 XLM service price, network and any separate Stellar reserve/transaction requirements.
4. User explicitly authorizes a uniquely bound **Mainnet** payment of 10 XLM to the verified Treasury destination.
5. Once the payment is independently confirmed, Orrylo creates the token safely exactly once, verifies the on-chain result and automatically publishes the project/metadata where supported.
6. User sees the confirmed asset, issuer, amount, transaction and project page; failures or unknown outcomes are reconciled without duplicate charging or blind reissuance.

This is the approved Mainnet business journey. **Existing Testnet issuance must remain functional and does not collect real XLM.** No Mainnet activation, Treasury provisioning or live financial action is authorized merely by this description.

## Product boundaries
- The Shared Issuer is Orrylo infrastructure; explicitly disclose that it is not user-owned.
- Shared asset identity is `asset code + issuer`, and codes must not collide under that issuer.
- A durable project identifier must be distinct from changeable public URL/slug and issuer metadata location.
- RYLO is **out of scope** for the active product, onboarding, pricing, payment and rewards. Historical RYLO policy is not active product authority. Do not infer an RYLO dependency or reintroduce it without a new explicit owner decision.
- No fictitious token creation, unverifiable publication claims or implied Mainnet deployment.

## Minimum security invariants
- No issuer secret in browser, normal web backend, source control, logs or database.
- User authentication and ownership of requests are server-verified.
- Full exact network/issuer/code/amount/destination issuance intent is committed before signing; idempotent requests do not issue twice.
- Verify receiving wallet trustline, current issuer and signer identities, network, signing policy and transaction contents.
- Signing access is isolated and scoped. Do not change actual issuer/account authority without owner authorization.
- A timeout or unknown submission must be reconciled on Stellar, not blindly retried or released as unused.
- A successful API response or local database status cannot substitute for signed transaction/ledger evidence.
- Only confirmed exact ledger data may produce an issued/publication claim.

## Approved future Mainnet pricing (not activated)
For customer-created Mainnet assets, **there is no free creation quota**: each creation, including the first, is priced at **10 XLM** payable on Mainnet only. No RYLO rewards, purchases, trustlines or other RYLO steps are part of the active customer journey. The binding requirements for order/payment verification, safe recovery/refunds, abuse protection and activation tests are in [MAINNET_PRICING_POLICY.md](MAINNET_PRICING_POLICY.md). This is product policy, not permission to enable Mainnet processing, modify signers or send transactions. The current Testnet path remains unaffected.

## Deferred but discoverable
RYLO-related features and historical economics are excluded from active scope. Complex issuer multisig/governance, Dedicated Issuer contract control, Soroban templates, Mainnet provisioning, custom-domain automation and speculative anti-abuse infrastructure are deferred. Historical material is retained only as archival reference, not active requirements. Existing approved policy and implementation evidence remain in the permanent legacy branch for explicit reevaluation when needed.

## Source precedence
Current rebuild code/tests and reproducible deployment facts govern implementation status. **This file is the canonical source for current product intent and takes precedence over previous conversation decisions, assistant recollections, and historical RYLO policy.** Technical layout is in `ARCHITECTURE.md`, milestone gates in `ROADMAP.md`, and payment safety requirements in `MAINNET_PRICING_POLICY.md`. Current code/tests and verifiable deployment facts determine what is actually implemented. Historical policies and the predecessor remain in `legacy/pre-rebuild` as archive only.

No live signing, funding, key handling, issuer configuration, migration to shared databases, or mainline promotion is authorized by this document.
