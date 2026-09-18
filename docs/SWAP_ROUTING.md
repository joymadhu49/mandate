# Swap routing and recovery

Relay is the preferred quote provider. `SWAP_PROVIDER=lifi` makes LI.FI preferred instead. If the preferred provider reports a missing route, network failure, rate limit, or authentication failure, quote discovery tries the other provider once. Both providers keep their transaction validation. Rejected requests, redirects, and invalid transaction responses stop without fallback.

`RELAY_API_KEY` is optional. Requests omit attribution when no key is configured. A configured key rejected with HTTP 401 and `UNAUTHORIZED` or `UNAUTHORIZED_QUOTE` is retried once without the key and referrer. HTTP 403 is not retried. The deployed Worker reads keys from secrets; local Node development reads `agent/.env`. See `agent/.env.example`.

Live chat checks the requested token pair, direction, and amount before offering a proposal and again before queueing the confirmed order. Simulation does not need a route. Execution obtains a new quote after the cancellation window and before pulling funds. A Chainlink reference price alone does not prove a stock can be traded.

If a quote expires during the transfer/approval steps, or its transaction fails preparation with a revert before signing, execution obtains one fresh quote. The replacement must meet the original minimum output. It rechecks the approval target and does not pull funds twice. A recorded swap transaction, including one with an uncertain broadcast or reverted receipt, is never retried this way. Existing failed-order recovery returns stranded balances to the owner.

## Read-only routing check, September 18, 2026

Public quotes requested 1 USDC on Base for each stock, with 1% slippage and no API keys. Both providers' successful responses were then passed through the application's validators.

| Stocks | Relay | LI.FI |
| --- | --- | --- |
| AAPLc, AMZNc, GOOGLc, METAc, MSFTc, MSTRc, NVDAc, SNDKc, SPCXc, TSLAc | Validated quotes | Validated quotes |
| COINc, CRCLc, INTCc | `NO_SWAP_ROUTES_FOUND` | `1002` (no quote) |

This establishes provider availability for those requests at that time. It does not establish that liquidity is absent everywhere on Base, or that a quoted transaction will execute successfully. No trade was signed or submitted during this check. Sell routes and other amounts can differ.

Provider references: [Relay quote errors](https://docs.relay.link/references/api/api_core_concepts/handling-errors), [LI.FI error codes](https://docs.li.fi/api-reference/error-codes).
