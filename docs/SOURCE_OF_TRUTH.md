# Orrylo Source of Truth — v1

Status: **Canonical architecture definition / contract interface implementation**

This document records the decisions currently considered authoritative for Orrylo. Anything not marked as decided here, or explicitly delegated to another canonical document, must be treated as unresolved.

## 1. Product identity

- Company / platform: **Orrylo**
- Ecosystem utility token: **RYLO**
- Primary network: **Stellar**
- Initial wallet login target: **Albedo**

Orrylo is not merely a Stellar token generator. Its core product lifecycle is:

```
Create → Publish → Manage → Grow
```

Token creation is the beginning of a persistent Orrylo project lifecycle, not the end of the workflow. A user should be able to create a Stellar token/project and continue managing and developing that project from Orrylo afterward.

The broader product direction also includes contract-controlled token infrastructure, higher-level product creation, custom development, and supporting infrastructure on Stellar.

## 2. Product boundary

The first product family may expose services such as:

- token creation;
- dedicated issuer infrastructure;
- contract deployment;
- token-to-product upgrades;
- website / product development;
- custom Stellar infrastructure.

RYLO is intended to be the primary internal payment and membership asset for these services, but it is a secondary ecosystem/member benefit rather than the primary reason a user enters Orrylo.

### 2.1 Persistent Project Profile

Every Orrylo-created project is intended to have a persistent managed Project Profile.

The Project Profile is Orrylo's authoritative application-level representation of the project. It may expose appropriate editable project metadata over time, including display name, description, logo/image, project links, social/community links, and contact/project information.

Editable project metadata must remain distinct from immutable or Stellar-constrained asset identity/state. The exact database schema and final mutability rules are not yet locked.

The Project Profile is the common managed source for published/product representations such as:

```
Project Profile
→ Orrylo Dashboard
→ Public Landing Page
→ stellar.toml / metadata publication
→ explorer-facing metadata
```

These outputs must not become independent conflicting sources of truth.

### 2.2 Publication and identity invariant

The following separation is a canonical architecture invariant:

**Project Identity ≠ Public URL ≠ Metadata Hosting**

- **Project Identity** is represented by a stable internal project identifier (`project_id` or equivalent). It must not depend on the current slug, public URL, domain, metadata host, or hosting provider.
- **Public URL** is a presentation/publication concern. For the MVP, the approved public project route is `orrylo.com/p/<slug>`. The slug is human-readable routing state, not the project's fundamental identity.
- **Metadata Hosting** is a separate Stellar publication concern. `stellar.toml` and related issuer metadata must not be coupled to `/p/<slug>`.

The architecture must allow a public project page to evolve from:

```
orrylo.com/p/nova
→ nova.orrylo.com
→ novatoken.com
```

without recreating the project or changing its internal identity. Old public routes should be able to use permanent redirects when publication locations move.

Changing a landing-page hostname, slug, custom domain, or hosting provider must not implicitly move or redefine Stellar metadata hosting.

## 3. Asset issuance tiers

### 3.1 Shared Issuer

The low-cost / free tier uses one Orrylo-controlled shared Stellar issuer for multiple user-created assets.

Rules:

1. Shared Issuer must be disclosed clearly before and after creation.
2. A shared issuer must never be represented as user-owned or dedicated.
3. Asset identity remains `asset code + issuer`.
4. Asset codes must be unique within the shared issuer.
5. Shared assets inherit the issuer account's single `home_domain`.
6. Shared asset metadata is expected to be served from a shared domain such as `assets.orrylo.com`.
7. The RYLO issuer must not be reused as the Shared Issuer for user assets.

The Shared Issuer may use a branded vanity address if convenient, but a random Stellar address is technically acceptable.

### 3.1.1 Approved Shared Issuer creation/reservation lifecycle (Testnet)

- Public Testnet token creation is open to any authenticated supported Stellar wallet; no preapproved wallet allowlist is required.
- Asset-code reservation is an internal, issuer-scoped step of a genuine token-creation order, **not** a standalone user-facing reservation product. The user experiences one continuous Create flow.
- Create a reservation only when the user explicitly confirms a real token-creation request, not merely when viewing a form, entering an asset code, connecting a wallet, or saving an editable draft.
- Use durable, atomic issuer-scoped uniqueness and owner-scoped idempotency. Concurrent requests for the same issuer + asset code must not create competing issuance rights.
- Pending, abandoned, cancelled, or failed orders may release an asset code **only after authoritative evidence proves no issuance transaction was submitted or could have succeeded**. Application failure status alone is not sufficient proof.
- Once any transaction may have been submitted, including unknown/timeout outcomes, hold the reservation until authoritative ledger reconciliation resolves the outcome. Never automatically release an ambiguous, potentially successful, or confirmed on-chain issuance. Releasing an application reservation must never imply that an issued Stellar asset ceased to exist.
- Reservation cancellation/release must be an auditable, concurrency-safe, ownership-authorized server operation. Retain historical reservation and audit evidence; prevent stale requests or replays from reviving released authority.
- Apply server-side abuse controls to creation attempts and outstanding incomplete orders; one-outstanding-order-per-wallet is not sufficient against multi-wallet squatting. Log rejected/limited attempts for security monitoring without allowing them to mutate issuance authority.
- A release must not enable another order until all submission/ledger uncertainty has been conclusively excluded. Full immutable issuance intent (including destination and amount) must be durably committed and verified before any future signing/submission is enabled; a reservation fingerprint is not a transaction fingerprint.
- **No automatic expiry duration, specific rate-limit quota, mandatory payment/deposit, identity verification, or anti-Sybil requirement is approved by this decision.** These parameters and a safe operational reclamation mechanism require separate review. Do not invent them in PR #28.
- This is approved product policy, not evidence that the current application implements safe release, signing, submission, or ledger confirmation. PR #28 remains blocked pending Security review and PR #19 combined integration verification.

