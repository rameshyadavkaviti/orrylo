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

A wallet becomes eligible for RYLO after successfully completing at least one qualifying Orrylo action:

- create a token; or
- create / purchase a product.

Creating only a token is sufficient. A later product purchase is not required.

Current membership principle:

**One-time builder → ecosystem member.**

Authorization should not be casually revoked after qualification unless future policy explicitly changes.

## 9. First 100 users

The initial campaign model is:

```
User joins
→ receives free build credit
→ successfully creates first token
→ becomes eligible member
→ RYLO trustline is authorized
→ receives remaining RYLO reward
```

The initial credit is not intended to be immediately tradable RYLO.

Anti-Sybil controls are intentionally deferred for the first version unless real abuse requires them.

## 10. Price transparency

Orrylo may sell RYLO directly for XLM at a platform-set sale price.

That direct sale price must not be described as:

- intrinsic value;
- guaranteed market value;
- guaranteed future value.

For rewards, the UI may state the direct platform purchase price for the same amount, for example:

```
Gifted: 200 RYLO
Paid: 0 XLM
Direct Orrylo purchase price: 20 XLM
Market value: market-dependent
```

Do not say that the gift "is worth 20 XLM" solely because Orrylo sells the same amount for 20 XLM.

## 11. No investment section for v1

The first version must not introduce an official investment program such as:

- guaranteed returns;
- guaranteed yield;
- profit share;
- price-appreciation rewards;
- promises tied to future token price.

Any future financial/investment feature requires a separate product and legal review.

## 12. Domain architecture

Target public structure:

```
orrylo.com
app.orrylo.com
assets.orrylo.com
*.orrylo.com
```

Shared assets use the shared issuer home domain.

Dedicated issuers may use per-project subdomains and later custom domains.

## 13. Current RYLO issuer candidate

A vanity Stellar public key has been generated and is reserved as the current RYLO issuer candidate:

```
GCKB453UWEFLJQY4TVW7I7NZV3ZNVUCZZS6KKIKJZVF75WM2VEORRYLO
```

Important status:

- This address is **not evidence of a mainnet deployment**.
- It must not be treated as production until the repository contains explicit deployment evidence.
- The `ORRYLO` suffix is branding only and provides no additional cryptographic security.
- The Shared Issuer for user assets must be a separate account.

## 14. Implementation status

Current phase: **Application authentication — Albedo wallet/session slice**.

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

The web application now implements authentication-only Albedo wallet proof and
server-side application sessions. Product data remains demo-only. The wallet
slice performs no Stellar transaction, issuer mutation, contract mutation,
testnet issuance/deployment, or mainnet activity.

Authentication challenge/session state is temporarily process-local and must not
be represented as horizontally scalable production persistence.

This foundation does **not** define or implement:

- RYLO supply, mint, burn, reward, pricing, or service-spend economics;
- final RYLO trustline authorization/revocation mechanics;
- Shared Issuer account configuration;
- Dedicated Issuer token templates;
- final contract admin/governance or admin-transfer policy;
- upgradeability or emergency controls;
- testnet or mainnet deployment.

No production issuer configuration, RYLO supply rule, testnet deployment, or mainnet deployment should be inferred merely from the presence of the contract workspace.

## 15. Canonical companion documents

- [ARCHITECTURE.md](ARCHITECTURE.md) — system architecture and boundaries
- [RYLO_POLICY.md](RYLO_POLICY.md) — RYLO-specific rules
- [OPEN_DECISIONS.md](OPEN_DECISIONS.md) — decisions intentionally left unresolved
- [CONTRACT_INTERFACE.md](CONTRACT_INTERFACE.md) — stable application-facing contract interface
- [../AGENTS.md](../AGENTS.md) — rules for humans and AI agents working in the repository

When these documents conflict, this file is the highest-level product source of truth, while the more specific file governs implementation detail within its declared scope.
