# Orrylo — Current Decisions Queue

Only the first automated Stellar Testnet Shared Issuer creation is in the immediate critical path.

## Resolve from observable deployment evidence
- Confirm web and isolated signer configuration exactly match the approved Testnet issuer and operational signer identities.
- Verify authenticated service-to-service signing request handling, current deployment build and source network.
- Verify customer-funded receiving trustline readiness from the web journey.
- Confirm one new authorized creation request reaches exact signed transaction/ledger confirmation, project state and explorer evidence.
- Check branch/PR/CI status before writing fixes. Do not retry an uncertain or expired issuance merely to test configuration.

## Explicitly not selected by this simplification
- Automatic reservation expiry/release rules and abuse quotas not yet approved.
- Generalized future RYLO mint, rewards, direct sales, Treasury/liquidity mechanisms, protected multisig operations, Dedicated Issuer contract templates, Mainnet custody, customer-domain onboarding or additional wallet integrations.
- Any alteration to existing issuer authority, secrets, schema enforcement or security-critical retries.

Historical open policy decisions remain available in `docs/archive/2026-10-19/OPEN_DECISIONS.md`. They are **deferred**, not silently resolved or approved for implementation.

When a deferred domain becomes active, review its original policy and related tests before a new explicit decision.
