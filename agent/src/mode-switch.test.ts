import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { verifyMessage } from 'viem';
import type { Mandate } from './types.js';

test('mandates from the other execution mode stay dormant and can always be revoked', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'mandate-mode-switch-'));
  process.env.DB_PATH = join(directory, 'db.json'); process.env.NODE_ENV = 'test';
  delete process.env.DRY_RUN; delete process.env.LOCK_MODE;
  process.env.AGENT_PRIVATE_KEY = generatePrivateKey(); process.env.OPENROUTER_API_KEY = '';
  const { app } = await import('./app.js');
  await (await import('../test-support/eligibility.js')).eligibleOwnerFixture(t);
  const { config } = await import('./config.js');
  const { db } = await import('./db.js');
  const { publicClient, walletClient, spender, STOCKS } = await import('./chain.js');
  const { revokeMandate, runMandate, recoverInterruptedExecutions, executeOrder } = await import('./runner.js');
  t.after(() => rmSync(directory, { recursive: true, force: true }));

  let submitted = 0;
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected external request'); });
  t.mock.method(publicClient, 'verifyMessage', async (args: Parameters<typeof publicClient.verifyMessage>[0]) => verifyMessage(args));
  t.mock.method(walletClient, 'prepareTransactionRequest', async () => ({} as never));
  t.mock.method(walletClient, 'signTransaction', async () => '0x01' as const);
  t.mock.method(walletClient, 'sendRawTransaction', async () => { submitted++; return `0x${'1'.repeat(64)}` as const; });
  t.mock.method(publicClient, 'waitForTransactionReceipt', async () => ({ status: 'success' } as never));
  t.mock.method(publicClient, 'readContract', async (args: { functionName: string }) => {
    if (args.functionName === 'isRevoked') return submitted > 0;
    throw new Error(`Unexpected contract read ${args.functionName}`);
  });

  const owner = privateKeyToAccount(generatePrivateKey());
  const ts = Math.floor(Date.now() / 1000);
  const token = STOCKS[0].token;
  const permission = { spender: spender.address, token, allowance: '1000000', salt: '1', extraData: '0x' as const, signature: '0xabcd' as const };
  const mandate = (id: string, executionMode: Mandate['executionMode'], extra: Partial<Mandate> = {}): Mandate => ({
    id, account: owner.address.toLowerCase() as `0x${string}`, spender: spender.address, executionMode, control: 'chat', budgetUsdc: 50, period: 'weekly',
    universe: [token], strategy: 'test', risk: 'balanced', maxPositionPct: 40, takeProfitPct: 10, stopLossPct: 7, status: 'active', createdAt: ts - 100,
    batch: { account: owner.address, period: 604800, start: ts - 100, end: ts + 86400, permissions: [permission] }, ...extra,
  });
  const request = (path: string, method = 'GET', body?: object, token?: string) => app.request(path, {
    method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined,
  });
  const challenge = await (await request('/auth/challenge', 'POST', { account: owner.address })).json();
  const signature = await owner.signMessage({ message: challenge.message });
  const session = (await (await request('/auth/verify', 'POST', { nonce: challenge.nonce, signature })).json()).token as string;

  await t.test('a simulation mandate waits while the backend is live and is never marked broken', async () => {
    config.dryRun = false;
    const sim = mandate('sim', 'simulation'); db.mandates.push(sim);
    await runMandate(sim); assert.equal(sim.status, 'active');
    recoverInterruptedExecutions(); assert.equal(sim.status, 'active');
    const run = await request('/mandates/sim/run', 'POST', {}, session);
    assert.equal(run.status, 409); assert.match((await run.json()).error, /created in simulation mode/);
  });
  await t.test('a queued order from the other mode is cancelled with a reason, not executed', async () => {
    db.orders.push({ id: 'o1', account: owner.address.toLowerCase() as `0x${string}`, mandateId: 'sim', action: 'buy', symbol: STOCKS[0].symbol, token, usd: 5,
      rationale: 'test', status: 'queued', createdAt: ts - 120, executeAfter: ts - 60, updatedAt: ts - 120, dryRun: true });
    await executeOrder(db.orders[0]);
    assert.equal(db.orders[0].status, 'cancelled'); assert.match(db.orders[0].error ?? '', /switched execution mode/); assert.equal(submitted, 0);
  });
  await t.test('revoking a simulation mandate while live touches nothing on-chain', async () => {
    assert.deepEqual(await (await request('/mandates/sim/revoke', 'POST', {}, session)).json(), { ok: true });
    assert.equal(db.mandates.find(m => m.id === 'sim')!.status, 'revoked'); assert.equal(submitted, 0);
  });
  await t.test('a live mandate with registered permissions is revoked on-chain even while simulating', async () => {
    config.dryRun = true;
    const live = mandate('live', 'live', { approvalTx: `0x${'2'.repeat(64)}` }); db.mandates.push(live);
    await revokeMandate(live);
    assert.equal(live.status, 'revoked'); assert.equal(submitted, 1);
  });
  await t.test('a live mandate whose permissions were never registered only needs the record', async () => {
    const pending = mandate('pending', 'live', { status: 'pending' }); db.mandates.push(pending);
    await revokeMandate(pending);
    assert.equal(pending.status, 'revoked'); assert.equal(submitted, 1);
  });
});
