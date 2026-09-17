import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { verifyMessage } from 'viem';
import { withTrustedCountry } from './eligibility-edge.js';

process.env.CLOUDFLARE_WORKER = '1';
process.env.AGENT_PRIVATE_KEY = generatePrivateKey();
process.env.SCHEDULER_ENABLED = '1';
process.env.DRY_RUN = '0';
process.env.OPENROUTER_API_KEY = '';
const { EligibilityStore, eligibility, ELIGIBILITY_VERSION, LOCATION_TTL, DECLARATION_TTL } = await import('./eligibility.js');
const { withRuntime } = await import('./runtime.js');
const declaration = { version: ELIGIBILITY_VERSION, residenceCountry: 'DE', nonUsPerson: true, eligibleJurisdiction: true, accurate: true };
function fixture() {
  let data = {}; let time = Date.now();
  const store = new EligibilityStore(() => data, next => { data = structuredClone(next); }, () => time);
  return { store, advance: (ms: number) => { time += ms; }, restart: () => new EligibilityStore(() => data, next => { data = structuredClone(next); }, () => time) };
}
test('U.S., territories, unknown and forged country headers cannot grant access', () => {
  for (const country of ['US', 'PR', 'GU', 'AS', 'MP', 'VI', 'UM', 'XX', 'T1', 'ZZ', undefined]) {
    const f = fixture(); assert.equal(f.store.declare('alice', declaration, country).allowed, false, country);
  }
  const forged = new Request('https://example.test', { headers: { 'x-mandate-country': 'DE', 'cf-ipcountry': 'DE' } });
  assert.equal(withTrustedCountry(forged).get('x-mandate-country'), 'XX');
  Object.defineProperty(forged, 'cf', { value: { country: 'US' } });
  assert.equal(withTrustedCountry(forged).get('x-mandate-country'), 'US');
});
test('declarations are wallet scoped and require every assertion and a non-U.S. residence', () => {
  const f = fixture(); assert.equal(f.store.status('alice').allowed, false);
  assert.equal(f.store.declare('ALICE', declaration, 'DE').allowed, true);
  assert.equal(f.store.status('alice').allowed, true); assert.equal(f.store.status('bob').allowed, false);
  for (const field of ['nonUsPerson', 'eligibleJurisdiction', 'accurate']) assert.equal(f.store.declare('bob', { ...declaration, [field]: false }, 'DE').allowed, false);
  assert.equal(f.store.declare('bob', { ...declaration, residenceCountry: 'US' }, 'DE').allowed, false);
  assert.throws(() => f.store.declare('bob', { ...declaration, residenceCountry: 'ZZ' }, 'DE'));
  assert.throws(() => f.store.declare('bob', { ...declaration, account: 'alice' }, 'DE'));
});
test('location and declaration expiry survive restart; restricted observations require renewal', () => {
  const f = fixture(); f.store.declare('alice', declaration, 'DE');
  assert.equal(f.restart().status('alice').allowed, true);
  f.advance(LOCATION_TTL); assert.equal(f.restart().status('alice').allowed, false);
  f.store.observe('alice', 'DE'); assert.equal(f.store.status('alice').allowed, true);
  f.store.observe('alice', 'US'); assert.equal(f.store.status('alice').allowed, false);
  f.store.observe('alice', 'DE'); assert.equal(f.store.status('alice').allowed, false);
  f.store.declare('alice', declaration, 'DE'); f.advance(DECLARATION_TTL);
  f.store.observe('alice', 'DE'); assert.equal(f.store.status('alice').allowed, false);
  f.store.declare('alice', declaration, 'DE'); f.store.withdraw('alice'); f.store.observe('alice', 'DE');
  assert.equal(f.restart().status('alice').allowed, false);
});
test('failed storage never returns an accepted declaration', () => {
  const store = new EligibilityStore(() => ({}), () => { throw new Error('disk failed'); });
  assert.throws(() => store.declare('alice', declaration, 'DE'), /disk failed/);
});
test('native and browser trading routes fail closed while cancellation, revocation and reads remain available', async t => {
  const values = new Map<string, string>();
  const runtime = { cache: new Map<string, unknown>(), read: (key: string) => values.get(key), write: (key: string, value: string) => { values.set(key, value); }, flush: async () => {} };
  const { app } = await import('./app.js');
  const { publicClient, walletClient } = await import('./chain.js');
  const { browserAPI } = await import('./browser-api.js');
  const { db } = await import('./db.js');
  const { runMandate, executeOrder } = await import('./runner.js');
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('No external requests permitted'); });
  t.mock.method(publicClient, 'verifyMessage', async (args: Parameters<typeof publicClient.verifyMessage>[0]) => verifyMessage(args));
  const broadcast = t.mock.method(walletClient, 'sendRawTransaction', async () => { throw new Error('Must never broadcast'); });
  const owner = privateKeyToAccount(generatePrivateKey());
  const origin = 'https://mandate.horizonbase.app';
  let token = '';
  const request = (path: string, method = 'GET', body?: object, country = 'DE', browser = false) => withRuntime(runtime, async () => {
    const headers = { 'content-type': 'application/json', 'x-mandate-country': country, origin, ...(browser ? { cookie: `__Host-mandate_session=${token}` } : { authorization: `Bearer ${token}` }) };
    const req = new Request(origin + (browser ? '/api' : '') + path, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
    return browser ? browserAPI(req, origin, async req => app.fetch(req)) : app.fetch(req);
  });
  const challenge = await (await request('/auth/challenge', 'POST', { account: owner.address })).json();
  const signature = await owner.signMessage({ message: challenge.message });
  token = (await (await request('/auth/verify', 'POST', { nonce: challenge.nonce, signature })).json()).token;
  assert.ok(token);
  for (const browser of [false, true]) {
    for (const [path, method] of [['/mandates', 'POST'], ['/mandates/example/run', 'POST'], ['/mandates/example/permissions', 'POST'], ['/chat/proposals/example/confirm', 'POST'], ['/test-swap/wallet', 'GET']]) {
      assert.equal((await request(path, method, undefined, 'DE', browser)).status, 403, path);
    }
    assert.equal((await request('/orders', 'GET', undefined, 'US', browser)).status, 200);
    assert.equal((await request('/orders/missing/cancel', 'POST', undefined, 'US', browser)).status, 404);
    assert.equal((await request('/mandates/missing/revoke', 'POST', undefined, 'US', browser)).status, 404);
    assert.equal((await (await request('/eligibility', 'POST', declaration, 'US', browser)).json()).allowed, false);
  }
  assert.equal((await (await request('/eligibility', 'POST', declaration)).json()).allowed, true);
  runtime.cache.clear();
  assert.equal((await (await request('/eligibility')).json()).allowed, true);
  // Allowed traffic reaches normal input validation, without creating a mandate.
  assert.equal((await request('/mandates', 'POST', {})).status, 400);
  await request('/orders', 'GET', undefined, 'US');
  assert.equal((await (await request('/eligibility')).json()).allowed, false);
  await withRuntime(runtime, async () => {
    const now = Math.floor(Date.now() / 1000);
    const m = { id: 'blocked', account: owner.address, status: 'active', control: 'automatic', executionMode: 'live', batch: { start: now - 60, end: now + 1000 } } as any;
    const order = { id: 'blocked-order', account: owner.address, mandateId: m.id, dryRun: false, status: 'queued', executeAfter: now - 1 } as any;
    db.mandates.push(m); db.orders.push(order);
    await executeOrder(order); assert.equal(order.status, 'cancelled');
    await runMandate(m); assert.equal(m.lastRunAt, undefined);
    assert.equal(eligibility.status(owner.address).allowed, false);
  });
  assert.equal(broadcast.mock.callCount(), 0);
});
test('a restriction discovered during transaction preparation prevents broadcast', async t => {
  const { publicClient, sendTx, walletClient } = await import('./chain.js');
  const values = new Map<string, string>();
  const runtime = { cache: new Map<string, unknown>(), read: (key: string) => values.get(key), write: (key: string, value: string) => { values.set(key, value); }, flush: async () => { eligibility.withdraw('alice'); } };
  let sentNonce = 1;
  t.mock.method(publicClient, 'getTransactionCount', async () => sentNonce++);
  t.mock.method(walletClient, 'prepareTransactionRequest', async () => ({}));
  t.mock.method(walletClient, 'signTransaction', async () => '0x01');
  const broadcast = t.mock.method(walletClient, 'sendRawTransaction', async () => { throw new Error('Must not broadcast'); });
  await withRuntime(runtime, async () => {
    eligibility.declare('alice', declaration, 'DE');
    await assert.rejects(sendTx('0x0000000000000000000000000000000000000001', '0x', 0n, undefined, undefined, () => eligibility.assert('alice')), /Confirm your eligibility/);
  });
  assert.equal(broadcast.mock.callCount(), 0);
});
