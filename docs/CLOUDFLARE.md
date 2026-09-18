# Cloudflare hosting

Mandate's web app and API run on Cloudflare Workers at `https://mandate.horizonbase.app`. The iOS app keeps its existing backend URL. A Cloudflare Tunnel formerly forwarded this hostname to port 8842 on Joy's Mac; the Worker now answers the entire hostname route without fetching the tunnel origin.

## Components

- Worker: `mandate-agent`, configured in `agent/wrangler.jsonc`.
- Durable Object: `MandateLedger`, named `mandate-production-v1`, backed by SQLite.
- Static assets: the Expo web app, plus the physical-device App Review recording at `/demo/mandate-build13-demo.mp4`.
- Durable alarms: pending activations, requested evaluations, automatic mandates and queued orders. A minute cron repairs missing alarms; active chat mandates need no idle polling.
- Base RPC: Alchemy public primary, PublicNode fallback, with bounded timeouts and no background endpoint ranking. Base, PublicNode and dRPC public endpoints rate limited cloud-origin requests during deployment checks. Alchemy passed direct and batched reads from the deployed Worker. Public RPC still has shared limits; configure a dedicated authenticated endpoint as a Worker secret before scaling. Endpoint reference: https://www.alchemy.com/rpc/base.
- Worker secrets: the existing `AGENT_PRIVATE_KEY`, `OPENROUTER_API_KEY`, `AI_CREDENTIALS_KEY`, `LIFI_API_KEY`, and operator `OWNER_ACCOUNTS`.
- Optional `RELAY_API_KEY` enables authenticated Relay quotes. Set it with `cd agent && npx wrangler secret put RELAY_API_KEY`; omit it for public quotes. [Swap routing and recovery](SWAP_ROUTING.md) describes provider fallback and current route checks.

The existing beta has a shared execution mode, globally capped AI budget and trading ledger. One durable ledger preserves that coordination contract and its existing limit of 100 active mandates. Static media bypasses the ledger. A larger rollout should partition trading state by wallet and explicitly coordinate the shared usage budget before changing the routing. Never create a second independently executing ledger with the same live signing key.

## Persistence and execution

The database, chat, encrypted per-wallet AI settings, AI usage reservations, execution mode, wallet sessions and single-use challenges are stored in SQLite documents. Documents are split into bounded chunks and replaced in a synchronous transaction. Runtime caches belong to the Durable Object via AsyncLocalStorage, rather than to a shared global database.

A prepared onchain transaction hash is recorded and cloud storage is flushed before broadcast. A storage commit failure prevents submission. On restart, interrupted executions are marked for reconciliation instead of blindly replayed. The hosted API uses durable alarms instead of detached timers for activation and retry requests.

Wallet sessions survive worker eviction/redeployment. Existing sessions from the old Node process cannot be migrated because they existed only in memory; the first cloud connection requires one wallet sign-in. Existing spending permissions and derived agent accounts remain unchanged because the signing root is preserved.

## Deployment

Use the repository's npm tooling, starting from the repository root:

```sh
npm ci
npm run web:cloud
cd agent
npm ci
npm run cloud:check
npm run typecheck
npm test
npm run cloud:deploy
```

The `web:cloud` command stages the generated browser app in `agent/cloud-assets/`. Before deploying the existing production service from a fresh clone, also stage the existing public recording under `agent/cloud-assets/demo/mandate-build13-demo.mp4`. The web build preserves that recording. Generated files and recordings are gitignored; deploy assets only from this explicit staging directory. Never put `.env`, runtime data or secret inputs there.

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


## Browser app and route compatibility

Run `npm run web:cloud` from the root before `npm run cloud:deploy` in `agent/`. This builds Expo Web and stages only generated web files into `agent/cloud-assets`, preserving the existing App Review recording. The build keeps the Base app verification meta tag. Generated assets are ignored by Git.

HTML navigation to app routes serves the phone UI; native requests with JSON content type continue to reach the same backend paths. Browser calls use `/api/*`. They are forwarded to the existing named Durable Object directly, without another HTTP hop or ledger. The static asset binding disables automatic HTML redirects because the Worker explicitly selects the SPA document. Unknown API routes never fall back to HTML.

Browser verification sets a Secure, HttpOnly, SameSite=Strict, host-only cookie. Its token is verified against the existing hashed durable sessions, so Worker eviction or redeployment does not lose authentication. The browser JSON response contains only a nonsecret marker. Cross origin writes, caller-supplied bearer credentials and internal migration paths are rejected by the browser adapter. The native bearer transport remains unchanged. Deployment smoke tests use an ephemeral unfunded wallet and never authorize spending or broadcast a transaction.

## Trading eligibility controls

Live mandate creation, evaluation requests, added permissions, chat confirmations and wallet swap plans require eligibility. The shared API enforces this for native bearer sessions and browser cookies. U.S. locations and territories (US, AS, GU, MP, PR, UM, VI), unknown locations and invalid country codes are denied. The Worker overwrites internal location headers from `request.cf.country`; caller-supplied `CF-IPCountry` or `x-mandate-country` values cannot grant access. A Node backend without trusted geography cannot authorize live trading.

Each wallet must declare a non-U.S. residence, non-U.S.-person status, eligibility under applicable jurisdiction restrictions and accuracy. The declaration is versioned, expires after 30 days and is stored privately in the existing durable ledger as an eligibility document. A connection check expires after 24 hours. Opening authenticated app pages refreshes it. Seeing a restricted or unknown location invalidates the declaration across all sessions; reconnecting through another location alone does not clear that restriction. Withdrawal immediately invalidates eligibility.

Existing wallets have no grandfathered eligibility. Automatic mandates pause until the wallet completes the declaration; queued live orders without eligibility are cancelled before execution. Scheduled evaluations require current eligibility. Permission registration, token pulls, swap approvals and swaps recheck before broadcast, including after asynchronous preparation. Already submitted transactions may settle. Returning completed swap output and revoking permissions remain possible; partial executions continue to use the existing manual-review journal. Pausing eligibility also pauses automatic stop-loss and take-profit exits.

Sign-in, portfolio/history reads, order cancellation and permission revocation remain available from restricted locations. In-app Settings links to Trading eligibility. Older TestFlight builds receive server errors linking to the web eligibility screen; the wallet must be the same. A new iOS release is required to ship the native eligibility form. Local web preview is bound to localhost; its cloud proxy sees the developer machine's location and must never be exposed as a public proxy.

These are application access controls, not KYC, proof of residency, a complete legal jurisdiction policy or confirmation of Builder Quest acceptance. IP geography can be inaccurate or obscured. Eligibility outside the U.S. still depends on the issuer's restrictions and the user's circumstances; no claim is made that every non-U.S. country is permitted. Review the issuer's requirements before expanding production access. Official references: https://x.com/buildonbase/status/2095105194539298895 and https://www.coinbase.com/tokenize.
