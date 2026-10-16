# Orrylo Open Decisions — v1

Status: **Unresolved by design**

This file lists questions that remain intentionally open. Items already approved in the canonical source of truth or RYLO policy must not be reintroduced here as unresolved.

## RYLO economics and market operations

Decided:

- hybrid minting with a hard cap;
- maximum supply: 100,000,000 RYLO;
- initial mint: 0 RYLO;
- approved mint sources: Direct Purchase shortfall, Reward, Bootstrap Liquidity;
- direct sale price: 1 RYLO = 0.1 XLM;
- service-spent RYLO returns to Treasury and is not burned;
- Treasury-first direct-sale distribution;
- XLM payments for direct Orrylo sales of RYLO are received by the separately approved Mainnet TREASURY account, not OPERATIONS; delivery remains gated on verified, order-bound payment evidence;
- 150 RYLO first-successful-token launch reward;
- 50 RYLO-equivalent non-tradable Free Build Credit;
- 60-day reward window from a fixed official launch timestamp;
- 3,000,000 RYLO Bootstrap Liquidity Reserve;
- initial liquidity deployment: 1,000 RYLO + 100 XLM;
- 2,999,000 RYLO remains undeployed reserve capacity after the initial deployment;
- authorized eligible users may trade with one another.

Still open:

- exact official launch timestamp;
- exact amount chosen for each future staged liquidity addition;
- exact pool/market deployment mechanism;
- exact service prices denominated in RYLO;
- whether additional non-launch reward programs are introduced later.

## Mainnet infrastructure account topology

Decided:

- The initial Orrylo-operated Mainnet infrastructure has **five distinct Stellar account roles**: **RYLO ISSUER (ORRYLO)**, **SHARED ISSUER (ASSETS)**, **TREASURY**, **OPERATIONS**, and **LIQUIDITY**.
- RYLO ISSUER authorizes/controls RYLO issuance and is separate from the customer Shared Issuer.
- SHARED ISSUER issues customer Shared Issuer-tier assets only, not RYLO.
- TREASURY holds RYLO inventory, XLM reserves and realized service revenue, and supplies policy-approved distributions.
- OPERATIONS is a limited-exposure operational funding/fee account, not the principal reserve or issuer account.
- LIQUIDITY holds Orrylo-managed liquidity allocation/pool positions and conducts only policy-approved liquidity operations.
- Signer A/B/C are key authorities, not automatically three additional Stellar accounts; confirmation services and DB roles are not Stellar accounts; customer wallets and Dedicated Issuer accounts are outside the five-account count.
- The Mainnet account-role decision does **not** approve a specific public key, imply any Mainnet deployment or funding, or change existing RYLO Treasury-first, sale, mint or liquidity economics.
- Mainnet signer topology is approved: 2-of-3 for RYLO ISSUER, SHARED ISSUER, TREASURY and LIQUIDITY; a single isolated operational signer with limited working balance for OPERATIONS, alongside a separate recovery/rotation procedure. Existing RYLO routine A+B and recovery-only C restrictions continue to apply.
- Protected Treasury transfers and liquidity deposits/withdrawals require independent authorization. Pool withdrawal remains subject to actual pool rules and does not guarantee recovery of originally deposited XLM.
- The owner must explicitly approve each future account/key/funding/authority/finance activation step and securely retain secrets, hardware/offline backups, custody and recovery information outside GitHub and chat. At each owner-action gate, execution runbooks must clearly identify the exact manual action, public information to verify and secret material to safeguard.

Still open:

- Exact secure settlement coupling between confirmed XLM receipt at TREASURY and RYLO delivery, including payment verification, order-bound idempotency, failed/partial payments, delayed delivery, refunds and recovery.
- Actual Mainnet public keys, activation/funding amount and order for each role. The two branded issuer addresses remain reserved candidates only.
- Concrete signer public keys, custody technologies, per-operation threshold weights, master-key treatment, flags, recovery ceremonies and independent operators remain open despite the approved overall signer topology.
- Operations wallet funding limits, monitoring, replenishment and enforceable constraints (limited funds are not a native Stellar spending cap).
- Operational XLM limits, transfers/approvals and fee payment/sponsorship rules.
- Treasury/LIQUIDITY movement permissions and exact custody/pool-position handling.
- Security-reviewed Mainnet setup, audit and emergency runbooks; no Mainnet actions are authorized by the architecture decision.

