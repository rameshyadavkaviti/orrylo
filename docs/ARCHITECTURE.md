# Architecture & operational boundaries

```text
Visitors -> orrylo.com -> Public announcement/risks/(later) verified SEP-1 home-domain
Human traders ---> existing Stellar public market / AMM / order book
AI agents ------> existing Stellar public market / AMM / order book
```

The website is NOT an exchange, wallet, market maker, trade executor, or agent controller.

## Components
- Public repository `orrylo` — documentation and lightweight Node 20+ web server.
- Separate private project VEYRIX — behavioral and trading research; do not import any private source/person data here.
- Existing Stellar chain markets — actual matching and settlement, independent of Orrylo web server.

## Railway migration
New isolated Railway project: `orrylo-v2`. Existing Railway project `orrylo` has old app domain `orrylo.com` and old asset hostname `assets.orrylo.com`. The user approved removing both custom domains from old service, but NOT deleting old signer services, file storage or legacy private repo. Transfer apex only after new app health verified. Changes to DNS at registrar/Cloudflare are separate from Railway custom-domain ownership.

## Asset-specific home domain
There is no approved issuer/asset to publish a new stellar.toml yet. Old home-domain association and metadata links MAY break after the old domains are removed. This impact is accepted as part of retiring old websites; any later official SEP-1 metadata must use verified issuer and explicit confirmation.