### 3.2 Dedicated Issuer

The premium tier provides dedicated asset infrastructure per customer/project.

The selected architecture is **Contract-Controlled Issuer** rather than simply handing over a raw issuer secret key.

The contract/policy layer may govern:

- mint;
- burn;
- maximum supply;
- administrative actions;
- control transfer;
- authorization;
- upgrade policy.

Dedicated assets may receive distinct subdomains such as `tokenname.orrylo.com`, and may later support a user-owned custom domain.

## 4. Core trust model

Orrylo should prefer verifiable rules over trust promises.

Preferred evidence:

- on-chain state;
- contract rules;
- public addresses;
- explicit permissions;
- verifiable supply;
- published issuer/control policy.

Avoid architecture that depends primarily on:

- hidden database state;
- undisclosed admin powers;
- unknown issuer keys;
- unverifiable supply claims.

## 5. No hidden backdoor rule

If an asset is represented as contract-controlled, capped, fixed-supply, or user-controlled, Orrylo must not retain an undisclosed alternate path that defeats that claim.

Examples:

- A declared max supply must not be bypassable by a hidden issuer key.
- A transferred control right must not secretly remain recoverable by Orrylo.
- A fixed-supply asset must not retain an undisclosed mint path.

Any intentionally retained admin capability must be explicit and verifiable.

## 6. Secret-key minimization

Orrylo should minimize long-lived custody of customer issuer secrets.

Target lifecycle:

```
Generate issuer
→ configure asset
→ deploy/configure contract
→ transfer intended control
→ remove unnecessary issuer authority
```

Secrets must never be committed to the repository or logged.

## 7. RYLO

RYLO is the Orrylo ecosystem utility token.

Current intended roles:

- platform payment;
- service credit;
- ecosystem membership;
- rewards;
- member-to-member trading.

RYLO is not currently positioned as an investment product.

Detailed rules are canonical in [RYLO_POLICY.md](RYLO_POLICY.md).

## 8. Eligible-member model

For the approved v1 token-creation path, a wallet becomes RYLO-eligible after the user's **first successful token creation** through Orrylo.

Current membership principle:

**One-time builder → ecosystem member.**

Eligibility rules:

- eligibility is bound to the Stellar wallet/public key;
- eligibility is permanent by default;
- zero RYLO balance, selling all RYLO, inactivity, or disconnecting the wallet do not remove eligibility;
- eligibility and Stellar trustline authorization are separate states;
- routine discretionary admin revocation is not part of v1;
- revocation is reserved for an explicitly defined exceptional security/legal policy.

Any additional product-purchase path to eligibility must be specified separately before implementation.

## 9. Launch build credit and reward window

The approved launch flow is:

```
User joins
→ receives 50 RYLO-equivalent Free Build Credit
→ successfully creates first token
→ becomes eligible
→ RYLO trustline is authorized
→ receives 150 RYLO reward if the launch-reward window is still open
```

Rules:

- Free Build Credit is an internal Orrylo service credit, not minted RYLO;
- it is not transferable or tradable;
- the first-token reward is **150 RYLO**;
- the reward window lasts **60 days** from a fixed official launch timestamp;
- after that window, successful creation may still establish eligibility, but does not automatically earn the launch reward;
- each wallet may receive the first-token-creation reward at most once;
- anti-Sybil controls remain deferred for v1 unless evidence requires them.

## 10. RYLO supply, sale, treasury, and liquidity

Approved economics:

- maximum supply: **100,000,000 RYLO**;
- initial mint: **0 RYLO**;
- direct Orrylo sale price: **1 RYLO = 0.1 XLM**;
- service-spent RYLO is returned to the Orrylo Treasury and is **not burned**;
- direct sales use Treasury inventory first and mint only an approved shortfall;
- the Treasury has no separate balance cap beyond the global RYLO supply rules;
- eligible/authorized members may transfer and trade RYLO with one another;
- a **3,000,000 RYLO Bootstrap Liquidity Reserve** is approved as the lifetime policy cap for Orrylo-managed bootstrap liquidity capacity;
- initial liquidity deployment is **1,000 RYLO + 100 XLM**;
- the remaining **2,999,000 RYLO** is undeployed reserve capacity and does not need to be minted in advance;
- additional liquidity is **manual, staged, and revenue/capital-backed** rather than automatic or time-scheduled;
- each additional liquidity operation must use real available XLM, remain within the 3,000,000 RYLO reserve cap, use a protected operation with `request_id` and `policy_version`, and produce append-only audit evidence;
- the ordinary public application backend must not independently execute liquidity additions;
- the previously considered idea that users could acquire additional RYLO only from Orrylo is rejected and is not policy.

Approved v1 mint sources are limited to:

1. Direct Purchase shortfall mint;
2. Reward mint;
3. Bootstrap Liquidity mint.

No manual/admin/marketing/emergency/developer mint path is approved for v1.

The direct sale price must not be described as intrinsic value, guaranteed market value, guaranteed resale value, or guaranteed future value.

### 10.1 Approved five-account Mainnet infrastructure model

The product owner approved **exactly five persistent Orrylo-operated Stellar account roles** for the initial Mainnet architecture. This is a **role/topology decision**, not evidence that five accounts have been created, funded, deployed, assigned signer keys, or authorized on Mainnet.

| Role | Primary responsibility | Authority boundary |
| --- | --- | --- |
| **RYLO ISSUER (ORRYLO)** | Issuer and on-chain authorization policy for RYLO only. | Separate from all customer issuers; follows the separately approved protected RYLO signer/2-of-3 policy. Not the day-to-day revenue or liquidity wallet. |
| **SHARED ISSUER (ASSETS)** | Issue Shared Issuer-tier customer assets under one explicitly approved issuer identity. | Never issues RYLO; separate signing/custody from the ordinary web application. Exact account identity, flags and signer thresholds still require approval. |
| **TREASURY** | Hold RYLO inventory, XLM reserves and realized service revenue; make policy-approved RYLO transfers and treasury allocations. | No independent RYLO mint authority; no unrestricted application-initiated withdrawals. |
| **OPERATIONS** | Limited working XLM for ordinary network fees and explicitly approved day-to-day operational funding/transactions. | Small capped exposure and scoped transaction permissions; no issuer keys or custody of primary treasury reserves. Exact limits still require approval. |
| **LIQUIDITY** | Custody Orrylo-managed liquidity allocations and any relevant pool positions/share balances; coordinate approved RYLO/XLM liquidity operations. | No issuer or treasury mint authority; no automatic funding from Treasury; each liquidity operation remains protected, manual/staged and auditable under section 10. |

**Scope/counting rules:**

- These five roles are five distinct **Orrylo infrastructure Stellar accounts** for Mainnet; a single account must not silently serve multiple roles.
- **Signer A / B / C are signing keys/authorities, not automatically three additional Stellar accounts.** Their independent custody and authorization still matter.
- The ledger confirmation verifier and database confirmation-writer are **off-chain services and separate database identities**, not Stellar accounts.
- Customer wallets, per-project Dedicated Issuer accounts, pools and network contracts are outside the five Orrylo infrastructure-account count.
- The previously reserved public-key candidates for ORRYLO and ASSETS remain **candidates, not approved or deployed Mainnet accounts**. Do not hardcode, fund or activate a candidate merely because its role is approved.
- Existing RYLO Treasury-first distribution, service-spend recycling, and protected liquidity policy remain authoritative; five-account separation does not change mint, supply, sale-price or liquidity rules.

**Approved direct-sale payment destination:** XLM paid for a direct Orrylo sale of RYLO must be sent to the explicitly approved Mainnet **TREASURY** Stellar account, not the OPERATIONS account. The destination must be independently checked against trusted server-side configuration and the correct network before a payment request is presented. This rule concerns direct Orrylo sales of RYLO only, not third-party customer-asset sales or other services. Receiving XLM does not by itself authorize RYLO delivery; require verified payment evidence, owner/order binding, amount and asset correctness, idempotent fulfillment and a reviewed recovery/refund path. No real-payment functionality is enabled by this policy approval.

**Not yet decided:** Exact payment/RYLO-delivery settlement mechanism and failure recovery; fee-funding/sponsorship flow; exact signer keys, account flags, per-operation thresholds, custody providers and recovery procedures; operational balance caps and transfer permissions; final public keys and Mainnet deployment sequence. The independently approved XLM payment destination is TREASURY for direct RYLO sales. No real-payment flow should activate until these decisions and settlement security are approved.

**Owner-managed manual setup and secure-record obligations (mandatory checkpoints before Mainnet activation):**