## RYLO eligibility and authorization

Decided:

- first successful token creation is the approved v1 token-creation eligibility path;
- eligibility is wallet/public-key bound and permanent by default;
- eligibility and trustline authorization are separate;
- routine admin revocation is not allowed;
- exceptional security/legal revocation is the only intended revocation category;
- AUTH_REQUIRED is on;
- AUTH_REVOCABLE is on;
- AUTH_CLAWBACK is off;
- authorized eligible wallets may transfer/trade RYLO;
- issuer authorization is executed through a protected issuer-signing path rather than browser-side authority.

Still open:

- exact exceptional revocation criteria and governance/process;
- whether product purchase becomes an additional eligibility path in v1;
- exact shutdown behavior if the authorization service is unavailable.

## RYLO issuer security and governance

Decided:

- 2-of-3 multisig;
- Operational signer, Owner/policy co-signer, and offline Recovery signer;
- master key excluded from routine app/backend operation;
- routine authorization remains two-signature;
- Signer B independently validates canonical transactions against policy;
- issuer workflows use idempotent request IDs and append-only audit records;
- security/financial audit retention target is 2 years;
- operational debug-log retention target is 90 days;
- the Testnet issuer is
  `GDNSIP2SKNJIKN6IG3XZBQMHIKKDET25J33F4R5V6DALKHIUDTVZOPKX`;
- the Testnet signer identities A/B/C are fixed to the public keys recorded in
  `RYLO_POLICY.md`;
- the final Testnet account mapping is
  `Master=0, A=1, B=1, C=1, low=2, medium=2, high=2`;
- routine protected Testnet operations use A+B;
- A+C or B+C is recovery-only;
- Master remains at weight 1 during initial configuration;
- after A/B/C and the intended thresholds are configured, the routine A+B path
  must be successfully tested and proven;
- only a successful A+B test satisfies the prerequisite for Master weight 0;
  testing A+C or B+C does not satisfy that prerequisite.

Still open:

- concrete key-management technology/provider for each signer;
- concrete recovery-ceremony implementation details;
- concrete signer-rotation procedure;
- exact master-key storage mechanism;
- exact infrastructure for the independent Signer B service;
- upgrade/emergency governance not already constrained by the no-hidden-backdoor rule.

## RYLO mint/reward implementation

Decided:

- no arbitrary admin/manual/marketing/developer/emergency mint in v1;
- Direct Purchase mint is shortfall-only after Treasury inventory;
- first-token reward is 150 RYLO;
- each wallet may receive that reward at most once;
- reward/mint retries must be idempotent;
- first-token eligibility/reward preparation uses one PostgreSQL transaction,
  database uniqueness, durable qualifying-event evidence, and inactive
  workflow/protected-operation intents;
- supply-cap verification is mandatory.

Still open:

- exact definition/evidence event for “successful token creation” before the reward is released;
- exact on-chain transaction construction and submission implementation.

## Immediate Testnet MVP Lite — execution decisions and sequencing

**Approved 2026-10-12:** First delivery milestone is one real end-to-end customer Shared Issuer asset issuance on Testnet, *not* the entire RYLO economy/reward/liquidity demonstration. This does not alter approved RYLO eligibility, 150 RYLO reward, timing, issuer control, mint/supply economics, or any Mainnet rules. Mainnet and full RYLO ecosystem demonstrations remain separate later work.

