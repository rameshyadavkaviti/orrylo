# Orrylo Agent Rules

These rules apply to humans and AI agents working in this repository.

## 1. Read before changing architecture

Before architecture, contract, token-policy, issuer, membership, or pricing work, read:

1. `docs/SOURCE_OF_TRUTH.md`
2. `docs/ARCHITECTURE.md`
3. `docs/RYLO_POLICY.md`
4. `docs/OPEN_DECISIONS.md`

Do not infer product policy from code alone when a canonical policy document exists.

## 2. Distinguish status levels

Always separate:

- discussed idea;
- approved architecture;
- implemented code;
- tested behavior;
- testnet deployment;
- mainnet deployment.

Never promote one status to another without evidence.

## 3. Do not invent unresolved policy

If a value or rule is listed in `OPEN_DECISIONS.md`, do not silently choose one during implementation.

Examples include:

- RYLO max supply;
- mint authority;
- burn policy;
- service-spend behavior;
- exact pricing;
- admin/upgrade rules.

Raise the unresolved decision explicitly instead.

## 4. Issuer separation is mandatory

The RYLO issuer and customer Shared Issuer are separate accounts.

Current RYLO issuer candidate:

`GCKB453UWEFLJQY4TVW7I7NZV3ZNVUCZZS6KKIKJZVF75WM2VEORRYLO`

Do not use it for customer Shared Issuer assets.

The address is a reserved candidate, not proof of mainnet deployment.

## 5. No hidden authority

Do not implement or preserve an undisclosed authority path that contradicts the advertised policy of an asset or contract.

If emergency/admin power exists, document it explicitly.

## 6. Secret safety

Never:

- commit Stellar secret keys;
- place secrets in source-controlled examples;
- write secrets into application logs;
- expose secrets to browser analytics;
- include secrets in issue/PR text.

Use public keys in documentation unless a private key is absolutely required for an isolated local test fixture.

## 7. Contract-controlled means contract-controlled

For Dedicated Issuer products, production authority must match the declared contract/policy model.

Do not call an asset fixed-supply, capped, user-controlled, or contract-controlled if another undisclosed signer can bypass that rule.

## 8. Shared Issuer disclosure

Any Shared Issuer product must communicate that:

- the issuer is shared Orrylo infrastructure;
- it is not the customer's dedicated issuer;
- asset code uniqueness is required under the shared issuer;
- shared assets share the issuer's `home_domain`.

## 9. RYLO membership policy

Current qualification rule:

- successful Orrylo token creation qualifies; or
- successful Orrylo product creation/purchase qualifies.

A user does not need to upgrade a token into a larger product to qualify.

Do not add KYC, anti-Sybil, device, IP, or identity requirements unless explicitly approved later.

## 10. Marketing language must match facts

Do not equate Orrylo direct RYLO sale price with:

- intrinsic value;
- market value;
- guaranteed value;
- future value.

Do not add investment-return claims to RYLO v1.

## 11. Documentation must move with policy

When an explicit product decision changes:

- update the relevant canonical document in the same change;
- move resolved items out of `OPEN_DECISIONS.md`;
- keep implementation status accurate.

## 12. Evidence standard

A feature is complete only when supported by appropriate evidence, such as:

- code;
- tests;
- deployment record;
- on-chain address/state;
- configuration;
- reproducible verification.

Documentation describing a target is not implementation evidence.
