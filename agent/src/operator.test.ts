import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { verifyMessage } from 'viem';

test('operator-only routes and the browser landing page', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'mandate-operator-'));
  const operator = privateKeyToAccount(generatePrivateKey()), visitor = privateKeyToAccount(generatePrivateKey());
  process.env.DB_PATH = join(directory, 'db.json'); process.env.NODE_ENV = 'test';
  delete process.env.DRY_RUN; delete process.env.LOCK_MODE;
  process.env.AGENT_PRIVATE_KEY = generatePrivateKey(); process.env.OPENROUTER_API_KEY = '';
  process.env.OWNER_ACCOUNTS = operator.address.toUpperCase().replace('0X', '0x');
  process.env.AI_DAILY_TOKENS_WALLET = '1234'; process.env.AI_DAILY_TOKENS_GLOBAL = 'nope';
  process.env.PUBLIC_URL = 'https://mandate.example'; process.env.TESTFLIGHT_URL = 'https://testflight.apple.com/join/abc';
  const { app } = await import('./app.js');
  const { config } = await import('./config.js');
  const { AI_LIMITS } = await import('./admission.js');
  const { publicClient } = await import('./chain.js');
  t.after(() => { rmSync(directory, { recursive: true, force: true }); delete process.env.OWNER_ACCOUNTS; delete process.env.AI_DAILY_TOKENS_WALLET; delete process.env.AI_DAILY_TOKENS_GLOBAL; });
  t.mock.method(publicClient, 'verifyMessage', async (args: Parameters<typeof publicClient.verifyMessage>[0]) => verifyMessage(args));
  const request = (path: string, method = 'GET', body?: object, token?: string, headers: Record<string, string> = {}) => app.request(path, {
    method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined,
  });
  const login = async (wallet: typeof operator) => {
    const challenge = await (await request('/auth/challenge', 'POST', { account: wallet.address })).json();
    const signature = await wallet.signMessage({ message: challenge.message });
    return (await (await request('/auth/verify', 'POST', { nonce: challenge.nonce, signature })).json()).token as string;
  };
  const operatorToken = await login(operator), visitorToken = await login(visitor);

  await t.test('env budgets apply, invalid values keep the defaults', () => {
    assert.equal(AI_LIMITS.ownerDailyTokens, 1234);
    assert.equal(AI_LIMITS.globalDailyTokens, 2_000_000);
  });
  await t.test('only the operator can switch mode or run the spender test', async () => {
    assert.equal(config.canSwitchMode(operator.address), true); assert.equal(config.canSwitchMode(visitor.address), false);
    assert.equal((await request('/mode', 'POST', { live: true }, visitorToken)).status, 403);
    // Agent accounts are per wallet, so the spender test is each user's own; only the addresses must differ.
    const visitorAgent = (await (await request('/agent', 'GET', undefined, visitorToken)).json()).spender;
    const operatorAgent = (await (await request('/agent', 'GET', undefined, operatorToken)).json()).spender;
    assert.match(visitorAgent, /^0x[0-9a-fA-F]{40}$/); assert.notEqual(visitorAgent.toLowerCase(), operatorAgent.toLowerCase());
    assert.equal((await (await request('/agent')).json()).spender, null);
    assert.equal((await (await request('/agent', 'GET', undefined, visitorToken)).json()).liveAvailable, false);
    assert.equal((await (await request('/agent', 'GET', undefined, operatorToken)).json()).liveAvailable, true);
    assert.deepEqual(await (await request('/mode', 'POST', { live: true }, operatorToken)).json(), { dryRun: false });
    assert.deepEqual(await (await request('/mode', 'POST', { live: false }, operatorToken)).json(), { dryRun: true });
  });
  await t.test('root serves JSON to API clients and a landing page to browsers', async () => {
    assert.deepEqual(await (await request('/')).json(), { ok: true, name: 'mandate-agent', dryRun: true });
    const page = await request('/', 'GET', undefined, undefined, { accept: 'text/html,application/xhtml+xml' });
    assert.equal(page.status, 200); assert.match(page.headers.get('content-type') ?? '', /text\/html/);
    const html = await page.text();
    assert.match(html, /Mandate/); assert.match(html, /connects to Mandate automatically/); assert.doesNotMatch(html, /Settings → Backend/); assert.match(html, /testflight\.apple\.com\/join\/abc/);
    assert.match(html, /Simulation/);
    for (const headers of [{ accept: '*/*' }, {}] as Record<string, string>[]) {
      const crawler = await app.request('/', { headers });
      assert.match(crawler.headers.get('content-type') ?? '', /text\/html/);
      assert.match(await crawler.text(), /<meta name="base:app_id" content="6a9fb9f7ad9c34826110fd88">/);
    }
    const health = await app.request('/', { headers: { accept: 'application/json' } });
    assert.deepEqual(await health.json(), { ok: true, name: 'mandate-agent', dryRun: true });
  });
});