1. **Identity and funding checkpoint — owner action required.** Review and explicitly approve the intended public key, network, purpose, initial funding source and funding amount for each account before account creation/funding. Verify each account independently on the correct Stellar network. Never confuse a Testnet address/state with proof of Mainnet funding.
2. **Key-generation and custody checkpoint — owner action required.** Generate/import each required signer key using a reviewed, isolated mechanism. Keep secret seeds, recovery material and backups in a secure offline/hardware-backed location under owner control. **Never place secrets in GitHub, SOT, chat, tickets, screenshots, browser client code, app databases, build logs or environment examples.** Only public keys, non-secret configuration and independent validation evidence belong in repository documentation.
3. **Signer/authority checkpoint — owner explicit approval required.** Record the proposed signer public keys, weights, thresholds, account flags, master-key treatment, custody operators and recovery plan **without secrets**. Independently verify successful authorized signing/recovery paths before any irreversible master-key reduction or authority removal. The existing RYLO 2-of-3 policy is not automatically extended to other accounts without a decision.
4. **Finance/operations checkpoint — owner approval required.** Approve transfer limits, XLM payment destination, RYLO delivery/failure handling, Treasury/Operations/Liquidity movement policy, monitoring and emergency response before enabling purchase, payout or liquidity operations. Keep personal secure records of account-to-role mapping, signing-device locations, recovery custodians and protected ceremony instructions.
5. **Activation checkpoint — separate authorization required.** A reviewed runbook must remind the owner at the exact point of each manual action, what to verify, and what confidential data to safeguard. Require explicit approval before any Mainnet account mutation, funding, key/threshold/flag change, signing, transfer, pool operation or deployment. Documentation approval does **not** authorize those operations.

### 10.2 Approved Mainnet signing and recovery policy for five infrastructure accounts

The owner approves the **authorization topology** below for Orrylo's five distinct Mainnet infrastructure accounts. This is policy approval only; no signer key, threshold, custody device, account flag, transfer limit, or Mainnet account state is deployed or verified by this document.

| Account | Approved normal authorization | Recovery and exposure boundary |
| --- | --- | --- |
| **RYLO ISSUER (ORRYLO)** | **2-of-3**, preserving the separately approved RYLO policy: independent operational signer A plus independent policy co-signer B for routine protected actions; signer C is recovery-only. | Recovery-only use requires a documented owner-approved ceremony; issuer mint/authorization rules remain unchanged. |
| **SHARED ISSUER (ASSETS)** | **2-of-3** independent signing authorities for issuer operations, with a routine operational signer plus independent approval and a recovery signer. | An application order alone cannot authorize minting; signer verifies exact approved issuance and on-chain transaction independently. |
| **TREASURY** | **2-of-3** independent signing authorities for transfers, payouts and movements of reserves. | The ordinary public application may not unilaterally withdraw, sweep or redirect customer payments or Treasury funds. |
| **OPERATIONS** | **One active operational signer** for narrowly scoped daily operations and network-fee funding. | Maintain an independently secured recovery/rotation path and deliberately limited working balance. A low balance is a risk-control objective, **not** an on-chain spending cap; precise technical limits remain to be approved and enforced through custody, funding and monitoring design. |
| **LIQUIDITY** | **2-of-3** independent signing authorities for deposits, withdrawals, pool-share transfers and liquidity management. | Liquidity withdrawal may be requested when two authorized signers approve; withdrawal remains subject to the actual pool's liquidity/position rules, and the amounts of XLM and RYLO recovered are **not guaranteed** to equal amounts originally deposited. |

For the four 2-of-3 accounts, no single signing key may independently meet the thresholds governing protected operations. Signer C is reserved for recovery, not a shortcut for unattended daily operations. Signer identities for different accounts must have separately reviewed custody and trust boundaries; this decision does **not** permit silently reusing the same key across all accounts or automatically applying RYLO's exact Testnet signer identities to Mainnet.

**Owner manual-action and secure-record gates (mandatory before any actual Mainnet configuration):**

1. Independently approve and record **public** account identities, each signer public key, role, proposed weights/thresholds, account flags and intended master-key treatment. Verify all on the correct network. Do not treat the two reserved vanity addresses as deployed or approved.
2. Personally establish protected custody and multiple recoverable backups for all required **secret seeds**, hardware-wallet recovery phrases, access-control credentials and recovery-ceremony instructions outside GitHub, chat, source files, web forms, and ordinary application logs. No secret material is to be pasted into this project or reported to an agent.
3. Before a master-weight reduction or lockout-prone authority change, exercise and independently verify the authorized normal 2-of-3 path and the approved recovery procedure; arrange a separate owner-approved manual ceremony for irreversible changes. For RYLO, retain its already approved specific A+B-before-master-zero sequence.
4. Before activating OPERATIONS, approve a concrete funding cap, signer isolation, monitoring and replenishment procedure. Before enabling TREASURY or LIQUIDITY transfers, approve authorization workflow, audit record and emergency stop/recovery instructions; LIQUIDITY cannot automatically pull funds from TREASURY.
5. Every creation, funding, signer/threshold/flag mutation, transfer, liquidity withdrawal/deposit or activation requires a separate explicit owner authorization at execution time. This document **does not** authorize Mainnet transactions or secret generation.

