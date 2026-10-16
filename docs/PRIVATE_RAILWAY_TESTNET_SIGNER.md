# ORRYLO Private Railway Testnet Signer

Status: **implementation only — not deployed and no real secret provisioned**

This document describes the owner-approved bounded Testnet signer architecture
for one Shared Issuer MVP issuance. It does not authorize deployment, account
creation/funding, secret generation/import, account mutation, trustline
creation, signing/submission, or Mainnet/RYLO activity.

## Trust boundary

```text
Orrylo web application
  -> one authenticated HTTP request over Railway private networking
  -> isolated Testnet signer service
  -> exact Testnet/XDR/hash/issuer validation
  -> one Ed25519 signature
  -> signed envelope returned
  -> existing application-side signed-envelope validation
  -> existing persistence/submission/reconciliation flow
```

The signer is a primitive only. It does not decide token parameters, build a
replacement transaction, access issuance intent/database state, or submit to
Horizon.

Set `ORRYLO_TESTNET_SHARED_ISSUER_SIGNER_PUBLIC_KEY` on both web and signer to
the owner-approved operational public key. The seed must derive that key while
transaction source and asset issuer remain the configured Shared Issuer.
Preflight requires exactly the issuer master plus operational key, each weight
1, thresholds 1/1/1 and all flags OFF. The adapter and durable signing boundary
verify exactly one signature from the pinned key. Omitting this setting retains
the historical master-only policy; an unexpected on-chain signer set fails
before attempt creation. `/healthz` reports both non-secret public identities.

Existing owner-provisioned Railway secrets can be referenced without reading
values: set `ORRYLO_TESTNET_SHARED_ISSUER_SIGNER_SEED` to
`${{ORRYLO_SIGNER_SECRET_SEED}}` and `ORRYLO_TESTNET_SIGNER_REQUEST_AUTH_SECRET`
to `${{ORRYLO_SIGNER_REQUEST_SECRET}}` on the signer. Keep the source secrets
there. Web may reference the signer's request-auth variable, never either seed.
Build with development dependencies so TypeScript is available:
`npm ci --include=dev --no-audit --no-fund && npm run signer:build`.

## Railway layout

Use two services in the same Railway project and environment.

### 1. Orrylo web application

Public application service. Runtime receives:

- `DATABASE_URL`
- `ORRYLO_CONFIRMATION_WRITER_DATABASE_URL`
- `NEXT_PUBLIC_STELLAR_NETWORK=testnet`
- `ORRYLO_APPROVED_TESTNET_SHARED_ISSUER_PUBLIC_KEY`
- `ORRYLO_TESTNET_SHARED_ISSUER_FEE_STROOPS`
- `ORRYLO_TESTNET_SIGNER_PRIVATE_URL`
- `ORRYLO_TESTNET_SIGNER_REQUEST_AUTH_SECRET`

`ORRYLO_TESTNET_SIGNER_PRIVATE_URL` must be:

```text
http://<signer-service>.railway.internal:<port>
```

The application adapter rejects public URLs, HTTPS URLs, credentials embedded in
the URL, portless URLs and non-`railway.internal` hosts.

The web service must never receive the Stellar signer seed.

### 2. Private Testnet signer service

Use repository root `web` as the service root.

Build command:

```sh
npm ci --no-audit --no-fund
npm run signer:build
```

Start command:

```sh
npm run signer:start
```

Do not generate a public domain or TCP proxy for this service.

Runtime receives only:

- Railway-provided `PORT`
- `ORRYLO_APPROVED_TESTNET_SHARED_ISSUER_PUBLIC_KEY`
- `ORRYLO_TESTNET_SIGNER_REQUEST_AUTH_SECRET`
- service-scoped `ORRYLO_TESTNET_SHARED_ISSUER_SIGNER_SEED`

The final item is a runtime secret name only. No real seed belongs in repository
files, examples, documentation values, browser state, database state or logs.

The signer service receives no `DATABASE_URL`, confirmation-writer credential,
or Horizon configuration.

## Endpoints

### `GET /healthz`

Readiness only. It returns service name, `testnet`, configured issuer public
key and `ready: true`. It never signs and never reads a request body.

### `POST /v1/sign`

Requires:

```http
Authorization: Bearer <runtime service-auth secret>
Content-Type: application/json
```

The authentication check occurs before request-body parsing. The service uses a
constant-length SHA-256 digest plus Node timing-safe comparison. The auth secret
is never logged.

The only accepted JSON object is:

```json
{
  "transactionHash": "<64 lowercase hex characters>",
  "unsignedEnvelopeXdr": "<classic transaction envelope XDR>"
}
```

No network, issuer, destination, asset, amount, fee, operation or retry control
is accepted from the HTTP caller.

## Signer-side enforcement

Before signing, the service independently requires:

1. configured issuer is a checksum-valid Stellar public key;
2. configured issuer is not any repository-known RYLO issuer;
3. configured issuer is not the reserved `GBR7...ASSETS` candidate;
4. service-scoped signing key derives exactly that configured public key;
5. XDR parses as a classic transaction under the fixed Stellar Testnet
   passphrase;
6. envelope contains zero signatures;
7. transaction source equals the configured approved Shared Issuer;
8. the Testnet transaction hash recomputed from the XDR equals the exact
   request hash.

Only after all checks does the service invoke Ed25519 signing once. It does not
retry, persist the envelope, query a database or submit to Horizon.

## Application-side enforcement

`PrivateRailwaySharedIssuerSigningPrimitive` performs exactly one private HTTP
request. On any transport/non-2xx/invalid-response condition it fails closed
without retry.

A successful response must contain exactly:

- `ok: true`
- `network: "testnet"`
- the exact configured signer public key;
- one signed-envelope XDR.

Before returning that XDR to the existing signing policy, the adapter
independently checks:

- transaction source equals configured issuer;
- transaction hash equals the already-authorized exact hash;
- exactly one decorated signature exists;
- signature hint equals the configured issuer's Stellar signature hint;
- Ed25519 signature verifies against the exact transaction hash.

The existing `signDurableSharedIssuerTestnetEnvelope` then remains the outer
authority and revalidates the signed result. Durable intent/attempt binding,
canonical construction, signed-envelope provenance, one-shot Horizon submission
and exact-hash reconciliation are unchanged.

## Secret isolation evidence required before deployment authorization

Before any separate deployment approval, capture only non-secret evidence that:

- signer service has no public domain/TCP proxy;
- web and signer are in the same Railway project/environment;
- web variables do not contain the Stellar signer seed binding;
- signer service has no application/confirmation database URL;
- signer service has no Horizon submission configuration;
- signer public key equals the approved Shared Issuer public key;
- health endpoint is reachable from the web service over the private hostname;
- no log line contains the request-auth secret, signing seed or full environment.

Never capture or paste secret values as evidence.
