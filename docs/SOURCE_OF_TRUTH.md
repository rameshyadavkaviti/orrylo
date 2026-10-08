# Orrylo Source of Truth — v1

Status: **Canonical architecture definition / contract interface implementation**

This document records the decisions currently considered authoritative for Orrylo. Anything not marked as decided here, or explicitly delegated to another canonical document, must be treated as unresolved.

## 1. Product identity

- Company / platform: **Orrylo**
- Ecosystem utility token: **RYLO**
- Primary network: **Stellar**
- Initial wallet login target: **Albedo**

Orrylo is intended to grow beyond a token creator. The product direction includes asset creation, contract-controlled token infrastructure, higher-level product creation, custom development, and supporting infrastructure on Stellar.

## 2. Product boundary

The first product family may expose services such as:

- token creation;
- dedicated issuer infrastructure;
- contract deployment;
- token-to-product upgrades;
- website / product development;
- custom Stellar infrastructure.

RYLO is intended to be the primary internal payment and membership asset for these services.

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
- a **1,000,000 RYLO Bootstrap Liquidity Reserve** is approved as the lifetime policy cap for Orrylo-managed bootstrap liquidity capacity;
- initial liquidity deployment is **1,000 RYLO + 100 XLM**;
- the remaining **999,000 RYLO** is undeployed reserve capacity and does not need to be minted in advance;
- additional liquidity is **manual, staged, and revenue/capital-backed** rather than automatic or time-scheduled;
- each additional liquidity operation must use real available XLM, remain within the 1,000,000 RYLO reserve cap, use a protected operation with `request_id` and `policy_version`, and produce append-only audit evidence;
- the ordinary public application backend must not independently execute liquidity additions;
- the previously considered idea that users could acquire additional RYLO only from Orrylo is rejected and is not policy.

Approved v1 mint sources are limited to:

1. Direct Purchase shortfall mint;
2. Reward mint;
3. Bootstrap Liquidity mint.

No manual/admin/marketing/emergency/developer mint path is approved for v1.

The direct sale price must not be described as intrinsic value, guaranteed market value, guaranteed resale value, or guaranteed future value.

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
- Stellar environment: **Testnet**;
- existing Orrylo domain: reused with no new prototype-domain purchase.

This is a **prototype deployment baseline**, not a permanent production-provider commitment.

The application must remain portable enough to move away from Railway, Neon, or Cloudflare if pricing, availability, sanctions/access, scale, security, or operational requirements change.

The first Testnet prototype is considered complete when the real end-to-end path demonstrates:

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

## 13. Domain architecture

Target public structure:

```
orrylo.com
app.orrylo.com
assets.orrylo.com
*.orrylo.com
```

Shared assets use the shared issuer home domain.

Dedicated issuers may use per-project subdomains and later custom domains.

## 14. Current RYLO issuer candidate

A vanity Stellar public key has been generated and is reserved as the current RYLO issuer candidate:

```
GCKB453UWEFLJQY4TVW7I7NZV3ZNVUCZZS6KKIKJZVF75WM2VEORRYLO
```

Important status:

- This address is **not evidence of a mainnet deployment**.
- It must not be treated as production until the repository contains explicit deployment evidence.
- The `ORRYLO` suffix is branding only and provides no additional cryptographic security.
- The Shared Issuer for user assets must be a separate account.

## 15. Implementation status

Current phase: **Application Persistence + Durable Workflow Foundation**.

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

- the approved dashboard/navigation shell and responsive visual direction;
- explicit demo-only account, eligibility, RYLO, asset, and activity states;
- Shared Issuer draft UX with no issuance mutation;
- visibly unavailable Dedicated Issuer and unresolved product capabilities;
- modular contract-read/transaction adapter interfaces plus a narrow Albedo authentication adapter;
- Contract Interface v1 compatibility checks and typed error mapping;
- application formatting, lint, typecheck, test, build, and CI gates.

The web application now implements authentication-only Albedo wallet proof with
durable PostgreSQL-backed challenges and server-side sessions. It also contains
an inactive persistent workflow/idempotency foundation, append-only
hash-chained audit events, and schema foundations for future eligibility,
reward, and protected-operation records. Product data remains demo-only.

The persistence layer is provider-neutral: the repository requires PostgreSQL
through a server-only DATABASE_URL but does not select or claim any hosted
database provider. It supports multi-instance challenge/session state, atomic
challenge consumption, database uniqueness constraints, deterministic
migrations, and real database concurrency tests.

No workflow, eligibility, reward, or protected-operation endpoint is activated.
The application performs no Stellar transaction, issuer mutation, trustline
mutation, RYLO mint/reward/payment/authorization, contract mutation, liquidity
operation, testnet issuance/deployment, or mainnet activity.

Current canonical RYLO policy now defines supply, mint-source, reward, treasury, authorization, signer, retry, and audit intent in [RYLO_POLICY.md](RYLO_POLICY.md), but those policies are **not yet implemented on-chain or in production application workflows**.

This foundation does **not** implement:

- RYLO supply enforcement, mint execution, rewards, direct sales, service-spend recycling, or bootstrap liquidity;
- RYLO trustline authorization/revocation execution;
- RYLO issuer multisig/signing-service infrastructure;
- Shared Issuer account configuration;
- Dedicated Issuer token templates;
- final contract admin/governance or admin-transfer policy;
- upgradeability or emergency controls;
- testnet or mainnet deployment.

No production issuer configuration, RYLO supply rule, testnet deployment, or mainnet deployment should be inferred merely from the presence of the contract workspace.

## 16. Canonical companion documents

- [ARCHITECTURE.md](ARCHITECTURE.md) — system architecture and boundaries
- [RYLO_POLICY.md](RYLO_POLICY.md) — RYLO-specific rules
- [OPEN_DECISIONS.md](OPEN_DECISIONS.md) — decisions intentionally left unresolved
- [CONTRACT_INTERFACE.md](CONTRACT_INTERFACE.md) — stable application-facing contract interface
- [../AGENTS.md](../AGENTS.md) — rules for humans and AI agents working in the repository

When these documents conflict, this file is the highest-level product source of truth, while the more specific file governs implementation detail within its declared scope.
