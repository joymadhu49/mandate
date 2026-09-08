import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const { session, account } = JSON.parse(readFileSync('data/cloud-smoke-session.json', 'utf8'));
const start = Date.now();
const response = await fetch('https://mandate.horizonbase.app/test-swap/wallet?usd=1', {
  headers: { authorization: `Bearer ${session.token}` },
  signal: AbortSignal.timeout(45000),
});
const result = await response.json();
assert.equal(response.status, 200, result.error ?? 'Quote request failed');
assert.equal(response.headers.get('x-mandate-host'), 'cloudflare');
assert.equal(result.account.toLowerCase(), account.toLowerCase());
assert.ok(result.ethPrice > 0);
assert.ok(result.expectedUsdc > 0);
assert.ok(result.minUsdc > 0 && result.minUsdc <= result.expectedUsdc);
assert.ok(result.tx?.data?.startsWith('0x'));
assert.ok(result.expiresAt > Date.now() / 1000);
console.log('PASS: Cloudflare Base price read and validated LI.FI swap quote.', {
  durationMs: Date.now() - start, usd: result.usd, expectedUsdc: result.expectedUsdc,
  minUsdc: result.minUsdc, tool: result.tool,
});
console.log('Read-only quote: no transaction signed or broadcast.');
