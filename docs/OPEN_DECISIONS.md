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
- 150 RYLO first-successful-token launch reward;
- 50 RYLO-equivalent non-tradable Free Build Credit;
- 60-day reward window from a fixed official launch timestamp;
- 1,000,000 RYLO Bootstrap Liquidity Reserve;
- initial liquidity deployment: 1,000 RYLO + 100 XLM;
- 999,000 RYLO remains undeployed reserve capacity after the initial deployment;
- authorized eligible users may trade with one another.

Still open:

- exact official launch timestamp;
- exact amount chosen for each future staged liquidity addition;
- exact pool/market deployment mechanism;
- exact service prices denominated in RYLO;
- whether additional non-launch reward programs are introduced later.

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
- operational debug-log retention target is 90 days.

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
- supply-cap verification is mandatory.

Still open:

- exact definition/evidence event for “successful token creation” before the reward is released;
- exact persistent database schema and atomicity mechanism;
- exact on-chain transaction construction and submission implementation.

## Shared Issuer

Decided:

- customer Shared Issuer must be separate from the RYLO issuer.

Reserved candidate:

`GBR7SEZD4ITXQPAWEVBX2BULS76ERDRTRMIS3LUYKZ7DNLGZZ6ASSETS`

This remains a reserved candidate only, not deployment evidence.

Still open:

- whether the reserved candidate becomes the final Shared Issuer public key;
- final account authorization flags;
- detailed lifecycle rules;
- exact metadata schema.

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

Albedo server-verified wallet authentication is implemented in the application foundation.

Still open before public/multi-instance production:

- shared atomic persistence for challenges/sessions;
- rate limiting and request-abuse controls;
- body/request limits at infrastructure level;
- final production origin/cookie hardening;
- durable application database workflows for eligibility, rewards, idempotency, and audit.

## Pricing

The RYLO direct sale price is decided separately from Orrylo service pricing.

Still open:

- exact production prices for token creation and other Orrylo services;
- RYLO-denominated service price schedule.

## Domains and hosting

Target domain architecture is decided conceptually.

Approved first-prototype baseline:

- Railway for app/backend hosting;
- Neon Free for PostgreSQL;
- Cloudflare Free for DNS/CDN;
- Stellar Testnet for the first end-to-end prototype.

These are prototype choices, not permanent production-provider commitments.

Still open:

- final production deployment provider configuration;
- exact DNS/wildcard setup;
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
