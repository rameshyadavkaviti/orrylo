# Orrylo Agent Rules

These rules apply to humans and AI agents working in this repository.

## 1. GitHub is the operational source of truth

Before meaningful work, fetch and reconcile the current GitHub `main`.

Then read the canonical repository documents:

1. `docs/SOURCE_OF_TRUTH.md`
2. `docs/ARCHITECTURE.md`
3. `docs/RYLO_POLICY.md`
4. `docs/OPEN_DECISIONS.md`
5. `docs/CONTRACT_INTERFACE.md` when contract/application integration is relevant
6. `web/README.md` when application/deployment behavior is relevant

Chat history, memory, copied SHAs, and previous-agent summaries are navigation aids only. They must not override current GitHub repository state.

Do not infer product policy from code alone when a canonical policy document exists. Reconcile code, tests, migrations, CI, deployment evidence, and canonical docs before acting.

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

Examples include currently unresolved items such as:

- exact official launch timestamp;
- exact evidence/producer for “successful token creation”;
- exact service pricing;
- exceptional revocation governance;
- concrete signer key-management/recovery infrastructure;
- Dedicated Issuer template details and upgrade/governance rules.

Raise the unresolved decision explicitly instead.

## 4. Issuer separation is mandatory

The RYLO issuer and customer Shared Issuer are separate accounts.

Reserved non-Testnet RYLO issuer candidate:

`GCKB453UWEFLJQY4TVW7I7NZV3ZNVUCZZS6KKIKJZVF75WM2VEORRYLO`

Verified RYLO Testnet issuer:

`GDNSIP2SKNJIKN6IG3XZBQMHIKKDET25J33F4R5V6DALKHIUDTVZOPKX`

The abandoned Testnet candidate
`GDPKHRFAGZHDJFKLBERV7IXF2XX4TGW6MYYUDGME3MIJ3HES5SGICG5H` must not be
used as the RYLO Testnet issuer and must not be used for SAC derivation.

Do not use any RYLO issuer for customer Shared Issuer assets.

The vanity `GCKB...ORRYLO` address remains a reserved candidate only, not proof
of mainnet deployment.

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

Current approved v1 token-creation qualification rule:

- the wallet becomes eligible after the user's first successful token creation through Orrylo.

Product creation/purchase is not currently an approved additional eligibility path. If it is introduced later, it must first be explicitly specified in the canonical policy documents.

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


## 13. Fresh-conversation recovery and autonomous continuation

An agent must be able to recover normal Orrylo quality in a new conversation from the repository name and its assigned role alone.

Before meaningful work, follow the bootstrap and role-recovery procedure in section 19 of `docs/SOURCE_OF_TRUTH.md`. In particular:

- reconcile current GitHub state instead of trusting chat memory;
- inspect role-relevant open PRs/issues, latest exact HEADs, review findings, and CI;
- recover the current critical path from repository evidence;
- continue from the first unresolved in-scope gate rather than restarting prior work;
- do not require the owner to say `continue` or `next` for routine progress;
- perform reversible in-scope work directly;
- hand specialist-owned work to the correct role with a self-contained prompt;
- ask the owner only for genuine unresolved decisions, owner-only manual actions, secret/custody steps, live network/financial mutations, or other explicitly owner-gated actions.

Conversation history and model memory may accelerate navigation, but successful recovery must not depend on them.

## 14. Handoff and state hygiene

Keep dynamic implementation state in GitHub work items and evidence, not as unsupported chat-only knowledge.

When opening or materially advancing a PR/issue:

- make objective, scope, acceptance criteria, and non-goals discoverable;
- leave exact-head review requests when independent review is required;
- record blocking findings in the PR/issue rather than only in chat;
- keep CI/test evidence attached to the relevant work item;
- retract or supersede stale instructions clearly;
- avoid duplicating canonical policy into temporary work-item text when a stable link/reference is sufficient.

This discipline is what allows another agent to resume the same workflow after a conversation becomes slow, long, or unavailable.
