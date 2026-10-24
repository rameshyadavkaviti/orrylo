# Uploaded project logos — deployment gate

This feature is committed as application code only. **Do not deploy until object storage is configured and verified.**

## Storage
Provision one private S3-compatible Railway bucket for logos in the same Railway project. Do not enable public bucket access. Set these variables on the `orrylo` web service, preferably as Railway reference variables to the bucket:

- `ORRYLO_LOGO_S3_ENDPOINT` → bucket `ENDPOINT`
- `ORRYLO_LOGO_S3_BUCKET` → bucket `BUCKET`
- `ORRYLO_LOGO_S3_REGION` → bucket `REGION`
- `ORRYLO_LOGO_S3_ACCESS_KEY_ID` → bucket `ACCESS_KEY_ID`
- `ORRYLO_LOGO_S3_SECRET_ACCESS_KEY` → bucket `SECRET_ACCESS_KEY`
- `ORRYLO_LOGO_S3_URL_STYLE` → `path` or `virtual-host` as specified by Railway

Uploads are limited to 2 MiB and require wallet-session ownership and same-origin checks. Objects are immutable/content-addressed and served only for the currently referenced logo of a published, non-deleted project through `https://assets.orrylo.com/api/assets/logos/{projectId}/{sha256}.{ext}`. This route proxies a private object and sets an immutable public cache header. The image URL is persisted in `project_profiles.logo_url`; existing SEP-1 `[[CURRENCIES]]` generation uses that field.

After a new project is created, the builder uploads its selected logo **before** continuing to trustline, payment or issuance. If storage is unavailable, creation stops before the financial/issuance steps and provides a recovery path. If the user updates a published token's logo through the API, metadata publication is reconciled and the response reports verified vs pending; never claim success before the remote TOML check.

## Acceptance gates
1. Run `npm run typecheck`, `npm test`, `npm run build` from `web/`.
2. Test a small PNG, JPEG and WebP upload with an authenticated owner; reject forged files and >2 MiB files.
3. Verify wrong wallet cannot update the logo; anonymous and cross-origin writes are rejected.
4. Verify the project profile's `logo_url`, public image GET and the image entry in `https://assets.orrylo.com/.well-known/stellar.toml` after ledger-confirmed publication.
5. Verify Testnet issuance remains unchanged; verify Mainnet metadata update only with an already-confirmed token. No real Mainnet payment/issuance is authorized by this change.
6. Keep Railway deployment separate from this commit and explicitly owner-approved.
