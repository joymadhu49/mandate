# Cloudflare hosting

Mandate's API runs on Cloudflare Workers at `https://mandate.horizonbase.app`. The iOS app keeps its existing backend URL. A Cloudflare Tunnel formerly forwarded this hostname to port 8842 on Joy's Mac; the Worker now answers the entire hostname route without fetching the tunnel origin.

## Components

- Worker: `mandate-agent`, configured in `agent/wrangler.jsonc`.
- Durable Object: `MandateLedger`, named `mandate-production-v1`, backed by SQLite.
- Static assets: the physical-device App Review recording at `/demo/mandate-build13-demo.mp4`.
- Durable alarms: pending activations, requested evaluations, automatic mandates and queued orders. A minute cron repairs missing alarms; active chat mandates need no idle polling.
- Base RPC: Alchemy public primary, PublicNode fallback, with bounded timeouts and no background endpoint ranking. Base, PublicNode and dRPC public endpoints rate limited cloud-origin requests during deployment checks. Alchemy passed direct and batched reads from the deployed Worker. Public RPC still has shared limits; configure a dedicated authenticated endpoint as a Worker secret before scaling. Endpoint reference: https://www.alchemy.com/rpc/base.
- Worker secrets: the existing `AGENT_PRIVATE_KEY`, `OPENROUTER_API_KEY`, `AI_CREDENTIALS_KEY`, `LIFI_API_KEY`, and operator `OWNER_ACCOUNTS`.

The existing beta has a shared execution mode, globally capped AI budget and trading ledger. One durable ledger preserves that coordination contract and its existing limit of 100 active mandates. Static media bypasses the ledger. A larger rollout should partition trading state by wallet and explicitly coordinate the shared usage budget before changing the routing. Never create a second independently executing ledger with the same live signing key.

## Persistence and execution

The database, chat, encrypted per-wallet AI settings, AI usage reservations, execution mode, wallet sessions and single-use challenges are stored in SQLite documents. Documents are split into bounded chunks and replaced in a synchronous transaction. Runtime caches belong to the Durable Object via AsyncLocalStorage, rather than to a shared global database.

A prepared onchain transaction hash is recorded and cloud storage is flushed before broadcast. A storage commit failure prevents submission. On restart, interrupted executions are marked for reconciliation instead of blindly replayed. The hosted API uses durable alarms instead of detached timers for activation and retry requests.

Wallet sessions survive worker eviction/redeployment. Existing sessions from the old Node process cannot be migrated because they existed only in memory; the first cloud connection requires one wallet sign-in. Existing spending permissions and derived agent accounts remain unchanged because the signing root is preserved.

## Deployment

Use the repository's npm tooling in `agent/`:

```sh
npm ci
npm run cloud:check
npm run typecheck
npm test
npm run cloud:deploy
```

The empty `agent/cloud-assets/` directory is included for a fresh-clone dry run. Before deploying the existing production service, stage the existing public recording under `agent/cloud-assets/demo/mandate-build13-demo.mp4`. This directory and recordings are gitignored; deploy assets only from this explicit staging directory. Never put `.env`, runtime data or secret inputs there.

The existing hosted deployment already has its secrets. A fresh deployment must configure its own secrets and initialize the ledger through the guarded import path before the API becomes available. Change the account ID, worker name and route to your own infrastructure first. Never reuse the hosted signing root for an independent executor. Use `wrangler secret put NAME` or a protected JSON file with `wrangler secret bulk`; never put values in source or CLI arguments. `.dev.vars` is local test configuration only and must use a separate unfunded signer and simulation data.

## Migration and rollback

The September 8 migration preserved the existing trading ledger, chat history and encrypted AI settings. The import checks the signing-root address and active mandates' derived agent addresses, decrypts the credential vault to validate its key, and refuses to replace an already initialized ledger.

The original snapshot and owner-readable backups remain under `agent/data/`. `cloud-cutover.json` records the exact backup location; `cloud-import-receipt.json` records the imported counts. `cloud-hosted.json` prevents the old local entrypoint from starting with this live ledger. Use a separate database and signer for local development.

`SCHEDULER_ENABLED=0` is a maintenance setting: it stops durable execution, rejects API mutations and guards onchain submission. For code rollback, prefer rolling back the Worker version while retaining the same Durable Object. Do not restart the old local snapshot after new cloud activity: it would be stale. A return to local hosting requires disabling cloud execution, exporting and reconciling current state, and then moving the route.

The one-time `MIGRATION_TOKEN` was deleted after verification. The old token now receives 404; an initialized ledger also rejects repeat imports. The temporary local bulk-secret file and diagnostic logs were removed.

## Checks

- Existing backend regression suite, plus storage isolation and commit-before-broadcast tests.
- Local cloud runtime: guarded import, EOA signature verification, replay denial, operator restriction, data isolation, session and challenge persistence after restart.
- Local alarm test: a simulation mandate becomes active without incoming requests.
- Production: public URL and demo respond while both the local Node backend and tunnel are stopped; wallet verification, persistent sessions, agent-address derivation, AI research and a strictly validated $1 ETH to USDC LI.FI quote pass with an unfunded test account.

No live trade is used as a deployment smoke test.

## Runtime compatibility

The deployed runtime rejected `fetch(..., { redirect: 'error' })` with a TypeError before sending a request. OpenRouter and LI.FI now use `redirect: 'manual'` and reject non-success responses, so credentials are never forwarded to redirect destinations. Tests cover redirect rejection. Provider transport failures log only the error type and a timeout classification, not prompts or credentials.

## LI.FI API access

The Mandate Partner Portal integration is `mandate`, with surface URL `https://mandate.horizonbase.app`. Its API key is stored as the encrypted Worker secret `LIFI_API_KEY` and sent only from the backend using `x-lifi-api-key`. It is not in the iOS binary or repository.

Anonymous LI.FI calls initially returned HTTP 429 from Cloudflare because public quotas are per source IP. The Partner Portal key changes the quota to per key: https://help.li.fi/hc/en-us/articles/12111455848859-What-is-the-LI-FI-API-rate-limit. After adding the secret, a read-only quote passed from the deployed Worker in 1.27 seconds.

From `agent/`, use `node cloud-scripts/check-session.mjs` and `node cloud-scripts/check-quotes.mjs` to check the existing unfunded smoke session, AI research, Base RPC and LI.FI. The quote check never signs or broadcasts the returned transaction. Use `cloud-scripts/verify-deployment.mjs` to generate a fresh unfunded session if needed; that script checks signer continuity against the protected local signing root.
