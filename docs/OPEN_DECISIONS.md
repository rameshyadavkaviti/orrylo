# Orrylo Open Decisions — v1

Status: **Unresolved by design**

This file prevents future developers or AI agents from treating undecided questions as settled architecture.

## RYLO economics and control

The following are not yet final:

- initial RYLO supply;
- maximum supply;
- whether supply is fixed, capped, or continuously mintable;
- mint authority;
- burn behavior;
- treatment of RYLO spent on Orrylo services;
- direct-sale price and pricing formula;
- exact launch reward amount for the first 100 users;
- exact free-build-credit amount.

## RYLO authorization implementation

The policy goal is decided: only eligible Orrylo ecosystem members should hold/trade RYLO.

Still open:

- exact `AUTH_REQUIRED` / issuer-authorization configuration;
- whether authorization is driven directly by the issuer, a Soroban contract, or both;
- exceptional revocation rules;
- shutdown/recovery behavior.

## RYLO contract governance

Still open:

- contract admin model;
- upgradeability;
- emergency powers;
- admin transfer process;
- multisig/governance requirements;
- immutable vs upgradeable policy boundaries.

No hidden backdoor is allowed regardless of the final model.

## Shared Issuer

Decided:

- customer Shared Issuer must be separate from the RYLO issuer.

Still open:

- final Shared Issuer public key;
- whether it uses a vanity suffix or a normal random Stellar address;
- final account authorization flags;
- detailed lifecycle rules;
- exact metadata schema.

A vanity address is optional and must not delay the product if a random account is otherwise correct and secure.

## Dedicated Issuer templates

The contract-controlled model is selected.

Still open:

- exact first set of templates;
- implementation details for Fixed Supply;
- implementation details for Capped Supply;
- implementation details for Mintable;
- implementation details for Governed;
- ownership-transfer mechanics;
- contract upgrade model.

## Pricing

A broad early service-price concept of roughly 50–100 XLM has been discussed, but no exact production price is locked.

Pricing for all services remains open until unit economics and first-version scope are defined.

## Domains and hosting

Target domain architecture is decided conceptually.

Still open:

- final deployment provider configuration;
- exact DNS/wildcard setup;
- custom-domain onboarding flow;
- whether every dedicated asset receives a subdomain automatically in v1.

## Wallet support

Albedo is the initial target wallet.

Still open:

- whether v1 supports only Albedo;
- order and scope of additional Stellar wallet integrations.

## Anti-abuse

Dedicated anti-Sybil protections are intentionally deferred.

This does not mean abuse is impossible or accepted permanently. It means no extra anti-Sybil architecture should be invented for v1 without evidence or an explicit product decision.

## Legal / compliance

Jurisdiction-specific legal treatment of:

- direct RYLO sales;
- controlled holder eligibility;
- rewards;
- secondary trading;
- service-credit characterization;

has not been finalized.

Do not make legal/compliance claims from architecture assumptions.
