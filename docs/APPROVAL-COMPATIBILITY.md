# Mandate approval compatibility

The current Coinbase wallet rejects our combined token permission requests. Physical wallet evidence supersedes successful contract simulations and unit tests.

## Current design: one approval at setup for chat mandates

The wallet limit is one `SpendPermission` per prompt, so the number of prompts is cut by when they are asked, not by batching:

- **Chat mandate:** setup signs the USDC budget only. The first confirmed sell of a stock signs that stock's sell permission from the chat review sheet; the backend stores it beside the USDC permission (`POST /mandates/:id/permissions`), registers it on Base with `approveWithSignature`, and only then queues the order. Later sells of that stock do not prompt. A covered token is never re-prompted.
- **Automatic mandate:** setup signs USDC plus every stock, because the agent must exit positions without the owner present. The backend refuses an automatic mandate that does not cover every stock.
- **Chained prompts:** the transport waits for the app to be active, lets the previous Coinbase sheet settle, and retries a session that fails to start. Starting the next sheet while the previous one was dismissing produced "Coinbase could not open" after 1 of 6.

Custody is unchanged. The sections below record why batching is not an option and what a separate trading account would involve.

## Historical design before deferred sell approval

Use individual `SpendPermission` typed data through the existing `signTypedData` wrapper and `signPermissions` helper. Each signature covers precisely its token, spender, allowance, period and expiry. Checkpoint into the same approval draft after each returned signature. Display named-token progress, resume after interruption and retain all signatures after a save failure. Submit only a complete batch. Recover lost save responses with the existing random salt lookup.

For six selected stocks in an automatic mandate this means seven initial wallet approvals, including USDC. No new wallet approval is needed for trades inside the existing permissions. Wallet login remains separate. Joy replied yes to the restore-versus-redesign choice; Codex explicitly selected this conservative restore option and explained it before implementing build 9. This is not a one-confirmation flow.

## Investigate a separate trading account

A single USDC permission could fund a separate trading account; bought stocks would remain there for subsequent sells. This changes the current rule that stocks are returned to the primary wallet after each trade. It requires a deliberate choice of account ownership and signer authority, withdrawal/revocation behavior, balances, loss recovery and threat model. Account setup itself may still need an additional confirmation; do not promise one total signature before verifying the supported SDK flow.

Do not move existing holdings, add the backend agent as a primary-wallet owner, or silently expand authority. Research and a concrete design can proceed without transactions; implementing changed custody requires Joy's choice.

## Evidence

- Build 6: `SpendPermissionBatch` rejected with invalid primaryType.
- Build 7: transaction page raised No current request found; source of queue loss not conclusively established.
- Build 8: dedicated batch review rendered, but Coinbase static analysis explicitly blocked the direct SpendPermissionManager calls.
- Supported individual permission interface: https://docs.base.org/sdks/base-account/reference/spend-permission-utilities/requestSpendPermission .
