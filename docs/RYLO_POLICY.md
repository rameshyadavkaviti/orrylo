# RYLO Policy — v1

Status: **Canonical policy intent / pre-implementation**

This document defines the current intended role and policy of RYLO, Orrylo's ecosystem utility token.

## 1. Purpose

RYLO exists primarily for:

- paying for Orrylo services;
- representing ecosystem membership eligibility;
- rewarding qualifying users;
- member-to-member transfer and market trading.

RYLO is not currently designed or marketed as an investment product.

## 2. Dedicated issuer

RYLO must use an issuer separate from the Shared Issuer used for customer-created assets.

Current reserved vanity public-key candidate:

`GCKB453UWEFLJQY4TVW7I7NZV3ZNVUCZZS6KKIKJZVF75WM2VEORRYLO`

The vanity suffix is branding only.

The address must not be represented as an active production/mainnet issuer until deployment is explicitly completed and documented.

## 3. Eligibility

A wallet becomes eligible to hold and trade RYLO after successfully completing at least one qualifying Orrylo action:

1. creating a token through Orrylo; or
2. creating / purchasing a product through Orrylo.

A user who creates only a token is still eligible.

Current membership principle:

**One-time builder → ecosystem member.**

## 4. Controlled access

RYLO is intended to be a controlled-access Stellar asset rather than an unrestricted public asset.

Target behavior:

- non-eligible wallets must not be able to hold RYLO;
- eligible wallets may be authorized to hold, receive, buy, sell, and transfer RYLO;
- authorization should be explicit and auditable;
- revocation should not be routine after valid qualification.

Stellar authorization features such as `AUTH_REQUIRED` are the current intended foundation.

The final authorization mechanism is still open until implementation design is completed.

## 5. Direct platform sales

Orrylo may sell RYLO directly in exchange for XLM.

The platform may set its own direct sale price.

That price is:

**Orrylo direct sale price**

It is not automatically:

- market value;
- intrinsic value;
- guaranteed resale value;
- future value.

Secondary-market participants determine market price through supply and demand.

## 6. Rewards

RYLO may be distributed as an ecosystem reward after a qualifying action.

The UI may show how much the same RYLO amount would cost if bought directly from Orrylo.

Example:

```
Gifted: 200 RYLO
Paid: 0 XLM
Direct Orrylo purchase price: 20 XLM
Market value: market-dependent
```

The UI must not convert the direct sale price into a claim that the reward "is worth" that amount.

## 7. First 100 users

The current launch campaign concept:

```
Join
→ receive Free Build Credit
→ successfully create first token
→ become eligible
→ authorize RYLO trustline
→ receive remaining RYLO reward
```

The initial Free Build Credit is not intended to be freely tradable RYLO before qualification.

No dedicated anti-Sybil system is required for v1 unless later evidence justifies one.

## 8. Service use

RYLO is intended to pay for services including, potentially:

- shared token creation;
- dedicated issuer upgrades;
- contract deployment;
- website / product creation;
- custom Stellar development;
- infrastructure services.

Exact prices are intentionally not fixed in this document.

## 9. Investment-policy boundary

For v1, Orrylo must not advertise or implement an official RYLO investment product involving:

- guaranteed return;
- guaranteed yield;
- profit share;
- guaranteed appreciation;
- reward formulas explicitly tied to future token-price appreciation.

Any such future change requires a new architecture, economic, and legal review.

## 10. Contract requirements still open

Before RYLO production deployment, the following must be decided explicitly:

- initial supply;
- maximum supply, if any;
- who can mint;
- whether minting can ever be permanently disabled;
- burn behavior;
- whether service-spent RYLO is burned, retained, recycled, or otherwise handled;
- authorization controller;
- revocation rules and exceptional cases;
- admin transfer rules;
- contract upgradeability;
- emergency controls;
- failure/shutdown behavior;
- direct-sale pricing mechanism.

Until these are resolved, no agent may infer or invent them.

## 11. Transparency rule

Every RYLO-facing interface must distinguish clearly between:

- amount;
- direct Orrylo sale price;
- market price;
- reward amount;
- eligibility / authorization status;
- on-chain state;
- platform policy.

Marketing language must not blur these categories.
