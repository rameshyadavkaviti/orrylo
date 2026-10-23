# Orrylo — Clean MVP Source of Truth

Status: **Active rebuild scope / requirements**, not proof of a functioning replacement.

## Purpose
Orrylo is a Stellar token-creation platform. The approved core product story is **connect a pre-funded wallet → pay 10 XLM → create the first token → verify and show the real result**. A first token is **not free**. Each subsequent distinct Mainnet token creation also costs 10 XLM. The payment-enabled Mainnet path is a product target, not an assertion of live availability.

## Primary user journey (product truth)
1. User arrives with an existing, sufficiently funded Stellar wallet; Orrylo does not require wallet creation or funding as part of the primary journey.
2. User connects/authenticates the wallet and enters the new token's details.
3. Orrylo shows the exact 10 XLM service price, network and any separate Stellar reserve/transaction requirements.
4. User explicitly authorizes a uniquely bound **Mainnet** payment of 10 XLM to the verified Treasury destination.
5. Once the payment is independently confirmed, Orrylo creates the token safely exactly once, verifies the on-chain result and automatically publishes the project/metadata where supported.
6. User sees the confirmed asset, issuer, amount, transaction and project page; failures or unknown outcomes are reconciled without duplicate charging or blind reissuance.

This is the approved Mainnet business journey. **Existing Testnet issuance must remain functional and does not collect real XLM.** Preparatory Mainnet accounts already created by explicit owner-approved manual steps are documented below. This description itself grants no further authority to submit transactions, alter account signers, change deployment or activate live customer funds.

## Product boundaries
- The Shared Issuer is Orrylo infrastructure; explicitly disclose that it is not user-owned.
- Shared asset identity is `asset code + issuer`, and codes must not collide under that issuer.
- A durable project identifier must be distinct from changeable public URL/slug and issuer metadata location.
- RYLO is **out of scope** for the active product, onboarding, pricing, payment and rewards. It is separately governed as an independent tradable Stellar asset under [RYLO_POLICY.md](RYLO_POLICY.md) v2. That policy does not introduce an RYLO dependency into customer token creation or authorize Mainnet financial operations.
- No fictitious token creation, unverifiable publication claims or implied Mainnet deployment.

## Minimum security invariants
- No issuer secret in browser, normal web backend, source control, logs or database.
- User authentication and ownership of requests are server-verified.
- Full exact network/issuer/code/amount/destination issuance intent is committed before signing; idempotent requests do not issue twice.
- Verify receiving wallet trustline, current issuer and signer identities, network, signing policy and transaction contents.
- Signing access is isolated and scoped. Do not change actual issuer/account authority without owner authorization.
- A timeout or unknown submission must be reconciled on Stellar, not blindly retried or released as unused.
- A successful API response or local database status cannot substitute for signed transaction/ledger evidence.
- Only confirmed exact ledger data may produce an issued/publication claim.

## Approved future Mainnet pricing (not activated)
For customer-created Mainnet assets, **there is no free creation quota**: each creation, including the first, is priced at **10 XLM** payable on Mainnet only. No RYLO rewards, purchases, trustlines or other RYLO steps are part of the active customer journey. The binding requirements for order/payment verification, safe recovery/refunds, abuse protection and activation tests are in [MAINNET_PRICING_POLICY.md](MAINNET_PRICING_POLICY.md). This is product policy, not permission to enable Mainnet processing, modify signers or send transactions. The current Testnet path remains unaffected.

## Current Mainnet implementation and cross-chat continuation checkpoint (2026-10-23)

**Read this section first when resuming ORRYLO from a new chat or agent session.** The repository and verified ledger/database evidence, not chat claims, remain authoritative for latest state. Working repository: `rameshyadavkaviti/orrylo`; active branch: `rebuild/clean-mvp`; latest user-confirmed branch commit immediately before this checkpoint: `7cab3bb` (`chore(security): upgrade Next.js to 16.4.2`). GitHub Direct edits and read-only Neon queries may be done with connected tools; user runs local Linux tests and separately approves production changes. Uncommitted work from an interrupted Work session is intentionally discarded. Do not touch `main`, `legacy/pre-rebuild`, deployed secrets, or Railway settings without authorization.

