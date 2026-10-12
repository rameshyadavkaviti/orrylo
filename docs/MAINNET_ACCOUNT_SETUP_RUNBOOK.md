# Orrylo Mainnet — Owner Account Setup, Custody and Activation Runbook (v1 draft)

**Status:** PROCEDURAL DRAFT / NOT EXECUTION AUTHORIZATION. This runbook implements already approved account topology and signing-policy documentation; it does not select keys, account addresses, funding amounts, account flags, operational limits, counterparties or providers. Do not create accounts, submit transactions, change signer weights, deploy, grant roles or transfer funds under this document alone.

**Authoritative references:** `AGENTS.md`, `docs/SOURCE_OF_TRUTH.md` §§10–10.2, `docs/RYLO_POLICY.md`, `docs/ARCHITECTURE.md`, `docs/OPEN_DECISIONS.md`. Resolve any discrepancy against the canonical approved policies before proceeding. Separately test and approve Mainnet actions, even if Testnet exercises succeeded.

## 1. Five-account inventory and decision boundaries

| Infrastructure Stellar account | Approved purpose | Routine authority model | Owner must separately approve before setup |
| --- | --- | --- | --- |
| ORRYLO — RYLO ISSUER | Issue and authorize RYLO only | 2-of-3; routine A + independent policy B; C recovery-only | Final Mainnet public key, account flags, weights/thresholds, custody, recovery and issuer transitions |
| ASSETS — SHARED ISSUER | Shared-tier customer assets only | 2-of-3, with independent routine approval and recovery | Final public key, issuance authorization, signer model details, flags, custody, recovery |
| TREASURY | Receive direct-sale XLM, safeguard RYLO inventory, reserves and realized service revenue, make authorized disbursements | 2-of-3 | Final public key, payment-verification and order-bound delivery process, withdraw approvals, key custody |
| OPERATIONS | Limited network-fee/operational working funds | One isolated routine signer; independent recovery/rotation path | Balance/replenishment limits, permitted actions, monitoring, incident plan and key custody |
| LIQUIDITY | Hold Orrylo-managed pool assets/shares; initiate controlled deposits/withdrawals | 2-of-3 | Pool identity, funding approvals, LP share custody, signing policy details, withdrawal/incident plan |

**Counting:** These are five distinct Orrylo-operated infrastructure Stellar accounts. A, B and C refer to signing authorities/keys, **not automatically three additional Stellar accounts**. Application DB users, confirmation service, customer wallets, per-project Dedicated Issuers and pool contracts are not part of this five-account count.

**Current candidate keys:** The branded ORRYLO and ASSETS addresses recorded in canonical documents remain *candidates*; do not automatically assign or fund them. The documented RYLO Testnet issuer and its Testnet signer keys are **not Mainnet deployment evidence**. Never reuse Testnet secret keys for Mainnet custody.

## 2. Security rules that apply at every gate

- **STOP before every on-chain action.** Show the owner network, public source/destination, asset, amount, fee, ledger conditions, signing request and exact intended account change. Obtain a fresh, specific authorization for that action. An approval of this runbook is never transaction authorization.
- **Public data only in GitHub:** approved public keys, observed ledger state, transaction hashes, checksum-verified artifacts, nonsecret policy versions, signatures' public verification information and evidence URLs. Never commit secret seeds, mnemonic/recovery phrases, private signer exports, unencrypted backups, passphrases or credentials.
- **Owner manual step:** generate, import or recover signing keys only through separately reviewed offline/hardware-backed methods. Keep secrets and recovery instructions privately in hardened, owner-controlled storage with recoverable backups; do not paste them into ChatGPT, GitHub, issues, screenshots, public CI, app forms or test logs.
- **Network separation:** independently verify Stellar PUBLIC/Mainnet passphrase and account state, rather than inferring state from address spelling or Testnet balances. Verify destination public keys by a second trusted channel before funding.
- **No implicit grants:** a 2-of-3 requirement for protected operations must be proven from the actual signers/weights and the relevant Stellar low/medium/high thresholds. Threshold configuration alone does not enforce business limits, recipient allowlists, per-order approval, or a native daily spend limit. Enforce those in the isolated signer/policy system and funding strategy.
- **Avoid lockout:** do not set master weight to zero or change thresholds until each required normal authorization and owner-approved recovery path has been proven on the actual account under a controlled ceremony, with a reviewed rollback plan. For RYLO follow its specific A+B proof prerequisite.
- **No live payment activation:** Treasury direct-sale XLM receipt is approved, but binding payment proof to the customer's order, atomicity/compensation, failed/partial payments, refunds and RYLO-delivery recovery remain implementation gates.
- **No hidden authority:** do not represent fixed/capped/dedicated or contract-controlled issuance if undisclosed keys or account signers can override the declared on-chain control model.

