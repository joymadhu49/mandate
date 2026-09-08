# Mandate web preview

The web build shares the iPhone screens and keeps a 430 by 932 logical pixel phone frame centered on black. The frame fits smaller browser windows. Navigation stays at the bottom; there is no desktop dashboard layout.

Run from the repository root:

```sh
npm run web
```

Open http://localhost:8082. After editing, run `npm run web:build` and refresh. An already running server serves the new build without a restart. `npm run web:serve` starts a previously built copy.

The browser uses the Base Account SDK. Connect the same Coinbase wallet as the iPhone app, then verify it to load existing mandates, orders and conversations. The local gateway forwards the existing hosted agent API. This is not a simulated backend: the app displays the hosted execution mode and wallet approvals retain their real effect.

The gateway binds only to the loopback interface and accepts the localhost host. No environment files, agent private keys or provider credentials are loaded. Backend bearer credentials stay in server memory, referenced by a random HttpOnly, SameSite cookie. Restarting this local server requires wallet verification again. Browser requests cannot override the upstream or inject authorization. State changing requests require the same origin and JSON content type.

This Node gateway is deliberately local only. The hosted app uses `agent/src/browser-api.ts` in the existing Cloudflare Worker, with Secure, HttpOnly cookies backed by the existing durable sessions. The native API is preserved. Run `npm run web:cloud` to stage the production assets, then `npm run cloud:deploy` from `agent/`.

A small TestFlight link stays at the top of the phone frame. Browser confirmations render inside that frame with keyboard focus trapping and Escape dismissal.

Checks:

```sh
npm run typecheck
npm run test:web
npm test
npm run test:ui
npm audit
```

The CDP SDK currently pins an affected Axios release. The scoped override in package.json selects patched Axios 1.20.0. Keep it until the upstream dependency updates.
