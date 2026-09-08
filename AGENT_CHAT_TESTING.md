# Agent chat: implementation and phone testing

The Agent tab supports stock discussion and reviewable buy/sell requests through the configured OpenRouter model. Chat does not directly execute model output.

## Test on your iPhone

1. Keep the iPhone and Mac on the same network and the local backend running. The current development build uses `http://192.168.50.122:8842`.
2. Connect Coinbase and verify wallet ownership when prompted. Complete passkey/Face ID yourself.
3. In Settings → AI configuration, enter your OpenRouter key, select a model, and tap **Save & connect**. No separate development token is required. Wait for “Saved and connected.” The key is encrypted on the backend for your verified wallet and survives backend restarts. Never paste credentials into Agent chat. A real-provider chat check still requires your valid key.
4. Create a mandate with **I confirm in chat**, a $100 weekly budget, and Apple selected. In simulation this saves an unsigned plan; it does not request spending permissions. Existing automatic mandates keep their automatic behavior.
5. Open Agent → Controls, select this mandate, then **Check authorization**. Expect “Simulation ready,” not a claim that real spending rights are approved.
6. Ask “Explain Apple and its risks” or “Compare Apple and NVIDIA.” Replies can include Chainlink feed links and price timestamps. They do not have live news or web search.
7. Ask “Buy $10 of Apple.” Review the stock, USDC amount, estimated shares and reference timestamp. No order exists until you tap Review simulation and confirm.
8. The order appears in Orders, queued for 60 seconds. Cancel it during that window to test cancellation, or let the simulator fill it and inspect History. No real funds move.
9. Ask for an amount above the position limit (for example $90 of Apple with the balanced $100 mandate). Expect a limit explanation, not a silently resized order.

## Safety and scope

- Backend wallet authentication and ownership scope all chat, authorization and confirmation routes.
- Buy/sell output is schema-validated, resolved against supported tokens, and checked against mandate status, mode, expiry, stock universe, current budget and position limits.
- A proposal expires after five minutes. Confirmation rechecks market data and limits; a reference-price move over 1% requires a new proposal. Share-based buys are explicitly estimated USDC-budget orders, not exact-share limit orders.
- Confirmation uses the saved proposal, not client-supplied amounts. Proposal ID doubles as the durable order ID, so a retry cannot place a duplicate order.
- Confirmed orders use the existing execution checks and transaction journal. Unknown or partial live transactions remain quarantined. A chat order cannot silently expand a sell fraction or reduce a buy amount to fit a changed limit.
- Chat-only mandates do not run background trades or automatic risk exits. Automatic mandates are still labeled as such in Controls.
- Live authorization checks query approved/revoked permission state on Base. A ready permission does not guarantee wallet balance, market availability or successful execution.
- Simulation signatures are neither requested by the new client nor retained by the server on new mandate creation. Previously stored signatures are not retroactively deleted or revoked.
- Existing live selected-stock permissions have effectively unlimited token allowances. This is explicitly disclosed before approval; do not treat the USDC budget as an onchain stock-sell limit. Live trading remains disabled in this development backend.
- The most recent 100 messages per wallet are stored in the backend’s private atomic JSON store. Messages and recent context go to the configured OpenRouter model; wallet addresses, spending signatures and API keys are excluded from app-supplied model context.
- Chat shares existing persistent daily token budgets and concurrency limits; messages have a five-second cooldown. Background AI evaluations retain their one-minute cooldown.
- Hide balances also hides conversation text, drafts, amounts and proposal details, and disables confirmation until visible review is possible.

## Verification

Run `npm test`, `npm run test:ui`, `npm run typecheck`, `npm --prefix agent test`, and `npm --prefix agent run typecheck`.

Chat regressions use isolated temporary storage, generated test wallets, mocked provider responses and mocked chain data. They do not spend funds or call a paid model. Native layout evidence is in `.impeccable/review/agent-*.png`; those screenshots use explicitly labeled preview data on an iPhone simulator, not the user’s real trading account.

The app is a single-backend-process development system. This change does not add web/news search, exact-share execution, voice calls, or a multi-user production deployment.