## 3. Gate 0 — Reconcile state, dependencies and owner inventory (READ ONLY)

**Agent/operator may:** inspect only public ledger state and approved source-of-truth files. No secrets, key generation or state mutation.

- [ ] Refresh GitHub `main`, canonical docs, open policy decisions, merged PR history and actual Mainnet vs Testnet implementation/deployment evidence.
- [ ] For each of the five roles, record public-key candidate / **not selected**, observed network existence, home domain, sequence, balances, signer weights, thresholds, flags, trustlines, liabilities and sponsorship/minimum-balance constraints as available.
- [ ] Explicitly mark which facts are **unverified**, **candidate only**, or **approved but not activated**.
- [ ] Independently inventory custody responsibility and recovery readiness **without collecting or revealing any seed**.
- [ ] Verify role separation and absence of accidental Testnet key reuse.

**Owner manual checkpoint:** confirm that the inventory describes the accounts you intend to control. Store a private mapping of each role to signing device location, backup/recovery custodian and recovery procedure in a secure personal record. Public keys and approved nonsecret metadata may be placed in the repository.

**Gate exit:** a read-only inventory with no unknown accounts silently accepted, plus a list of unresolved approvals. If evidence is missing, stop rather than infer.

## 4. Gate 1 — Explicit account identity, funding and custody approvals (NO TRANSACTIONS)

For **each** proposed Mainnet account present a separate owner decision record:

| Field | Record only public/nonsecret information in the PR |
| --- | --- |
| Role and account identity | ORRYLO / ASSETS / TREASURY / OPERATIONS / LIQUIDITY; candidate vs approved public key |
| Network | Mainnet / PUBLIC network passphrase |
| Proposed signer authorities | public keys, role of A/B/C or operational signer, proposed weights and low/medium/high threshold plan |
| Account flags and home domain | exact proposed values and rationale; issuer-only changes reviewed independently |
| Master key | current/proposed weight and explicit owner-controlled ceremony/rollback plan |
| Funding | public funding source, initial amount, reserves/fees, timing and owner approval |
| Custody | named internal custodian roles and recovery ownership, without any confidential credentials |
| Rollback / failure | how to halt before any irreversible step and recover from failed/partial action |

- [ ] RYLO issuer final public key and configuration expressly approved; it cannot be reused for customer assets.
- [ ] Shared issuer final public key/configuration separately approved; candidate ASSETS vanity address is not automatically chosen.
- [ ] Treasury direct-sale destination public key approved and verified with an independent channel.
- [ ] OPERATIONS allowed balance/replenishment rules and actual enforcement approved.
- [ ] LIQUIDITY pool selection, asset/pool compatibility and permitted withdrawal/custody model approved.
- [ ] Independent signers and custody controls reviewed; do not silently use the same compromised authority for all four 2-of-3 accounts.
- [ ] Recovery steps and key loss/compromise response approved.

**Owner manual checkpoint:** privately generate and independently back up secrets only after selecting secure tooling; use a hardware wallet or reviewed isolated environment when available. Never share secret values with agents. Verify the public key derived from each secret **locally** and retain a secure private backup-location inventory.

**Gate exit:** separately approved identities/custody/funding *proposals*. Still **no account creation, funding or permission changes** until a specific execution authorization.

## 5. Gate 2 — Testnet rehearsal of account and signing ceremonies

- [ ] Rehearse account configuration on Testnet with **Testnet-only** keys/funds and record public ledger evidence.
- [ ] Verify independent A+B routine signing and B's independent canonical transaction policy inspection for RYLO.
- [ ] Test each other 2-of-3 account's intended protected operations and the separately approved recovery ceremony; avoid a single signer's bypass path.
- [ ] Test OPERATIONS funding limits and custody separation under adversarial conditions; avoid claiming a native Stellar spend cap.
- [ ] Verify the actual trustline/authorization needs for RYLO distribution and customer assets, including flags and account reserves.
- [ ] Independently test a liquidity withdrawal using the intended position/pool; document possible changes in returned XLM/RYLO amounts.
- [ ] Independently check legacy or pre-existing account signer configuration before any master-key reduction.
- [ ] Get Security approval of test evidence, including lockout and emergency recovery simulations.