**Still open (do not invent):** exact Mainnet keys and accounts; specific threshold numerical configuration for each operation class; flags/master-key changes; independent signer/custody providers and recovery operators; precise OPERATIONS balance/transfer limits and enforceable controls; Treasury payout and liquidity authorization implementation; emergency/recovery ceremonies and deployment order. The already-approved RYLO-specific policy overrides any general example here. The XLM receipt destination for direct RYLO sales is already approved as TREASURY, independently of this signing policy.

## 11. No investment section for v1

The first version must not introduce an official investment program such as:

- guaranteed returns;
- guaranteed yield;
- profit share;
- price-appreciation rewards;
- promises tied to future token price.

Any future financial/investment feature requires a separate product and legal review.

## 12. Prototype infrastructure baseline

The approved first-prototype infrastructure baseline is intentionally low-cost and provider-neutral at the application boundary:

- application/backend hosting: **Railway**, expected starting cost about **$5/month**;
- PostgreSQL: **Neon Free** initially;
- DNS/CDN: **Cloudflare Free**;
- Stellar engineering/deployment baseline: **Testnet** for the currently recorded issuer and contract preparation evidence;
- immediate execution direction: **Testnet MVP Lite customer Shared Issuer issuance**; Mainnet preparation remains a separate workstream, without treating any issuer, asset, SAC, or application flow as Mainnet-deployed until explicit deployment evidence is recorded;
- existing Orrylo domain: reused with no new prototype-domain purchase.

This is a **prototype deployment baseline**, not a permanent production-provider commitment.

The application must remain portable enough to move away from Railway, Neon, or Cloudflare if pricing, availability, sanctions/access, scale, security, or operational requirements change.

### 12.1 Immediate delivery milestone — Testnet MVP Lite (owner approved 2026-10-12)

**Priority P0: first real customer Shared Issuer token issuance on Stellar Testnet.** This is the next delivery milestone, not proof of a production-ready service or an instruction to bypass existing security gates. It is intentionally smaller than the RYLO ecosystem demonstration below.

The minimum end-to-end acceptance path is:

```
Authenticated Albedo wallet
→ project / asset identity and user-selected exact initial supply
→ owner-visible configuration and Shared Issuer authority review
→ explicit confirmed issuance request
→ immutable server-authoritative issuance intent and safe asset-code reservation
→ receiving account trustline / authorization readiness
→ authorized Testnet issuer signing and submission
→ authoritative ledger confirmation of correct issuer, asset, destination and amount
→ explorer-verifiable result and truthful persistent project status
```

- A genuine Stellar Testnet-issued customer asset must be visible through authoritative network evidence. A saved Project Profile, browser draft, simulated result or transaction hash alone is **not** acceptance.
- Scope is **Shared Issuer, Testnet, one minimal creation path only**. No Dedicated Issuer, production-grade token governance, RYLO liquidity/swap path, Mainnet funding, or five-account Mainnet execution is required for this milestone.
- Preserve the approved first-success eligibility / 150 RYLO reward policy and its financial/authorization/launch rules **unchanged**. Executing the reward, RYLO trustline/issuer ceremony and market liquidity is not a prerequisite for the *Lite customer asset issuance demonstration*. Do not falsely mark rewards as granted or silently change when eligibility legally/product-wise applies. Implementing deferred reward delivery requires separately reviewed policy-consistent evidence and scheduling; do not claim its live execution.
- Limit launch access to appropriately gated, explicitly authorized Testnet demonstration until the owner approves public availability and concrete abuse controls. This gate is **not** a wallet allowlist or new eligibility policy: approved public Testnet creation remains open to any authenticated supported wallet once safely launched.
- The receiving wallet must be technically able to hold the issued asset: explicit account / trustline and applicable authorization readiness, with no unapproved automatic account funding or invented default destination.
- Security minimums are mandatory: server-side auth and ownership, exact 7-decimal amount/int64 validation, immutable full intent before signing, issuer-scoped uniqueness, idempotent submission, forged-proof resistance, safe retry/unknown-outcome reconciliation, trusted independent ledger confirmation, protected signing/secrets, and honest status. PR #32's unresolved security blockers cannot be waived by a smaller MVP.
- No new pricing, signer identity, Shared Issuer account, flags, supply-control promise, rate limit, payment step or expiry rule is approved by this milestone. Resolve execution-critical open decisions with the appropriate owner before live actions.
- First prove a repeatable, authorized Testnet demonstration and record exact transaction/asset/network evidence; broader publicly available Testnet release remains subject to security, abuse and deployment gates.

