// The backend's root for browsers: what Mandate is and how to get the app.
// API clients (the app, curl) still get the JSON health document; see app.ts.

const escape = (s: string) => s.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] as string));

export function landingPage(input: { publicUrl: string; testFlightUrl?: string; repoUrl?: string; dryRun: boolean }) {
  const testFlight = input.testFlightUrl ? escape(input.testFlightUrl) : '';
  const repo = input.repoUrl ? escape(input.repoUrl) : '';
  const mode = input.dryRun ? 'Simulation · no real funds' : 'Live · real funds';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Mandate</title>
<style>
  :root{--bg:#0A0A0F;--card:#14141C;--line:#262633;--text:#F2F2F7;--muted:#9A9AAE;--base:#0052FF;--link:#729FFF;--amber:#F59E0B}
  body{margin:0;background:var(--bg);color:var(--text);font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif}
  main{max-width:640px;margin:0 auto;padding:56px 20px 80px}
  h1{font-size:40px;line-height:1.1;letter-spacing:-.02em;margin:0 0 8px}
  .tag{color:var(--muted);font-size:18px;margin:0 0 32px}
  h2{font-size:18px;margin:32px 0 10px}
  p{margin:0 0 12px}.muted{color:var(--muted)}
  .btn{display:inline-block;background:var(--base);color:#fff;text-decoration:none;font-weight:600;padding:14px 22px;border-radius:14px}
  .btn.off{background:var(--card);color:var(--muted);border:1px solid var(--line)}
  .card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px 18px;margin:12px 0}
  code{font-family:"SF Mono",Menlo,monospace;background:#1B1B26;padding:2px 6px;border-radius:6px;font-size:14px;word-break:break-all}
  ol{padding-left:22px}li{margin:6px 0}a{color:var(--link)}
  .mode{display:inline-block;font-size:13px;font-weight:600;padding:3px 10px;border-radius:999px;background:#2F2410;color:var(--amber)}
  .mode.live{background:#12291D;color:#22C55E}
</style></head><body><main>
  <h1>Mandate</h1>
  <p class="tag">Give your AI agent a budget, not your keys. Trade Coinbase Tokenized Stocks on Base with spending permissions you approve at setup and can revoke any time.</p>
  ${testFlight ? `<a class="btn" href="${testFlight}">Get the iPhone app on TestFlight</a>` : `<span class="btn off">iPhone app on TestFlight · coming soon</span>`}
  <h2>How to test</h2>
  <ol>
    <li>Install the app${testFlight ? ' from TestFlight' : ''} and connect your Coinbase Base Account with a passkey.</li>
    <li>The app connects to Mandate automatically. Open Settings to check your AI connection and execution mode.</li>
    <li>Verify your wallet with a login message. ${input.dryRun ? 'Simulation needs no spending approvals or agent funding.' : 'Mandate creates an <strong>agent account</strong> just for your wallet. Find it under Settings → Live trading → Your agent account and fund it with ETH on Base to cover network fees.'}</li>
    <li>Create a mandate and ask the agent to buy a stock in chat.</li>
  </ol>
  <div class="card">
    <p><strong>This backend</strong> <span class="mode${input.dryRun ? '' : ' live'}">${mode}</span></p>
    <p class="muted">${input.dryRun ? 'Trades are simulated. No real tokens move. Ideal for trying the flow.' : 'Real trades under permissions you sign from your own wallet. The agent can never exceed the budget you signed.'} Coinbase Tokenized Stocks are available only to eligible users outside the U.S.</p>
  </div>
  <h2>What it does</h2>
  <p class="muted">Set a USDC budget, a reset period, allowed stocks and an expiry. In live mode, approve a USDC budget and a sell allowance for each selected stock. The review sheet lists every permission before wallet confirmation.</p>
  <p class="muted">The agent proposes trades in chat that you confirm, or trades automatically within the rules. Base's Spend Permission Manager enforces the signed token allowances on the blockchain. This backend enforces stock selection, position limits, take profit and stop loss rules.</p>
  ${repo ? `<p><a href="${repo}">Source code</a></p>` : ''}
  <p class="muted">Not investment advice. Independent project, not affiliated with Coinbase or Base.</p>
</main></body></html>`;
}
