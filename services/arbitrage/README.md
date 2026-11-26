# ORRYLO arbitrage scanner — Phase 1

Independent Railway service running a **read-only paper scanner** for Stellar XLM/USDC and XLM/VELO order books.

- Zero orders, zero signatures, zero transfers. There is no live execution code.
- Only public Horizon order-book data is read.
- Asset issuers are fixed, not symbol-only matching.
- 30-second polling, 9-second request deadline.
- Conservative cost buffer and maximum hypothetical trade of 10 XLM.
- A displayed paper candidate is an *indicative quote*, never a guaranteed arbitrage profit or a simulated fill.
- Logs are JSON; no private keys, tokens, or wallet addresses are logged.
- No market-making, coordinated wallets, self-crossing, or manipulation.

`TREASURY_PUBLIC_KEY` is optional for scanning; `TREASURY_SECRET_KEY` must be sealed in Railway. This worker **never reads** the secret. Do not switch it to live mode without a separately reviewed execution subsystem, tests, operational risk limits and explicit approval.

Start: `npm start`. Test: `node --check main.mjs`.
