# RYLO Policy — v1

Status: **Canonical policy intent / pre-implementation**

This document defines the approved RYLO policy. These rules are authoritative product/security intent, but they are not evidence that the corresponding issuer, Stellar operations, backend workflows, or production deployment already exist.

## 1. Purpose

RYLO is Orrylo's ecosystem utility token for:

- paying for Orrylo services;
- ecosystem membership;
- qualifying rewards;
- member-to-member transfer and secondary-market trading.

RYLO is not positioned as an investment product.

## 2. Issuer separation

RYLO must use an issuer separate from the Shared Issuer used for customer-created assets.

Reserved RYLO issuer candidate:

`GCKB453UWEFLJQY4TVW7I7NZV3ZNVUCZZS6KKIKJZVF75WM2VEORRYLO`

This address is a reserved candidate only and must not be represented as a live/testnet/mainnet deployment without explicit deployment evidence.

### Testnet issuer identity

The verified RYLO Testnet issuer is:

`GDNSIP2SKNJIKN6IG3XZBQMHIKKDET25J33F4R5V6DALKHIUDTVZOPKX`

The previous Testnet candidate
`GDPKHRFAGZHDJFKLBERV7IXF2XX4TGW6MYYUDGME3MIJ3HES5SGICG5H` is abandoned
and must not be used for Testnet RYLO identity, transaction construction, or SAC
derivation.

The deterministic Testnet SAC for
`RYLO:GDNSIP2SKNJIKN6IG3XZBQMHIKKDET25J33F4R5V6DALKHIUDTVZOPKX` is:

`CAPB6JBF466Y6TY4UBAQDSN24KTILN2R2CLINBGJSIGS5BTTEEDW3GMI`

This address does not prove that the SAC has been deployed. The obsolete
`CARDQUIZNFA56T4SNDNLG6WNIZQU2JIGPNOGXOCIL4CKECFNE6VFNMB3` address belongs
to the abandoned Testnet candidate and is not RYLO Testnet deployment evidence.

## 3. Supply model

Approved model: **Hybrid minting with a hard maximum-supply cap**.

- Maximum supply: **100,000,000 RYLO**
- Initial mint: **0 RYLO**
- Supply must never exceed the maximum cap.

Approved v1 mint sources are limited to:

1. **Direct Purchase shortfall mint**
2. **Reward mint**
3. **Bootstrap Liquidity mint**

Not approved for v1:

- arbitrary admin mint;
- manual discretionary mint;
- marketing mint;
- developer mint;
- emergency mint.

Every mint workflow must verify that the resulting total supply remains within the hard cap.

## 4. Direct Orrylo sale

Approved direct sale price:

**1 RYLO = 0.1 XLM**

This is the Orrylo direct sale price only. It is not a representation of intrinsic value, guaranteed market value, guaranteed resale value, or future value.

Direct purchase distribution is **Treasury-first**:

```
Treasury inventory available
→ transfer existing RYLO

Treasury inventory insufficient
→ mint only the approved shortfall
```

The previously considered rule that additional RYLO could be acquired only through Orrylo direct sales is rejected. Eligible/authorized users may trade RYLO with one another.

## 5. Treasury and service-spend policy

RYLO spent on Orrylo services is **not burned**.

Service-spent RYLO returns to the Orrylo Treasury and may later be recycled through approved distribution paths.

The Treasury has no separate balance cap beyond the global RYLO supply and workflow rules.

Treasury inventory does not create mint authority. Minting remains limited to the approved mint sources in this document.

## 6. Bootstrap liquidity

Approved Bootstrap Liquidity Reserve:

**1,000,000 RYLO**

Approved initial liquidity deployment:

**1,000 RYLO + 100 XLM**

Purpose:

- seed meaningful secondary-market liquidity;
- avoid a market whose tradable supply depends only on small user rewards;
- support member-to-member buying and selling.

The 1,000,000 RYLO reserve is the approved lifetime policy cap for Orrylo-managed bootstrap-liquidity allocation, not the total amount of RYLO that may ever be tradable.

The initial deployment uses only 1,000 RYLO, leaving **999,000 RYLO** of undeployed liquidity-reserve capacity.

Undeployed reserve capacity does **not** require advance minting. RYLO allocated from this reserve should be minted/deployed only when an approved liquidity operation actually requires it and remains subject to the global maximum supply cap.

Further liquidity additions beyond the approved initial 1,000 RYLO + 100 XLM deployment follow this approved staging model:

- no automatic release schedule;
- no mandatory monthly/periodic liquidity additions;
- use only real XLM that Orrylo has actually available for liquidity;
- prefer realized Orrylo revenue or separately approved capital rather than operational funds needed elsewhere;
- each addition is a protected, explicitly approved operation;
- each operation has a unique `request_id`, `policy_version`, and append-only audit evidence;
- the ordinary public application backend cannot independently execute the liquidity operation;
- undeployed reserve remains unminted until an approved liquidity operation actually requires it;
- total bootstrap-liquidity allocation can never exceed 1,000,000 RYLO.

