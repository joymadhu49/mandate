import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { verifyMessage } from 'viem';
import type { Order } from './types.js';

test('wallet sessions and order access fail closed', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'mandate-orders-test-'));
  process.env.DB_PATH = join(directory, 'db.json'); process.env.DRY_RUN = '1'; process.env.NODE_ENV = 'test';
  process.env.AGENT_PRIVATE_KEY = ''; process.env.OPENROUTER_API_KEY = '';
  const { app } = await import('./app.js');
  const { db } = await import('./db.js');
  const { publicClient, spenderFor } = await import('./chain.js');
  const { executeOrder } = await import('./runner.js');
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  t.mock.method(publicClient, 'verifyMessage', async (args: Parameters<typeof publicClient.verifyMessage>[0]) => verifyMessage(args));
  const owner = privateKeyToAccount(generatePrivateKey()); const other = privateKeyToAccount(generatePrivateKey());
  const request = (path: string, method = 'GET', body?: object, token?: string) => app.request(path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const challenge = async () => (await request('/auth/challenge', 'POST', { account: owner.address })).json() as Promise<{ nonce: string; message: string }>;
  let token: string;
  await t.test('unauthenticated reads and mutations are denied', async () => {
    for (const path of ['/orders', '/activity', `/mandates?account=${owner.address}`]) assert.equal((await request(path)).status, 401);
    assert.equal((await request('/orders/unknown/cancel', 'POST')).status, 401);
    assert.equal((await request('/mandates', 'POST', {})).status, 401);
  });
  await t.test('wallet proof is single use, including a rejected signature', async () => {
    const c = await challenge(); const wrong = await other.signMessage({ message: c.message });
    assert.equal((await request('/auth/verify', 'POST', { nonce: c.nonce, signature: wrong })).status, 401);
    const correct = await owner.signMessage({ message: c.message });
    assert.equal((await request('/auth/verify', 'POST', { nonce: c.nonce, signature: correct })).status, 401);
  });
  await t.test('a valid wallet signature creates a scoped session and cannot replay', async () => {
    const c = await challenge(); const signature = await owner.signMessage({ message: c.message });
    const response = await request('/auth/verify', 'POST', { nonce: c.nonce, signature });
    assert.equal(response.status, 200); token = (await response.json()).token;
    assert.equal((await (await request('/auth/session', 'GET', undefined, token)).json()).account, owner.address.toLowerCase());
    assert.equal((await request('/auth/verify', 'POST', { nonce: c.nonce, signature })).status, 401);
  });
  const floodedConnection = { incoming: { socket: { remoteAddress: '203.0.113.10' } } };
  await t.test('anonymous challenge floods cannot block another source or authenticated session checks', async () => {
    let last: Response | undefined;
    for (let i = 0; i < 31; i++) last = await app.request('/auth/challenge', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }, floodedConnection);
    assert.equal(last?.status, 429);
    assert.equal((await request('/auth/challenge', 'POST', { account: owner.address })).status, 200);
    assert.equal((await app.request('/auth/session', { headers: { authorization: `Bearer ${token}` } }, floodedConnection)).status, 200);
  });
  const order = (id: string, account = owner.address): Order => ({ id, account, mandateId: 'test-mandate', action: 'buy', symbol: 'AAPLc', token: '0x0000000000000000000000000000000000000003', usd: 10, rationale: 'Test fixture', status: 'queued', createdAt: 1, updatedAt: 1, executeAfter: 1, dryRun: true });
  db.orders.push(order('mine'), order('theirs', other.address));
  db.activity.push({ id: 'mine-event', account: owner.address, mandateId: 'test-mandate', kind: 'hold', ts: 1, rationale: 'Test fixture' }, { id: 'their-event', account: other.address, mandateId: 'test-mandate', kind: 'hold', ts: 1, rationale: 'Private fixture' });
  await t.test('query parameters cannot override the authenticated wallet', async () => {
    const orders = await (await request(`/orders?account=${other.address}`, 'GET', undefined, token)).json();
    assert.deepEqual(orders.map((o: Order) => o.id), ['mine']);
    const events = await (await request(`/activity?account=${other.address}`, 'GET', undefined, token)).json();
    assert.deepEqual(events.map((a: { id: string }) => a.id), ['mine-event']);
    assert.equal((await request('/orders/theirs/cancel', 'POST', {}, token)).status, 404);
    assert.equal(db.orders[1].status, 'queued');
  });
  await t.test('owner cancellation is persisted and cannot be executed or repeated', async () => {
    assert.equal((await request('/orders/mine/cancel', 'POST', {}, token)).status, 200);
    assert.equal(db.orders[0].status, 'cancelled');
    await executeOrder(db.orders[0]); assert.equal(db.orders[0].status, 'cancelled');
    assert.equal((await request('/orders/mine/cancel', 'POST', {}, token)).status, 409);
    assert.equal(db.activity[0].kind, 'cancelled');
  });
  await t.test('executing and terminal orders cannot be cancelled', async () => {
    for (const status of ['executing', 'filled', 'failed'] as const) {
      const o = { ...order(status), status }; db.orders.push(o);
      assert.equal((await request(`/orders/${status}/cancel`, 'POST', {}, token)).status, 409);
      assert.equal(o.status, status);
    }
  });
  await t.test('the scheduler never executes before the cancellation window ends', async () => {
    const o = { ...order('future'), executeAfter: Math.floor(Date.now() / 1000) + 60 };
    await executeOrder(o); assert.equal(o.status, 'queued');
  });
  await t.test('malformed permission fields cannot poison persisted state or reach execution', async () => {
    const count = db.mandates.length;
    const permission = { spender: spenderFor(owner.address).address, token: other.address, allowance: '100', salt: '1', extraData: '0x', signature: '0x01' };
    const batch = { account: owner.address, period: 604800, start: 1, end: 2, permissions: [permission] };
    const body = { account: owner.address, budgetUsdc: 100, period: 'weekly', universe: [other.address], strategy: 'Hold', risk: 'balanced', maxPositionPct: 40, takeProfitPct: 10, stopLossPct: 7, batch };
    for (const changed of [
      { ...batch, start: -1 }, { ...batch, end: 0 }, { ...batch, period: 2 ** 48 },
      { ...batch, permissions: [{ ...permission, extraData: '0x1' }] },
      { ...batch, permissions: [{ ...permission, allowance: (1n << 160n).toString() }] },
      { ...batch, permissions: [{ ...permission, salt: (1n << 256n).toString() }] },
    ]) assert.equal((await request('/mandates', 'POST', { ...body, batch: changed }, token)).status, 400);
    assert.equal(db.mandates.length, count);
  });
  await t.test('logout invalidates the token on the server', async () => {
    assert.equal((await app.request('/auth/logout', { method: 'POST', headers: { authorization: `Bearer ${token}` } }, floodedConnection)).status, 200);
    assert.equal((await request('/orders', 'GET', undefined, token)).status, 401);
  });
});
