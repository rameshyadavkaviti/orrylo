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


## Phase 2 candidate — read-only triangular quoting (feature branch)

`triangular.mjs` is an independent, **not automatically started** candidate scanner. The production start command remains `node main.mjs` until a separate explicit review. It examines two loops: XLM → USDC → VELO → XLM and XLM → VELO → USDC → XLM, using Stellar Horizon `/paths/strict-send` with **direct** conversion paths only. Horizon may choose a pool or order book within a hop; this scanner does **not** assert which venue filled a hypothetical trade.

- `node triangular.mjs`: read-only live-mainnet quotes, no signing or transaction submission.
- `npm test`: deterministic Node built-in unit tests with mock Horizon responses.
- Paper budget assumptions: 700 XLM capital, 500 XLM emergency reserve, maximum 10 XLM evaluated per route.
- Assumed 60 bps execution friction plus 0.003 XLM network/operational-fee allowance per three-leg route; report only above 50 bps *estimated net*.
- Quotes missing liquidity, inconsistent issuers, last-ledger header, recent ledger close, or coherent ledger window are discarded.
- A `PAPER_CANDIDATE` is **not** a filled trade, PnL record, profit, or proven executable arbitrage.
- Outstanding before production integration: validate Horizon quote formats/headers against real responses; timestamp-aligned snapshots, independent execution-slippage modeling, issuer trustline authorization and balance constraints, one-transaction atomic execution design, persistent journal, replay-based backtests, kill switch, daily realized-loss controls, user authorization for any live trading.

Do not merge or switch Railway's start command until those validations have been reviewed. The wallet-research script, if separately supplied, only uses public account APIs.