**Delivery order:** (1) confirm minimum issuer / destination / trustline / signer decisions; (2) close issuance-proof blockers and persist immutable issuance intent; (3) connect the existing reviewed builder to one safe Testnet execution path; (4) demonstrate and independently verify a real result. Keep parallel Mainnet/RYLO economy, growth features and styling work outside the Lite critical path.

### 12.2 Later milestone — complete RYLO Testnet ecosystem demonstration

The **later RYLO ecosystem Testnet milestone** is considered complete when the real end-to-end path demonstrates:

```
Albedo wallet
→ application eligibility
→ RYLO trustline
→ issuer authorization
→ 150 RYLO reward
→ visible wallet balance
→ RYLO/XLM liquidity pool
→ successful market swap
→ durable audit evidence
```

Testnet bootstrap/deployment should be reproducible because Testnet state may be reset.

### RYLO Stellar Asset Contract visibility

For RYLO, deployment acceptance includes the Stellar Asset Contract (SAC) representation of the Classic Stellar asset.

Required evidence:

- deploy the SAC corresponding to the RYLO Classic asset on the target network;
- record and verify the resulting deterministic `C...` contract address;
- verify that StellarExpert's RYLO asset Summary exposes the field `Soroban Contract: C...`.

RYLO deployment must not be considered complete for the relevant network until this verification is recorded as deployment evidence.

This requirement does not redefine RYLO as a separate custom Soroban token. RYLO remains the Classic Stellar asset; the SAC is its Soroban contract representation.

## 13. Repository authority and agent execution

From this phase onward, **GitHub repository state is the operational source of truth for all Orrylo agents**.

Rules:

- every agent must fetch and reconcile current GitHub `main` before meaningful work;
- agents must read the canonical repository documents before relying on prior chat, memory, handoff text, or another agent's summary;
- chat context and handoff prompts are navigation aids only and must not override current repository state;
- current code, tests, migrations, CI, deployment evidence, and canonical documents determine implementation status;
- stale SHAs, copied policy text, or remembered project state must be revalidated against GitHub;
- if repository reality conflicts with a chat instruction, the agent must stop and reconcile the conflict rather than silently proceeding;
- completed decisions and implementation status should be written back to the repository so later agents can recover without depending on conversation history.

This rule exists specifically to prevent repeated debugging loops, duplicate implementation, stale-state recovery, and contradictory agent handoffs.

## 14. Prototype launch and UX objective

The immediate execution goal is to reach a **simple public prototype on the Orrylo domain as quickly as practical without bypassing correctness or security gates**.

The first public-facing experience should:

- communicate Orrylo's core idea to a new visitor within approximately **30–60 seconds**;
- require **Albedo wallet login from the beginning of the interactive prototype flow**;
- treat the authenticated wallet as the application identity and project-ownership boundary before token/project configuration is persisted or managed;
- do not present the current prototype as an anonymous-first builder flow;
- present a small number of obvious actions rather than a dense or unfinished dashboard;
- make the primary interactive paths easy to discover and test;
- clearly distinguish working prototype capabilities from unavailable or future capabilities;
- avoid fake on-chain completion or exposing half-implemented flows as if they were complete;
- be suitable for early promotion, user acquisition, and product feedback once the deployed prototype path is stable.

Prototype speed should come from constrained scope and clear UX, not from weakening security, data integrity, deployment evidence, or canonical policy.

## 15. Domain and publication architecture

Approved prototype public structure:

```
orrylo.com                     public prototype application
orrylo.com/p/<slug>            MVP public project / landing page
assets.orrylo.com              Shared Issuer metadata
<project>.orrylo.com           Dedicated Issuer metadata and possible future project publication host
<custom-domain>                optional future dedicated/public-domain support
```

For the prototype, the interactive Orrylo application is deployed directly at `orrylo.com`; `app.orrylo.com` is not required.

The MVP free public project page is `orrylo.com/p/<slug>`. This route is only a publication layer and must not be used as the project's internal identity or as an implicit Stellar metadata-hosting location.

A separate marketing/application split may be introduced later if it becomes operationally useful, but it is not part of the current prototype baseline.

Shared assets continue to use the shared issuer home domain. Dedicated issuers may use per-project metadata domains and later custom domains according to the dedicated-issuer architecture. Public landing-page hosting and metadata hosting remain separate concerns even if a future domain happens to serve both roles.

### 15.1 Managed Stellar metadata

High-quality Stellar metadata publication is a first-class Orrylo product capability.

Orrylo should ultimately generate, publish, update, and validate appropriate `stellar.toml` / Stellar metadata from the managed Project Profile so users do not need to understand TOML hosting mechanics merely to maintain a professionally presented Stellar project.

Product/readiness status may expose concepts such as:

- metadata configured;
- TOML published and reachable;
- image reachable;
- issuer linkage valid;
- SAC visibility/verification where applicable;
- explorer visibility.