The exact size of each future addition remains a case-by-case operational decision based on available XLM and then-current market conditions.

## 7. Eligibility

For the approved v1 token-creation path, a wallet becomes RYLO-eligible after its user's **first successful token creation** through Orrylo.

Eligibility:

- is bound to the Stellar wallet/public key;
- is permanent by default;
- is not removed by zero RYLO balance;
- is not removed by selling all RYLO;
- is not removed by inactivity;
- is not removed by disconnecting an Orrylo session;
- is separate from Stellar trustline authorization.

Routine discretionary admin revocation is not part of v1.

Eligibility may only be revoked under an explicitly defined exceptional security/legal policy.

Any additional eligibility path, including product-purchase qualification, must be explicitly specified before implementation.

## 8. Free Build Credit and launch reward

Approved Free Build Credit:

**50 RYLO-equivalent**

This is internal Orrylo service credit, not RYLO. It is not minted, transferable, or tradable.

Approved first-successful-token reward:

**150 RYLO**

Launch reward rules:

- reward window is **60 days** from a fixed official launch timestamp;
- the official timestamp must be stored/configured explicitly;
- a successful first token creation after the window may still create eligibility, but does not automatically earn the launch reward;
- each wallet may receive the first-token reward at most once;
- reward uniqueness must be enforced by wallet public key + reward type;
- reward retry must be idempotent;
- supply cap must be checked before mint.

No dedicated anti-Sybil system is required for v1 unless later evidence justifies one.

## 9. Controlled access and transfer policy

RYLO is a controlled-access Stellar asset.

Approved target behavior:

- only eligible wallets may be authorized to hold/receive RYLO;
- creating a trustline alone does not grant authorization;
- Orrylo must explicitly authorize an eligible wallet's RYLO trustline;
- authorized eligible wallets may buy, sell, receive, and transfer RYLO with other authorized eligible wallets;
- no additional transfer cap, cooldown, or temporary authorization period is approved for v1;
- authorization does not expire merely because the user becomes inactive or has a zero balance.

Approved issuer flags:

```
AUTH_REQUIRED   = ON
AUTH_REVOCABLE  = ON
AUTH_CLAWBACK   = OFF
```

Clawback is intentionally not part of the approved v1 policy.

## 10. Authorization execution model

Eligibility is determined by Orrylo application policy, but actual RYLO trustline authorization must be enforced on Stellar.

Approved high-level flow:

```
Eligibility approved
→ user has/creates RYLO trustline
→ Orrylo backend creates bounded authorization request
→ secure issuer-signing path validates policy
→ Stellar trustline authorization operation is co-signed
→ transaction is submitted
```

The browser must never possess an issuer secret.

The ordinary application backend must not directly custody the RYLO master key.

## 11. RYLO issuer signer model

Approved signer architecture:

**2-of-3 multisig**

Roles:

### Signer A — Operational

- online;
- held in a signing service separated from the main application backend;
- used for normal authorized operational workflows;
- cannot complete protected actions alone.

### Signer B — Owner / policy co-signer

- maintained in a separate environment under Orrylo owner control;
- independently verifies policy before co-signing;
- is not a blind signer.

### Signer C — Recovery

- offline;
- not used for routine operations;
- reserved for recovery and signer replacement.

### Master key

- not used for routine operations;
- not stored in the frontend, repository, or ordinary application server;
- retained only under an explicitly protected recovery arrangement.

Daily trustline authorization remains subject to the two-signature control; it must not be downgraded to a single-signer path merely for convenience.

### Locked Testnet signer mapping

Verified signer identities currently present on the RYLO Testnet issuer:

- Master / issuer key: current weight **1**;
- Signer A:
  `GB5V6M5EQGDWVDH66ZX6GF2NOJADUDU6ZWKEZJCZZNXUBSYLBHZIM2F3`, weight **1**;
- Signer B:
  `GC52EXPMDMAQ3WDPGAW2MJJOS5FAUNLE2KHPAESJUWZ4NETVYSWTJZR5`, weight **1**;
- Signer C:
  `GBWRVDTU4KTNTIPASSBPFGLGYUFOBI4TZPVKHGA3D23QIXLHY7XT2F3T`, weight **1**.

Current Testnet thresholds are **low=0, medium=0, high=0**. These values are
pre-ceremony state and are not the approved final configuration.

The locked final Testnet account mapping is:

```text
Master = 0
A      = 1
B      = 1
C      = 1
low    = 2
medium = 2
high   = 2
```

Interpretation:

- routine protected operations use **A + B**;
- **A + C** or **B + C** is reserved for an explicit recovery procedure;
- no individual signer may independently authorize issuer operations.

Required Testnet safety sequence:

1. Keep the Master signer at weight **1** during initial configuration.
2. Configure A, B, C and the intended low/medium/high thresholds.
3. Successfully test and prove the routine **A + B** authorization path.
4. Only after the **A + B** test succeeds may the Master signer be reduced to
   weight `0`.

