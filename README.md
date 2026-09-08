# Mandate

**Give your agent a budget, not your keys.**

Mandate is a native iPhone app for Coinbase Tokenized Stocks on Base. Connect a Coinbase wallet, set a USDC budget, choose stocks and trading rules, then confirm trades in chat or authorize automatic execution.

Built for the Base Builder Quest. [Project website](https://mandate.horizonbase.app) · [Source](https://github.com/joymadhu49/mandate)

## How it works

1. **Sign in with Coinbase.** A wallet signature authenticates access to mandates, orders and history. Signing in does not authorize spending.
2. **Set a mandate.** Choose the budget, period, expiry, stocks, position limits and control mode.
3. **Approve spending permissions.** Chat mandates request the USDC permission at setup and a stock's sell permission on its first sale. Automatic mandates request USDC and each selected stock's sell permission at setup.
4. **Trade within the rules.** Chat proposals require confirmation. Automatic mandates evaluate in the background. Accepted orders have a 60 second cancellation window before execution.
5. **Review or revoke.** Follow orders and activity, inspect transaction steps, and revoke permissions from the app or your Base Account.

USDC allowance, period, expiry and authorized spender are enforced onchain. Stock selection, position limits, price checks and trade strategy are enforced by the backend. Stock sell permissions have large allowances, disclosed before approval. The execution sequence pulls funds to the agent account, swaps through LI.FI and returns the output to the user's wallet; it is not atomic. Partial executions stop for reconciliation.

## Architecture

| Component | Implementation |
| --- | --- |
| iPhone app | Expo SDK 57, React Native 0.86, Expo Router, TypeScript |
| Wallet | Coinbase Base Account through Mobile Wallet Protocol |
| Authentication | Single-use wallet challenge, server session, device SecureStore |
| API | Hono, deployed on Cloudflare Workers |
| Persistence | SQLite Durable Object with persistent sessions and trading state |
| Scheduling | Durable alarms with a cron watchdog |
| Execution | viem, Base Spend Permission Manager, Chainlink feeds, LI.FI |
| AI | OpenRouter structured responses with deterministic validation and usage limits |

The hosted agent works while the development laptop is off. Local Node hosting remains available for isolated development. Each wallet has a derived agent account that pays its own transaction fees.

## Local development

Requires Node.js 22.13 or newer and npm. iOS builds require macOS and Xcode. See the [versioned Expo SDK 57 documentation](https://docs.expo.dev/versions/v57.0.0/).

```sh
git clone https://github.com/joymadhu49/mandate.git
cd mandate
npm ci
npm ci --prefix agent
cp agent/.env.example agent/.env
npm run dev --prefix agent
```

The example contains blank credential fields and starts in simulation mode. Add your own development OpenRouter key to `agent/.env` for AI responses. The local backend creates a separate signing key and database under ignored `agent/data/`. Never copy production keys or the production ledger into a development checkout.

In another terminal, build the app against the local API:

```sh
EXPO_PUBLIC_AGENT_API_URL=http://127.0.0.1:8842 npm run ios
```

For a physical phone, use your Mac's private LAN address instead of `127.0.0.1`. The URL is public client configuration; never put a credential in an `EXPO_PUBLIC_*` variable. Without an override, a fresh development build defaults to localhost. To build against the hosted service, set `EXPO_PUBLIC_AGENT_API_URL=https://mandate.horizonbase.app`. Native `ios/` and `android/` projects are generated locally and excluded from Git. Configure your own Apple signing team when building for a device.

## Verify

```sh
npm run typecheck
npm run typecheck --prefix agent
npm test
npm run test:ui
npm test --prefix agent
npm run cloud:check --prefix agent
```

Backend unit tests use temporary state and mocked providers. The cloud check generates Worker types, typechecks and bundles a deployment dry run. It does not deploy. Operator scripts under `agent/cloud-scripts/` are separate, manually invoked checks; some contact the configured production service and use private local operator files.

## Cloudflare deployment

See [deployment and recovery](docs/CLOUDFLARE.md). Use your own Cloudflare account, route and signing root for an independent deployment. Provider keys and signing material belong in Worker secrets, never in `wrangler.jsonc`, the frontend or GitHub.

The repository includes non-secret Worker settings and an empty asset staging directory. Runtime state, recordings, `.env` files, `.dev.vars`, private keys, certificates, build outputs and local handoff notes are excluded. `agent/.env.example` is the only environment template included; its credential fields are empty.

## Project guide

- [Trading flow and enforcement boundaries](docs/HOW-TRADING-WORKS.md)
- [Coinbase approval compatibility](docs/APPROVAL-COMPATIBILITY.md)
- [Phone chat testing](AGENT_CHAT_TESTING.md)
- [UI design system](DESIGN.md)
- [Product specification](PRODUCT.md)

The app is a beta. The recorded demo shows wallet sign-in, mandate setup, spending approval and an enforced position limit; it does not demonstrate a completed trade. TestFlight installation depends on Apple's beta review. Real execution requires user approvals and a funded agent account. This repository has not undergone an independent security audit.

## License

MIT. See [LICENSE](LICENSE). This is an independent project, not affiliated with Coinbase or Base. Not investment advice.