These are product/readiness concepts, not guarantees that every external explorer will update instantly or identically.

### 15.2 Free generated project landing page

An Orrylo project receives a free generated public landing page as part of the managed project lifecycle.

For MVP the route is:

```
orrylo.com/p/<slug>
```

The page is data-driven from the Project Profile and uses the approved Orrylo visual direction rather than project-specific hard-coded content.

The approved free-template information hierarchy includes, where data exists:

- Orrylo branding/navigation;
- project/token logo;
- asset code and display/project name;
- description and project/category context;
- community/project calls to action;
- issuer identity and network;
- project/asset status and explorer link;
- About / project details;
- useful project characteristics;
- token information;
- project/social/community links;
- Stellar context;
- Orrylo footer/branding.

The approved NOVA mockup is the visual reference for this free template. NOVA-specific content, gaming visuals, Discord, Telegram, or any particular social network are not product requirements.

Multiple template variants, custom-domain pricing, exact custom-domain verification, final media storage, exact slug mutation policy, exact metadata edit permissions, and the exact TOML deployment mechanism remain unresolved unless separately canonicalized.

## 16. Current RYLO issuer candidate

A vanity Stellar public key has been generated and is reserved as the current RYLO issuer candidate:

```
GCKB453UWEFLJQY4TVW7I7NZV3ZNVUCZZS6KKIKJZVF75WM2VEORRYLO
```

Important status:

- This address is **not evidence of a mainnet deployment**.
- It must not be treated as production until the repository contains explicit deployment evidence.
- The `ORRYLO` suffix is branding only and provides no additional cryptographic security.
- The Shared Issuer for user assets must be a separate account.

### 16.1 RYLO Testnet issuer status

The verified RYLO Testnet issuer is:

```
GDNSIP2SKNJIKN6IG3XZBQMHIKKDET25J33F4R5V6DALKHIUDTVZOPKX
```

The previously considered Testnet account
`GDPKHRFAGZHDJFKLBERV7IXF2XX4TGW6MYYUDGME3MIJ3HES5SGICG5H` is
**abandoned**. It must not be treated as the RYLO Testnet issuer and must not be
used for RYLO SAC derivation or deployment evidence.

Verified current Testnet issuer state:

- Master signer: weight **1**;
- Signer A — Operational:
  `GB5V6M5EQGDWVDH66ZX6GF2NOJADUDU6ZWKEZJCZZNXUBSYLBHZIM2F3`, weight **1**;
- Signer B — Owner / policy co-signer:
  `GC52EXPMDMAQ3WDPGAW2MJJOS5FAUNLE2KHPAESJUWZ4NETVYSWTJZR5`, weight **1**;
- Signer C — Recovery:
  `GBWRVDTU4KTNTIPASSBPFGLGYUFOBI4TZPVKHGA3D23QIXLHY7XT2F3T`, weight **1**;
- low / medium / high thresholds: **0 / 0 / 0**;
- `AUTH_REQUIRED`: **OFF**;
- `AUTH_REVOCABLE`: **OFF**;
- `AUTH_CLAWBACK`: **OFF**;
- no RYLO has intentionally been minted.

The locked final **Testnet** signer/threshold target is:

```text
Master = 0
A      = 1
B      = 1
C      = 1
low    = 2
medium = 2
high   = 2
```

Operational interpretation:

- routine protected operations require **A + B**;
- recovery may use **A + C** or **B + C** only under the recovery procedure;
- no individual signer may independently authorize issuer operations.

Required Testnet safety sequence:

1. Keep the Master signer at weight **1** during initial configuration.
2. Configure A, B, C and the intended low/medium/high thresholds.
3. Successfully test and prove the routine **A + B** authorization path.
4. Only after the **A + B** test succeeds may the Master signer be reduced to
   weight **0**.

Testing **A + C** or **B + C** does not satisfy step 3 because those paths are
recovery-only.

The approved RYLO issuer flags remain:

```text
AUTH_REQUIRED  = ON
AUTH_REVOCABLE = ON
AUTH_CLAWBACK  = OFF
```

Initial RYLO supply remains **0**.

For the Classic Stellar asset
`RYLO:GDNSIP2SKNJIKN6IG3XZBQMHIKKDET25J33F4R5V6DALKHIUDTVZOPKX` on Testnet,
the deterministic Stellar Asset Contract address is:

```
CAPB6JBF466Y6TY4UBAQDSN24KTILN2R2CLINBGJSIGS5BTTEEDW3GMI
```

This deterministic address is identity/provenance evidence only; it is not by
itself evidence that the SAC has been deployed. The obsolete SAC
`CARDQUIZNFA56T4SNDNLG6WNIZQU2JIGPNOGXOCIL4CKECFNE6VFNMB3`, derived from
the abandoned `GDPKHR...` Testnet candidate, must not be used as RYLO Testnet
deployment evidence.

