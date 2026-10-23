# ORRYLO Mainnet MVP activation checklist

The Mainnet customer workflow is implemented but deliberately disabled. This
checklist must be completed only after explicit activation approval. None of
these steps authorizes a development-time payment or issuance.

## Fixed identities and price

- Network: Stellar public network only.
- Shared Issuer: `GBR7SEZD4ITXQPAWEVBX2BULS76ERDRTRMIS3LUYKZ7DNLGZZ6ASSETS`.
- Treasury: `GAABHXPQQB3EBT6FZJKGR6C6DT7XJEUEBGVPK2G2AQDKBIVXCBKXDBR7`.
- Customer price: exactly `10.0000000 XLM` (`100000000` stroops).
- Treasury, Shared Issuer, and every RYLO account remain separate identities.

## 1. Database boundary

1. Back up the Neon database and record the restore point.
2. Apply migration `016_mainnet_token_issuance.sql` with the migration-owner
   credential, not the web application credential.
3. Run `npm run db:verify:read-only` with the production schema and migration
   directory.
4. Confirm `orrylo_app` has only the migration-defined column-scoped Mainnet
   update grants and cannot update or delete confirmation evidence.

## 2. Private signer service

Build with `npm run signer:build` and start the isolated service with
`npm run signer:mainnet:start`. It must have no public domain and must be
reachable only over Railway private networking.

Signer-service variables:

- `ORRYLO_MAINNET_SIGNER_ENABLED=false` until the activation change window.
- `ORRYLO_MAINNET_SHARED_ISSUER_PUBLIC_KEY` equal to the fixed issuer.
- `ORRYLO_MAINNET_ISSUER_MAX_FEE_STROOPS` set to the approved positive cap.
- `ORRYLO_MAINNET_SIGNER_REQUEST_AUTH_SECRET` set to a strong service-only token.
- `ORRYLO_MAINNET_SHARED_ISSUER_SIGNER_SEED` present only on this isolated service.
- Railway-provided `PORT`.

Verify the authenticated `/healthz` over the private network returns the
expected service, `public` network, fixed issuer and signer identities, and
`signingEnabled: false`. Do not submit an issuance during this check.

## 3. Web service configuration

Keep `ORRYLO_MAINNET_CREATION_ENABLED=false` until final approval. Configure:

- `NEXT_PUBLIC_STELLAR_NETWORK=public`.
- `NEXT_PUBLIC_STELLAR_HORIZON_URL=https://horizon.stellar.org`.
- `ORRYLO_MAINNET_SHARED_ISSUER_PUBLIC_KEY` and
  `ORRYLO_MAINNET_TREASURY_PUBLIC_KEY` set to the fixed identities above.
- `ORRYLO_MAINNET_TREASURY_VERIFIED=true` only after a fresh read-only identity
  check.
- Approved positive issuer fee and customer fee ceilings.
- `ORRYLO_MAINNET_SIGNER_PRIVATE_URL` set to the private internal URL and
  `ORRYLO_MAINNET_SIGNER_REQUEST_AUTH_SECRET` set to the matching secret.
- Application `DATABASE_URL`.
- Keep `ORRYLO_MAINNET_ORDERS_ENABLED=false` and
  `ORRYLO_MAINNET_PAYMENT_PREPARE_ENABLED=false` until the activation window.

The issuer seed must not exist on the web service, in Neon, or in GitHub.

## 4. Read-only acceptance checks

1. Re-run `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build`.
2. Confirm the issuer is the fixed account with thresholds `1/1/1`, exactly one
   master signer of weight `1`, and enough spendable XLM for the approved fee.
3. Confirm the Treasury is the fixed separate account and can receive 10 XLM.
   Its current `0/0/0` thresholds are a launch-critical custody finding: obtain
   an explicit security acceptance or separately authorized remediation before
   accepting customer funds. This checklist does not authorize an authority
   change.
4. Confirm `https://assets.orrylo.com/.well-known/stellar.toml` is served only
   by the Shared Issuer publication route.
5. Confirm `https://orrylo.com/.well-known/stellar.toml` still contains only the
   RYLO namespace.
6. Confirm an authenticated draft remains private and creates no payment or
   issuance transaction.
7. Confirm signer unavailability leaves an issuance attempt in `prepared`, and
   that an ambiguous claimed attempt only reconciles its exact hash.

## 5. Explicit activation

After written approval, enable the isolated signer first and verify its private
health identity. Then enable `ORRYLO_MAINNET_CREATION_ENABLED=true`,
`ORRYLO_MAINNET_ORDERS_ENABLED=true`, and
`ORRYLO_MAINNET_PAYMENT_PREPARE_ENABLED=true` on the web service. Monitor the
first approved live order end to end: exact Treasury
payment, trustline, one issuance hash, ledger confirmation, `/p/{slug}` landing
page, and independently fetched metadata. Never create a replacement issuance
for a publication or verification failure.

Rollback is to disable new Mainnet order creation. Existing paid or claimed
orders must remain intact and be reconciled from their persisted transaction
hashes; they must not be deleted or reissued.