### Approved minimal customer path
Existing prefunded **Mainnet** Stellar wallet / Albedo login → token details → owner-bound immutable order for exactly **10.0000000 XLM** → customer authorizes a single uniquely bound Mainnet XLM payment → independently verify its exact transaction on Mainnet Horizon → customer creates/verifies trustline for the exact shared issuer+code → isolated issuer signs/submits once → exact-hash ledger confirmation → automatic public project page and TOML/logo metadata. Mainnet service pricing is in XLM only, with separate fees and trustline reserve requirements. **Do not reuse the Testnet-only trustline/signer path as Mainnet code without explicit network separation and review.** The Testnet path must remain operational and unpaid.

### Manually provisioned Mainnet infrastructure (public facts; reverify against Horizon before use)
- Shared Issuer: `GBR7SEZD4ITXQPAWEVBX2BULS76ERDRTRMIS3LUYKZ7DNLGZZ6ASSETS`; user-confirmed funded and single signer/master weight 1 with low/medium/high thresholds 1/1/1. Do not change authority or assert high-security multisig. Testnet issuer is different.
- Customer payment Treasury: `GAABHXPQQB3EBT6FZJKGR6C6DT7XJEUEBGVPK2G2AQDKBIVXCBKXDBR7`; user independently confirmed active on Mainnet with `3.0000000 XLM`, master signer weight 1 and low/medium/high thresholds **0/0/0**. **This is a prelaunch custody-risk item requiring independent security review before customer funds are accepted**, not a sign-off to leave authority unchanged forever. Never conflate this Treasury with issuer or RYLO account.
- Operations/Funder exists as CLI identity `orrylo-mainnet-funder`; public address `GCLZ6AXEQ2U2KAI62AWDLLDI4EIHOUGRVFTNAHTT44S2MX3GWQAGTCHR`. User approved the 3 XLM Treasury account creation; do not silently repeat it. Secrets are kept locally/offline and must never be pasted into chat or committed.

### Confirmed code and database changes
- `web/lib/stellar/mainnet-payment-verification.ts`: read-only Horizon check for one successful native 10 XLM operation, authenticated source, configured Treasury destination and exact text memo, returning confirmed/rejected/not_found. No customer money is sent by this module.
- `web/db/migrations/013_mainnet_token_orders.sql` applied by an owner-approved transactional migration to Neon **orrylo** project `patient-mud-07610204`, production branch `br-lingering-dream-b4wg7r3p`, database `neondb`. Table `mainnet_token_orders` exists; `schema_migrations` checksum was registered; role `orrylo_app` has SELECT/INSERT/UPDATE; no PUBLIC grants; immediately after migration, table row count was 0. Migrations `001`–`012` pre-existed; file numbered `011_mainnet_token_orders.sql` was replaced with `013` to avoid a collision. Do **not** re-run migration 013 manually.
- `web/lib/server/projects/mainnet-token-orders.ts`: durable owner/project/issuer/code/amount/Treasury/memo/expiry binding, idempotent create, conditional settlement, uniquely consumed payment hash and ledger-payment timestamp checks. Implementation needs payment/order integration and adversarial DB tests before use with real funds; a successful code commit alone is not a security audit.
- `POST /api/mainnet/orders` and `POST /api/mainnet/orders/[orderId]/payment`: authenticated order creation and read-only-ledger-backed conditional settlement. Both are gated on `NEXT_PUBLIC_STELLAR_NETWORK=public` and `ORRYLO_MAINNET_ORDERS_ENABLED=true`; **do not enable these on Railway yet**. No wallet payment submission is wired at present.
- New preparatory code (committed after the first checkpoint): `web/lib/stellar/mainnet-payment-plan.ts` builds an **unsigned**, one-operation, exact 10 XLM native payment XDR with the immutable order memo and Stellar public network passphrase; `prepareMainnetOrderPayment` fetches the authenticated order and Horizon source sequence. `POST /api/mainnet/orders/[orderId]/prepare` has a separate disabled-by-default flag `ORRYLO_MAINNET_PAYMENT_PREPARE_ENABLED=true` **in addition** to the global order gate. No wallet calls, transaction signatures, or submissions occur in this route. `web/tests/mainnet-payment-plan.test.ts` was added but is NOT YET locally executed, and this new code has NOT YET passed local typecheck/build. Treat it as pending verification, not launch-ready.
- `web/components/create-shared-token-form.tsx` and `web/app/create-token/page.tsx`: UI dispatches to the Mainnet order endpoint when public network is selected and displays the non-payable order, while retaining the Testnet-only ChangeTrust and issuance path.
- Local `web/tests/mainnet-payment-verification.test.ts`: user reported **5/5 pass**. After local worktree upgrade/cherry-pick, user reported successful `npm run typecheck` and `npm run build` under Next.js **16.4.2**. Confirmed Git branch `HEAD` and `origin/rebuild/clean-mvp` at `7cab3bb` following cherry-pick. This does **not** establish route integration, database-concurrency tests or successful Mainnet end-to-end issuance.
- Local tooling caveats: `web/package.json` requires Node `>=22 <23` but the reported local Node was `v24.22.1`; npm audit reported **5 high** vulnerabilities without details. `eslint-config-next` was still `16.4.0` while `next` was upgraded to `16.4.2`. Investigate before final launch. Never run `npm audit fix --force` blindly.
- The user's local working directory contains untracked `*.xdr` files, a file named `HTTP`, and `tsconfig.tsbuildinfo`. Do not stage, overwrite, upload, or delete Stellar XDR without owner's explicit instruction. An earlier stash may remain from the cherry-pick; inspect before popping.

