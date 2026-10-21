# Orrylo — Clean MVP Source of Truth

Status: **Active rebuild scope / requirements**, not proof of a functioning replacement.

## Purpose
Orrylo is a Stellar project platform: **Create → Publish → Manage → Grow**. The first deliverable is one real end-to-end customer-created Stellar Testnet token through Orrylo, then verified and shown accurately in the UI.

## Initial customer journey
Open Orrylo → connect Albedo → enter asset details and initial supply → confirm request → verify wallet, signer and trustline preconditions → safely sign and submit → independently verify exact on-chain outcome → display token, issuer, transaction hash and explorer reference.

## Product boundaries
- The Shared Issuer is Orrylo infrastructure; explicitly disclose that it is not user-owned.
- Shared asset identity is `asset code + issuer`, and codes must not collide under that issuer.
- A durable project identifier must be distinct from changeable public URL/slug and issuer metadata location.
- RYLO is a separate asset/issuer and is **not** part of the first creation flow.
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
For customer-created Mainnet assets, **there is no free creation quota**: each creation, including the first, is priced at **10 XLM** payable on Mainnet only. Launch RYLO rewards are **suspended pending separate review**. The binding requirements for order/payment verification, safe recovery/refunds, abuse protection and activation tests are in [MAINNET_PRICING_POLICY.md](MAINNET_PRICING_POLICY.md). This is product policy, not permission to enable Mainnet processing, modify signers or send transactions. The current Testnet path remains unaffected.

## Deferred but discoverable
RYLO minting, rewards, sales, liquidity, complex issuer multisig/governance, Dedicated Issuer contract control, Soroban templates, Mainnet provisioning, custom-domain automation and speculative anti-abuse infrastructure are outside the first milestone. Existing approved policy and implementation evidence remain in the permanent legacy branch for explicit reevaluation when needed.

## Source precedence
Current rebuild code/tests and reproducible deployment facts govern implementation status. This file governs initial product intent; technical layout is in `ARCHITECTURE.md`, milestone gates in `ROADMAP.md`. Historical policies and the unmodified predecessor remain in `legacy/pre-rebuild`.

No live signing, funding, key handling, issuer configuration, migration to shared databases, or mainline promotion is authorized by this document.