## 17. Implementation status

Current phase: **Eligibility + Reward Workflow Foundation**.

The repository contains a minimal Soroban workspace and a policy-neutral foundation contract with:

- atomic deploy-time initialization;
- explicit initializer authorization;
- versioned foundation state;
- an explicit application-facing interface compatibility version;
- deterministic read-only inspection;
- typed errors;
- generated-spec regression verification;
- real-Wasm constructor authorization/rollback/duplicate-deployment tests.

The stable application-facing contract surface is documented in
[`CONTRACT_INTERFACE.md`](CONTRACT_INTERFACE.md).

The repository also contains an initial Next.js application foundation under
`web/` with:

- the approved public-prototype shell and responsive visual direction;
- a customer-facing homepage centered on token creation, wallet authentication,
  RYLO, and Products & Services;
- a guided Shared Issuer token draft covering identity, metadata context, and
  safe preview with no issuance mutation;
- customer-facing RYLO policy presentation and visibly unavailable Dedicated
  Issuer/unimplemented product capabilities;
- modular contract-read/transaction adapter interfaces plus a narrow Albedo authentication adapter;
- Contract Interface v1 compatibility checks and typed error mapping;
- application formatting, lint, typecheck, test, build, and CI gates.

The public prototype is now served at `orrylo.com` through Railway with a valid
TLS certificate, and production wallet authentication is configured for the
`orrylo.com` hostname. This deployment evidence does not imply that project
persistence, metadata publication, or any on-chain path is healthy or complete;
those capabilities still require their own successful runtime/deployment
evidence.

The web application now implements authentication-only Albedo wallet proof with
durable PostgreSQL-backed challenges and server-side sessions. It also contains
an inactive persistent workflow/idempotency foundation, append-only
hash-chained audit events, and a server-only trusted qualifying-event boundary
that can establish first-token eligibility and prepare the approved launch
reward record plus inactive future workflow/protected-operation intents.

The qualifying-event producer is not implemented or selected. The service does
not decide whether a token creation succeeded; a future reviewed server-side
integration must supply that trusted evidence. No public/browser mutation route
exists for declaring token-creation success. Eligibility and reward UI data
remain demo-only.

The persistence layer is provider-neutral: the repository requires PostgreSQL
through a server-only DATABASE_URL but does not select or claim any hosted
database provider. It supports multi-instance challenge/session state, atomic
challenge consumption, database uniqueness constraints, deterministic
migrations, and real database concurrency tests.

No public workflow, eligibility, reward, or protected-operation endpoint is
activated. Reward preparation stops at database state `approved`; it does not
create an envelope, invoke a signer, submit a transaction, or confirm an
on-chain result. The application performs no Stellar transaction, issuer
mutation, trustline mutation, RYLO mint/reward execution/payment/authorization,
contract mutation, liquidity operation, testnet issuance/deployment, or mainnet
activity.

Current canonical RYLO policy now defines supply, mint-source, reward, treasury,
authorization, signer, retry, and audit intent in
[RYLO_POLICY.md](RYLO_POLICY.md). This phase implements eligibility/reward
preparation only; the policy is **not yet implemented on-chain or in an
executing production issuer workflow**.

This foundation does **not** implement:

- RYLO supply enforcement, mint/reward execution, direct sales, service-spend recycling, or bootstrap liquidity;
- RYLO trustline authorization/revocation execution;
- RYLO issuer multisig/signing-service infrastructure;
- Shared Issuer account configuration;
- Dedicated Issuer token templates;
- final contract admin/governance or admin-transfer policy;
- upgradeability or emergency controls;
- testnet or mainnet deployment.

The Testnet RYLO issuer account and the three named non-master signers now exist
as verified public Testnet state. However, thresholds remain `0/0/0`, the
Master signer still has weight `1`, the approved issuer flags are not yet set,
no RYLO has intentionally been minted, and no RYLO SAC deployment has been
recorded. This is **partial Testnet issuer preparation**, not a completed RYLO
Testnet deployment.

No mainnet issuer configuration, RYLO supply enforcement, completed Testnet
issuer ceremony, SAC deployment, or mainnet deployment should be inferred
merely from the presence of the contract/application workspace or the partial
Testnet account setup.

## 18. Canonical companion documents

- [ARCHITECTURE.md](ARCHITECTURE.md) — system architecture and boundaries
- [RYLO_POLICY.md](RYLO_POLICY.md) — RYLO-specific rules
- [OPEN_DECISIONS.md](OPEN_DECISIONS.md) — decisions intentionally left unresolved
- [CONTRACT_INTERFACE.md](CONTRACT_INTERFACE.md) — stable application-facing contract interface
- [../AGENTS.md](../AGENTS.md) — rules for humans and AI agents working in the repository

When these documents conflict, this file is the highest-level product source of truth, while the more specific file governs implementation detail within its declared scope.