**Owner manual checkpoint:** practice recovering from an offline backup *without uploading recovery phrases*. Retain the private rehearsal procedure and locations; only nonsecret pass/fail and public transaction evidence may enter GitHub.

**Gate exit:** Security-reviewed rehearsal evidence; this does not itself authorize Mainnet.

## 6. Gate 3 — Per-account Mainnet authorization ceremony (SEPARATE OWNER APPROVAL PER ACTION)

For each exact action: **plan → independent security review → owner approval → owner/approved custodian signs in isolated boundary → submit once → independently read ledger → record public evidence → verify no unexpected authority**.

- [ ] Obtain explicit approval of intended account create/fund or setup transaction, including XLM amount and full network/fee details.
- [ ] Check transaction signatures/thresholds and independently verify envelope against owner-approved intent; keep the signing secret in its protected device/service.
- [ ] Confirm funding and minimum native reserve before adding trustlines, signers, sponsorship or flags.
- [ ] Install signer keys, weights and operation thresholds incrementally; independently verify real ledger state after each transaction.
- [ ] Test actual required 2-of-3 normal signers and recovery path before disabling any master authority.
- [ ] For RYLO, prove **A+B** routine authorization before any master-weight-zero operation; C must not substitute for this proof.
- [ ] Treat issuer flags, master-key transitions and signer rotation as separately gated high-risk operations.
- [ ] Independently verify final account role, public key, flags, thresholds, signer set, sequence and balance.
- [ ] Security checks that no hidden/unapproved authority remains and nothing was deployed unexpectedly.

**Owner manual checkpoint:** preserve each relevant hardware/offline backup and emergency recovery material privately; confirm backups remain accessible to the intended custodian and *not to the public application*. Record exact approvals and resulting **public** transaction hashes.

**Gate exit:** each approved account separately attested with actual Mainnet ledger evidence, not merely a completed checklist. Stop on any ambiguity.

## 7. Gate 4 — Financial flow activation (NOT APPROVED BY THIS RUNBOOK)

**RYLO direct sale:**
- XLM receipt destination: approved **TREASURY**, never OPERATIONS, and only its owner-approved Mainnet public key.
- Treasury-first RYLO delivery is existing policy; mint only permitted shortfall subject to RYLO rules.
- [ ] Prove an immutable idempotent order/payment intent and trusted independently verified Stellar payment at the exact Treasury address, for the exact source, asset, amount, memo/order context and network.
- [ ] Prove confirmation/finality policy, duplicate/replay resistance, refund/failed-delivery recovery, and that a receipt alone is never marked as delivered.
- [ ] Require independent approval for Treasury distribution and RYLO issuer operations; no application-controlled signer keys.

**OPERATIONS / LIQUIDITY:**
- [ ] Enforce approved working-balance and refill policy in custody/operations systems, not via fictional Stellar daily limits.
- [ ] Liquidity requests do not automatically debit TREASURY. Each transfer, pool deposit/withdrawal and LP share movement has an individually approved plan and two authorized signatures where required.
- [ ] Test liquidity conservation, errors and realistic withdrawal outcomes; original XLM amount is **not** guaranteed.

**Gate exit:** separate owner and Security authorization for any production payment, liquidity pool action or issuer execution. No action is authorized merely because this section exists.

## 8. Incident response, retention and handoff

- If account state, signer authority, payment confirmation or custody integrity is uncertain: **stop signing and submission**, preserve audit/evidence, isolate relevant runtime credentials, and request independent security investigation.
- Plan signer rotation/recovery without assuming one compromised authority can be overridden by the ordinary web backend. Do not destroy the only viable recovery path.
- Keep confidential custody details and seed backups **outside** repository/agent artifacts; expose only sanitized evidence needed for audit.
- For each completed gate provide: exact accountable owner approval, ledger/network evidence where applicable, observed-versus-target state, CI/security evidence if code changed, unresolved risks and a clear next authorization.
- Existing RYLO security/financial audit retention requirements remain authoritative; do not infer new retention periods here.

## 9. Still-open architecture and policy decisions

This runbook deliberately leaves unresolved the final Mainnet public keys, issuer and account flags, low/medium/high weights, signer providers and recovery procedures, initial funding amounts, OPERATIONS cap/enforcement and replenishment, exact liquidity pool implementation, safe XLM-payment/RYLO-delivery settlement, and Testnet-to-Mainnet deployment sequencing. Review `docs/OPEN_DECISIONS.md` before each gate.

**No secrets, transactions, funding or account configuration are approved by this procedural document.**
