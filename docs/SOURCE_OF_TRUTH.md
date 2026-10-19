# Orrylo — Lean Source of Truth

Status: **Proposed simplified product scope (draft; not yet merged).**
Updated: 2026-10-19.

## Product
Orrylo lets people create, publish, manage, and grow Stellar projects. The immediate priority is an **automated, verified customer token creation on Stellar Testnet** using Orrylo's Shared Issuer. RYLO, Dedicated Issuer and advanced Soroban products are independent later phases; they must not delay the first complete creation journey.

## First customer journey
1. Authenticate with Albedo.
2. Enter asset code, starting supply, and project details.
3. Confirm creation; server reserves unique issuer-scoped asset code and commits one immutable issuance request.
4. Validate the receiving wallet's trustline and exact configured Testnet issuer/signer identities.
5. Sign through the isolated private Testnet signer; submit a bounded transaction.
6. Verify the exact ledger outcome. Only then show issued/confirmed status, an explorer reference, and the managed Project Profile.

A draft profile or reserved code is never proof of issuance. An unknown transaction outcome is **not** safe to retry as new issuance or to release for another customer.

## Technical model
- One modular Next.js application for UI and backend.
- One PostgreSQL application database, with distinct privileged identities where existing enforcement requires them.
- One private isolated signing boundary: issuer secrets do not enter web, browser, repository, logs, or database.
- Stellar ledger provides authoritative on-chain outcomes. PostgreSQL manages projects, immutable requests, idempotency, reconciliation and audit.
- Railway app and isolated signer, Neon PostgreSQL, Cloudflare DNS/CDN are prototype infrastructure choices.

## Persistent project identity
The stable project identifier is distinct from public slug/URL and Stellar metadata hosting. A Project Profile owns editable application metadata, not immutable asset identity or ledger facts. The prototype public page uses `orrylo.com/p/<slug>`; Shared Issuer metadata is separate at `assets.orrylo.com`.

## Minimum non-deferable safety boundaries
- Customer Shared Issuer and RYLO issuer are separate; shared-issuer control must be disclosed.
- Stellar asset identity is asset code + issuer. Unique codes within an issuer are enforced durably.
- Authenticated wallet ownership, immutable complete issuance intent, idempotency and database permission boundaries remain enforced.
- Signing uses an approved, identity-verified isolated service. No change to active on-chain authorities, secrets, signer policies, or live deployment is authorized by this document.
- Submission uncertainty requires ledger reconciliation; only exact signed-envelope-bound trusted confirmation permits issuance/publication claims.
- Keep the existing security protections, schema migrations and tests in force unless a later independently reviewed change safely replaces them.

## Deferred from the MVP critical path
RYLO membership, reward, minting, purchase, treasury/liquidity, protected multisig operations, Dedicated Issuers, Soroban templates, custom domains, sophisticated governance, and generalized future-facing operational mechanisms. Their **implementation is deferred**; this proposal does not retroactively repeal previously approved economic or authority commitments or authorize bypassing deployed protections.

## First success criterion
A newly authorized customer completes the web journey to a real Testnet Shared Issuer asset, with exact issuer/code/amount/destination/network verification and truthful durable project state. Operator-assisted issuance alone is insufficient.

## Reference and recovery
- `AGENTS.md`: concise working rules.
- `docs/ARCHITECTURE.md`: lean component boundaries.
- `docs/OPEN_DECISIONS.md`: outstanding decisions needed for the current milestone.
- `docs/RYLO_POLICY.md`: brief deferred feature boundary.
- `docs/archive/2026-10-19/`: complete unchanged policy/document snapshot before simplification, for historical and security reference.
- Current GitHub code, migrations, tests, PRs and deployed/on-chain facts override a prose claim of implementation.

This draft intentionally removes long operational histories and advanced security **planning** from everyday context. Implementation-changing policy decisions must be reviewed before any live change.