### Remaining gates, strict order
1. **First on resumption:** run and repair local `npm run typecheck`, `node --import tsx --test tests/mainnet-payment-plan.test.ts tests/mainnet-payment-verification.test.ts`, and `npm run build` for the newly committed unsigned XDR preparer; review payment verifier/order logic and fix races, expiry, memo/source/network, offline replay/recovery gaps, plus adversarial DB tests. Do **not** let user manually send 10 XLM based on displayed memo/address; require explicit wallet-controlled submission and reconciliation.
2. Integrate Albedo Mainnet payment UX with persisted exact-hash pending/reconciliation state; independently settle in PostgreSQL, ensure no duplicate charges/credit, never trust wallet callback as proof.
3. Build isolated Mainnet trustline verification/authorization and separate signer/issuance orchestrator (without overwriting Testnet). Preserve paid-order linkage, one-winner issuance and exact hash reconciliation.
4. Reconcile publication/TOML/logo against actual Mainnet confirmed issuance; do not publish from a payment alone.
5. Perform local tests, adversarial cases, controlled safe rehearsal, security review of Treasury 0/0/0 thresholds and signer custody, Rails/Neon app-role checks, audit findings and explicitly authorized deployment. The owner alone approves opening real customer payment/issuance. Check that Railway deployment is actually healthy; never infer it from GitHub.

**Next concrete engineering task at this checkpoint:** locally verify/fix the committed unsigned Mainnet payment XDR builder and API (newest relevant commit at this checkpoint `5e42f99`), strengthen expiry/replay/concurrency invariants, and only then design a recoverable Albedo Mainnet payment handoff. The Albedo action and real submission remain disabled until the prior safety gates are passed. To continue in a new chat: read this file, `AGENTS.md`, `MAINNET_PRICING_POLICY.md`, the listed modules and latest commits; compare actual GitHub/Neon state; pick up the first remaining gate. Avoid relying on lost chat context.

## Deferred but discoverable
RYLO-related features remain excluded from the active customer product; the independently approved RYLO v2 policy is documented separately and not yet activated. Complex issuer multisig/governance, Dedicated Issuer contract control, Soroban templates, nonessential Mainnet infrastructure expansion, custom-domain automation and speculative anti-abuse infrastructure are deferred. The bounded Shared Issuer / Treasury / Funder Mainnet accounts listed above have already been manually created and must not be re-provisioned. Historical material is retained only as archival reference, not active requirements. Existing approved policy and implementation evidence remain in the permanent legacy branch for explicit reevaluation when needed.

## Source precedence
Current rebuild code/tests and reproducible deployment facts govern implementation status. **This file is the canonical source for current product intent and takes precedence over previous conversation decisions, assistant recollections, and historical RYLO policy.** Technical layout is in `ARCHITECTURE.md`, milestone gates in `ROADMAP.md`, and payment safety requirements in `MAINNET_PRICING_POLICY.md`. Current code/tests and verifiable deployment facts determine what is actually implemented. Historical policies and the predecessor remain in `legacy/pre-rebuild` as archive only.

The past owner-approved preparatory funding and migration actions are historical facts, not standing permission for more live signing, funding, key handling, issuer configuration, database mutations, deployment or mainline promotion. Each further live action requires an explicit authorization.
