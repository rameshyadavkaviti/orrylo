# Orrylo Architecture — v1

Status: **Target architecture, not implementation evidence**

This document defines the intended system boundaries for the first Orrylo architecture.

## 1. High-level system

```
Users
  │
  ▼
Orrylo App
  │
  ├── Wallet authentication (initially Albedo)
  ├── Product / service ordering
  ├── Shared asset creation
  ├── Dedicated asset creation
  ├── RYLO membership / payment flows
  └── Metadata / domain management
       │
       ▼
Stellar / Soroban
```

The web application is a coordination layer. Asset ownership, issuer control, authorization, and contract policy should be anchored on Stellar wherever practical.

## 2. Shared Issuer boundary

The Shared Issuer is Orrylo infrastructure.

It may issue multiple customer assets, but:

- it is separate from the RYLO issuer;
- it is not represented as customer-owned;
- asset codes are unique within that issuer;
- all assets share the issuer account's `home_domain`;
- metadata is published under the shared asset domain;
- issuer policy must be explicit in the UI.

Expected domain:

`assets.orrylo.com`

A vanity address is optional. Technical correctness and key security take priority over address aesthetics.

## 3. Dedicated Issuer boundary

Each Dedicated Issuer belongs to one customer/project infrastructure instance.

Target control model:

```
Customer intent
     │
     ▼
Orrylo provisioning flow
     │
     ▼
Dedicated Stellar issuer
     │
     ▼
Contract / policy controller
```

The dedicated tier should not rely on Orrylo permanently holding an unrestricted issuer secret.

## 4. Contract-controlled issuer principles

A contract-controlled issuer may encode:

- mint permissions;
- burn permissions;
- max supply;
- fixed supply;
- admin authority;
- ownership transfer;
- authorization policy;
- upgrade policy.

The effective authority must match the product description.

If an operation is impossible according to the advertised policy, there must not be a hidden non-contract path that makes it possible.

## 5. Contract templates

Potential product templates:

### Fixed Supply

Supply is created once and no further minting is possible.

### Capped Supply

Minting is possible only until a declared maximum supply.

### Mintable

An explicitly identified authority can increase supply.

### Governed

Sensitive operations require a defined governance or multi-party approval policy.

### Custom

Project-specific rules require separate implementation and review.

These are product targets, not yet implemented templates.

## 6. Key custody

Preferred provisioning sequence:

```
Generate account
→ fund/configure account
→ establish asset settings
→ deploy/configure contract
→ move effective authority to intended controller
→ remove unnecessary privileged paths
→ securely discard temporary secrets when no longer needed
```

Rules:

- never commit secrets to Git;
- never expose secrets to browser logs;
- never include secrets in analytics or error telemetry;
- minimize duration of backend custody;
- document any retained emergency/admin power.

## 7. RYLO boundary

RYLO has a dedicated issuer and must remain separated from customer Shared Issuer infrastructure.

Current reserved issuer candidate:

`GCKB453UWEFLJQY4TVW7I7NZV3ZNVUCZZS6KKIKJZVF75WM2VEORRYLO`

The address must not be considered active or mainnet-deployed until explicit deployment records exist.

RYLO-specific authorization and economics are defined in `RYLO_POLICY.md`.

## 8. Membership authorization

The intended Stellar model is a controlled-access RYLO asset using authorization semantics such as `AUTH_REQUIRED`.

Target lifecycle:

```
User connects wallet
→ creates RYLO trustline
→ completes qualifying Orrylo action
→ wallet becomes eligible
→ trustline is authorized
→ wallet may hold / receive / trade RYLO
```

The approved v1 enforcement mechanism is Stellar issuer-side trustline authorization through Orrylo's protected issuer-signing path. Eligibility is application policy; Stellar authorization is the final enforcement step. Contract-mediated authorization is not the approved v1 RYLO authorization mechanism unless canonical policy is explicitly changed later.

## 9. Metadata and domains

Approved prototype routing:

```
orrylo.com                     public prototype application
assets.orrylo.com              Shared Issuer metadata
<project>.orrylo.com           Dedicated Issuer metadata
<custom-domain>                optional future dedicated-domain support
```

The prototype application is intentionally served directly from `orrylo.com` to reduce launch friction and keep the first user journey simple. A future split to `app.orrylo.com` remains optional rather than required.

A wildcard domain may be used so one application can serve project-specific subdomains dynamically.

## 10. Truth and observability

Important product claims should be externally verifiable where possible.

Expected surfaced fields include:

- issuer type;
- issuer address;
- issuer owner/control model;
- contract address;
- supply policy;
- mint policy;
- burn policy;
- admin policy;
- home domain;
- authorization requirements.

The UI should distinguish clearly between:

- current on-chain fact;
- Orrylo policy;
- configured target;
- future roadmap.

## 11. Implementation discipline

Until code and deployment evidence exist, architecture documents describe intent only.

No agent should state that a contract, asset policy, domain route, issuer transition, or mainnet deployment is complete based solely on this document.


## 12. Prototype deployment baseline

For the first working prototype, Orrylo uses a low-cost provider-neutral deployment baseline:

```
Cloudflare DNS/CDN
      │
      ▼
Railway app/backend
      │
      ▼
Neon PostgreSQL
      │
      ├── durable auth/workflows/audit
      │
      ▼
Stellar Testnet
```

The expected starting infrastructure cost is approximately **$5/month**, driven primarily by Railway. Neon and Cloudflare are expected to remain on their free tiers for the initial prototype.

This is not a permanent production-provider commitment. Application/database boundaries should remain portable.

The Testnet environment should be reproducibly bootstrappable because Testnet state is disposable/resettable.

## 13. Protected issuer operations

Routine protected RYLO operations use the approved two-signer path:

```
Application policy / durable intent
→ protected operations boundary
→ Signer A
→ independent Signer B policy verification
→ Stellar submission
→ confirmation + audit
```

Routine examples include trustline authorization, approved mint execution, Treasury transfer, and liquidity additions.

Critical operations such as signer rotation, threshold changes, issuer-flag changes, and recovery are intentionally excluded from the routine path and require a manual/local ceremony with recovery-capable participation and explicit audit evidence.

Signer C and the Master Key are not routine operational signers.
