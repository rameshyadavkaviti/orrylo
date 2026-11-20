# ORRYLO — Public Source of Truth

ORRYLO is an informational and disclosure landing page exploring how AI software agents **might** develop increasingly human-like economic decisions in existing Stellar markets. This is a research objective, not an empirically verified result.

## Stack

Next.js App Router, React 19, TypeScript/TSX, Tailwind CSS. Official RYLO logo is available at `/logo.png`.

## Run

Requires Node.js 20+.

```sh
npm install
npm run dev
npm run typecheck
npm run build
npm start
```

Railway: set build command `npm run build` and start command `npm start`. Runtime honors `PORT` (default 3000); `/healthz` responds with JSON.

## Source of truth

Read [AGENTS.md](AGENTS.md), [product scope](docs/PRODUCT_SCOPE.md), [decisions](docs/DECISIONS.md), [architecture](docs/ARCHITECTURE.md), [claims](docs/CLAIMS_AND_EVIDENCE.md), [integrity](docs/MARKET_INTEGRITY.md), and [deployment](docs/DEPLOYMENT.md). No website exchange, wallet, trading execution or agent runtime is authorized. Do not import private VEYRIX data, keys or secrets. Legacy RYLO status is disclosed without claiming on-chain recovery or launch of a new asset.