**Owner-approved bounded Testnet MVP Lite execution decisions (Issue #43, 2026-10-12):**
- create one new random dedicated **Testnet Shared Issuer** for the demonstration; never reuse the RYLO issuer and do not implicitly activate the reserved `GBR7...ASSETS` candidate;
- bounded Testnet issuer flags: `AUTH_REQUIRED=OFF`, `AUTH_REVOCABLE=OFF`, `AUTH_CLAWBACK=OFF`, `AUTH_IMMUTABLE=OFF`;
- one isolated Testnet signer with Master weight 1 and low/medium/high thresholds `1/1/1`; no multisig requirement for this bounded demonstration;
- issuance destination must equal the authenticated Albedo owner's Stellar account;
- issuer funding is manual; the customer brings a funded Testnet wallet and pays its own trustline reserve/fee; no sponsorship or automatic XLM funding;
- authoritative confirmation uses direct official Stellar Testnet Horizon exact-transaction-hash lookup behind the reviewed reader abstraction.

These decisions approve policy only. They do **not** authorize account creation/funding, secret generation/import/storage, signer deployment, account mutation, trustline creation, transaction signing/submission, or Mainnet action.

**Resolved 2026-10-14 — bounded Testnet signer/custody technology for the first MVP issuance:**
- use a separate private Railway signer service for the first Testnet MVP issuance;
- the signer service has no public-domain dependency and is called only through Railway private networking;
- the web application sends only the already-authorized transaction hash and unsigned XDR through the existing `SharedIssuerSigningPrimitive` boundary;
- the signer independently pins Testnet, verifies the exact configured non-RYLO/non-reserved Shared Issuer, recomputes the transaction hash, requires an unsigned envelope, and signs once;
- the Stellar signer secret is scoped only to the signer service and must never enter the web application, database, browser, GitHub, logs, or chat;
- a distinct request-authentication secret is shared only by the web application and signer service;
- the signer has no database authority, no Horizon submission capability, and no automatic retry;
- PR #57 implements this approved architecture in code; implementation is not deployment evidence;
- this approval is Testnet-only and does not authorize deployment, real secret provisioning, real signing/submission, or any Mainnet/RYLO action;
- Mainnet signer/custody decisions and the broader RYLO signer architecture remain separate and unchanged.

**Still open / owner-gated before live activation:**
- exact public key of the newly created Testnet Shared Issuer and evidence that the approved flags/thresholds are actually configured;
- actual provisioning/deployment of the approved private Railway signer and its service-scoped secret material;
- the actual authenticated customer wallet selected for the first issuance and its existing exact trustline readiness;
- safe bounded activation procedure and Security approval for the real demonstration;
- practical server-side rate limiting and abuse controls for broader public creation, without an unapproved wallet allowlist.

**Minimal delivery gates:** Full-stack owns app UI/server intent flow; Stellar/Contract owns issuer account/configuration, transaction construction/signing/trustline boundaries; Security/Enablement owns adversarial verification, proof/unknown-outcome/DB privilege gates; Product Architect coordinates critical path and obtains owner decisions. No agent may treat a draft PR, UI preview, Project Profile save or Testnet preparation as completed issuance. Detailed bounded work belongs to agent PRs/issues; do not open unrelated features before the first real Testnet issuance evidence.

## Shared Issuer

Decided:

- customer Shared Issuer must be separate from the RYLO issuer.

Reserved candidate:

`GBR7SEZD4ITXQPAWEVBX2BULS76ERDRTRMIS3LUYKZ7DNLGZZ6ASSETS`

This remains a reserved candidate only, not deployment evidence.

Still open:

- whether the reserved candidate becomes the final **Mainnet/production** Shared Issuer public key;
- final Mainnet/production account authorization flags and custody;
- detailed lifecycle rules beyond the bounded Testnet MVP Lite policy above;
- exact metadata schema.

### Shared Issuer creation/reservation policy — approved boundary and remaining decisions

Decided:

- public Testnet creation is available to any authenticated supported wallet, without a preapproved wallet allowlist;
- asset-code reservation is an internal part of a confirmed real creation order, not a standalone user-facing feature;
- issuer-scoped atomic uniqueness and owner-scoped idempotency are mandatory;
- abandoned/cancelled/failed orders can release reservations only after authoritative proof that no issuance was submitted or could have succeeded;
- ambiguous or potentially successful submitted transactions must remain reserved until conclusive ledger reconciliation; confirmed issuance must never be released as if the asset identity were unused;
- release/cancellation and rejected/limited attempts require auditable, server-authorized controls; multi-wallet abuse must be addressed beyond per-wallet quotas;
- full immutable issuance intent and fingerprint are an **immediate P0 Testnet MVP Lite pre-signing gate**, not inferred from reservation data; no signing or submission is allowed until that complete intent is durably committed and independently reviewed.

Still open (must not be silently selected by implementation):

- exact automatic-expiry duration, if automatic expiry is adopted;
- concrete server-side rate limits, quotas, and multi-wallet abuse mitigation;
- reviewed reclamation mechanism, cancellation authority, and ledger-evidence requirements for release;
- policy for reservation handling on project ownership transfer;
- final Mainnet/production Shared Issuer identity, flags, custody and execution policy; the bounded Testnet MVP Lite A–F decisions above are already approved.

## First usable Testnet token-creation UX and supply

Decided:

- The first genuinely usable public Testnet creator must allow the user to **choose the initial issuance supply**, not merely enter a token name/code or save a draft.
- Minimum creator experience includes display name, Stellar asset code, positive precise initial amount, safely validated logo and description, truthful issuer/authority disclosure, pre-confirmation review, and independently verified creation status.
- Initial supply is server-authoritatively and immutably bound to request, full issuance intent, transaction attempts and on-chain confirmation; retries cannot change the amount.
- Initial issued supply is distinct from an enforceable lifetime max supply. The product design may explain Fixed Supply and Mintable, but those modes must remain disabled/unavailable for execution until the selected tier can actually and verifiably enforce them; no false promise under an unrestricted Shared Issuer.
- Max Supply/Capped and advanced control templates are not first-release executable promises.
- Successful Testnet product acceptance requires actual on-chain issuance matching the user-approved amount, issuer and destination, not mere project creation.

Still open:

- Exact acceptable UI supply range/defaults (if any), beyond native Stellar precision and amount bounds.
- Final first-issuance destination and customer authorization/trustline semantics.
- Which asset-control modes can actually ship on the Shared Issuer tier, and enforcement/review evidence for any Fixed/Mintable control.
- Metadata image storage/validation/publishing implementation and precise required-field constraints.
- Detailed feature-tier presentation, pricing and promotion criteria.
- Real Testnet execution/confirmation/abuse and release controls remain separate activation gates.

## Dedicated Issuer templates

The Contract-Controlled Issuer model is selected.

Still open:

- exact first set of templates;
- Fixed Supply implementation;
- Capped Supply implementation;
- Mintable implementation;
- Governed implementation;
- ownership-transfer mechanics;
- contract upgrade model.

## Application persistence and auth production-readiness

Decided / implemented on current `main`:

- Albedo server-verified wallet authentication;
- shared PostgreSQL persistence for authentication challenges and sessions;
- atomic challenge consumption;
- durable server-side sessions;
- generic durable workflow/idempotency foundation;
- append-only tamper-evident audit foundation.

Still open before broad public production:

- rate limiting and request-abuse controls;
- body/request limits at infrastructure level;
- final production origin/cookie hardening;
- activation and production hardening of the merged eligibility/reward/protected-operation foundations, including the still-unresolved trusted successful-token event producer.

## Pricing

The RYLO direct sale price is decided separately from Orrylo service pricing.

Still open:

- exact production prices for token creation and other Orrylo services;
- RYLO-denominated service price schedule.

## Domains and hosting

Target domain architecture is decided conceptually.

Approved first-prototype application baseline:

- Railway for app/backend hosting;
- Neon Free for PostgreSQL;
- Cloudflare Free for DNS/CDN.

Stellar Testnet remains the currently recorded engineering/deployment-evidence environment and must stay reproducibly bootstrappable. The immediate delivery priority is Testnet MVP Lite customer Shared Issuer issuance. Mainnet preparation is separate and Mainnet deployment remains unproven until explicit repository/on-chain deployment evidence exists.

These are prototype choices, not permanent production-provider commitments.

Decided for the first prototype:

- the public prototype application is served directly from `orrylo.com`;
- `app.orrylo.com` is not required for the prototype.

Still open:

- final production deployment provider configuration;
- exact DNS/wildcard setup beyond the prototype root-domain deployment;
- custom-domain onboarding flow;
- whether every dedicated asset receives a subdomain automatically in v1.

## Wallet support

Albedo is the initial wallet and the authentication slice is implemented.

Still open:

- whether v1 supports only Albedo;
- order and scope of additional Stellar wallet integrations.

## Anti-abuse

Dedicated anti-Sybil protections are intentionally deferred.

This does not mean abuse is permanently accepted. It means no extra anti-Sybil architecture should be invented without evidence or an explicit product decision.

## Legal / compliance

Jurisdiction-specific legal treatment of direct RYLO sales, controlled eligibility, rewards, secondary trading, service-credit characterization, and exceptional authorization revocation has not been finalized.

Do not make legal/compliance claims from architecture assumptions.