A successful **A + C** or **B + C** recovery-path test must not be treated as
satisfying the prerequisite for Master weight `0`.

This locks the account-level Testnet signer/threshold policy. It does not select
the final production key-management provider, Signer B service infrastructure,
master-key storage mechanism, signer-rotation procedure, or recovery ceremony
implementation.

Approved operational matrix:

- routine financial/authorization operations use **Signer A + Signer B**;
- this includes trustline authorization, Reward Mint, Direct Purchase shortfall mint, Bootstrap Liquidity mint, Treasury transfer, and Liquidity Add;
- Signer B independently parses and validates the transaction/policy and is never a blind co-signer;
- Signer C is not used for routine operations;
- Signer C may participate only in recovery or signer replacement under an explicit recovery procedure;
- the Master Key is not used for routine operations;
- critical operations such as signer rotation, threshold changes, issuer-flag changes, recovery, or master-key configuration use a manual/local ceremony with explicit owner approval and audit evidence.

## 12. Signer B co-signing policy

Signer B must independently reject any authorization transaction unless all applicable policy checks pass.

For normal RYLO trustline authorization, it must verify at minimum:

- target wallet is eligible;
- issuer is the expected RYLO issuer;
- asset code is exactly RYLO;
- authorization target is the intended eligible wallet;
- operation type/flags exactly match approved policy;
- no unexpected additional operation is included;
- network is the expected network;
- transaction validity window is acceptable;
- sequence/state is current enough for the workflow;
- request has not already been completed or superseded.

Signer B must parse and validate the canonical transaction itself, not merely trust a backend summary.

## 13. Mint authority and co-signing

Mint execution uses the same protected two-signature principle.

Each mint request must:

- have a unique server-side request ID;
- identify one approved mint source;
- match the amount and destination required by that source;
- verify the hard supply cap immediately before signing/submission;
- contain no unrelated operation;
- be independently policy-checked by Signer B;
- be idempotent across retries;
- be written to the audit trail.

Direct Purchase mint may create only the shortfall remaining after Treasury inventory is applied.

## 14. Failure, retry, and idempotency

Protected authorization/mint workflows must use one durable logical intent per action.

Typical lifecycle:

```
created
→ signed_a
→ signed_b
→ submitted
→ confirmed
```

Rules:

- each workflow has a unique request ID;
- retry continues the same logical intent rather than creating an untracked duplicate;
- prior signatures may be reused only while the exact canonical transaction remains valid and unsubmitted;
- expired time bounds or invalid sequence/state require a new transaction under the same logical intent;
- before resubmission, Orrylo must distinguish a real failure from a submission whose response was lost;
- the chain state must be checked before generating an equivalent replacement;
- retries must not create duplicate authorization, duplicate reward, or unexpected mint outcomes.

## 15. Audit trail

Authorization, mint, and other protected issuer workflows require append-only audit events.

Record at minimum where applicable:

- event ID;
- request ID;
- wallet/public key target;
- event timestamp;
- network;
- workflow state;
- canonical transaction/envelope hash;
- transaction hash after submission;
- Signer A signing event;
- Signer B policy-approval/signing event;
- policy version;
- submission result;
- ledger/confirmation evidence;
- failure code;
- retry count;
- initiating system/operator actor.

Never log:

- secret keys;
- seed phrases;
- raw private signing material;
- session tokens;
- credentials sufficient to reconstruct a signer.

Approved retention target:

- security/authorization/financial audit records: **2 years**;
- ordinary operational debug logs: **90 days**.

Audit events should be append-only. The approved integrity direction is to include event/timestamp/request identifiers and a previous-event hash/event hash chain so historical modification is detectable.

Audit export itself should be auditable.

## 16. Transparency and investment-policy boundary

RYLO interfaces must distinguish clearly between:

- RYLO amount;
- Orrylo direct sale price;
- market price;
- reward amount;
- Build Credit;
- eligibility;
- authorization;
- on-chain state;
- platform policy.

Orrylo must not advertise or implement guaranteed return, guaranteed yield, profit share, guaranteed appreciation, or promises tied to future token price without a separate architecture/economic/legal review.

## 17. Not yet implementation evidence

The policies above are approved intent. Current verified Testnet evidence is
limited to the selected issuer account and the presence of Signers A, B, and C
at weight `1` alongside the Master signer at weight `1`. Testnet thresholds
remain `0/0/0`, approved issuer flags remain unset, and no RYLO has
intentionally been minted.

They do not by themselves prove that Orrylo has:

- completed the RYLO issuer multisig/threshold ceremony;
- set the approved issuer flags;
- disabled the Master signer for routine operation;
- deployed signer services;
- deployed the RYLO SAC;
- minted any RYLO;
- created the liquidity pool;
- funded liquidity with XLM;
- performed trustline authorization;
- executed a reward/direct sale;
- deployed to testnet or mainnet.

Deployment and implementation claims require repository/on-chain evidence.
