import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { decodeFunctionData, verifyMessage } from 'viem';
import { buildBatch, permissionFor, sellPermission } from '../../lib/spendPermission.js';
import { STOCKS, USDC } from '../../lib/stocks.js';

test('chat mandates approve USDC at setup and each stock the first time it is sold', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'mandate-sell-permissions-'));
  process.env.DB_PATH = join(dir, 'db.json'); process.env.NODE_ENV = 'test'; process.env.AGENT_PRIVATE_KEY = generatePrivateKey(); process.env.OPENROUTER_API_KEY = '';
  const { app } = await import('./app.js'); const { config } = await import('./config.js');
  await (await import('../test-support/eligibility.js')).eligibleOwnerFixture(t);
  const { publicClient, walletClient, spenderFor, spmAbi } = await import('./chain.js');
  const { db } = await import('./db.js'); const { chats } = await import('./chat.js');
  const { sellApprovalNeeded } = await import('./permissions.js');
  config.dryRun = false;
  t.after(() => { config.dryRun = true; rmSync(dir, { recursive: true, force: true }); });
  t.mock.method(publicClient, 'verifyMessage', async (args: Parameters<typeof publicClient.verifyMessage>[0]) => verifyMessage(args));
  const ts = () => Math.floor(Date.now() / 1000);
  const price = 200;
  // Chain state: which permissions are approved, and every approveWithSignature the agent prepared.
  const approved = new Set<string>();
  const registered: { token: string; signature: string }[] = [];
  let failPrepare = false, signed = 0;
  t.mock.method(publicClient, 'multicall', async () => STOCKS.map(() => ({ status: 'success', result: [1n, BigInt(price * 1e8), 0n, BigInt(ts()), 1n] })));
  t.mock.method(publicClient, 'readContract', async (args: { functionName: string; args: unknown[] }) => {
    const p = args.args[0] as { token: string };
    if (args.functionName === 'isApproved') return approved.has(p.token.toLowerCase());
    if (args.functionName === 'isRevoked') return false;
    throw new Error(`unexpected read ${args.functionName}`);
  });
  let sentNonce = 1;
  t.mock.method(publicClient, 'getTransactionCount', async () => sentNonce++);
  t.mock.method(walletClient, 'prepareTransactionRequest', async (request: { data: `0x${string}` }) => {
    if (failPrepare) throw new Error('insufficient funds for gas');
    const call = decodeFunctionData({ abi: spmAbi, data: request.data });
    assert.equal(call.functionName, 'approveWithSignature');
    const [permission, signature] = call.args as unknown as [{ token: string; account: string; spender: string }, string];
    registered.push({ token: permission.token, signature });
    return request as never;
  });
  t.mock.method(walletClient, 'signTransaction', async () => `0x${(++signed).toString(16).padStart(4, '0')}` as `0x${string}`);
  t.mock.method(walletClient, 'sendRawTransaction', async () => { approved.add(registered.at(-1)!.token.toLowerCase()); return `0x${'1'.repeat(64)}` as const; });
  t.mock.method(publicClient, 'waitForTransactionReceipt', async () => ({ status: 'success' } as never));
  let balance = 10n ** 16n; // 0.01 ETH: enough to register; the funding test drains it.
  t.mock.method(publicClient, 'getBalance', async () => balance);

  const owner = privateKeyToAccount(generatePrivateKey()), other = privateKeyToAccount(generatePrivateKey());
  const agent = spenderFor(owner.address).address;
  const request = (path: string, method = 'GET', body?: object, token?: string) => app.request(path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const login = async (wallet: typeof owner) => {
    const challenge = await (await request('/auth/challenge', 'POST', { account: wallet.address })).json();
    return (await (await request('/auth/verify', 'POST', { nonce: challenge.nonce, signature: await wallet.signMessage({ message: challenge.message }) })).json()).token as string;
  };
  const token = await login(owner), otherToken = await login(other);
  const sig = (n: number) => `0x${n.toString(16).padStart(2, '0').repeat(65)}` as `0x${string}`;
  const universe = [STOCKS[0].token, STOCKS[1].token];
  const batch = buildBatch({ account: owner.address, spender: agent, budgetUsdc: 50, period: 'weekly', universe, durationDays: 30, includeSellPermissions: false });
  assert.equal(batch.permissions.length, 1);
  batch.permissions[0].signature = sig(1);
  const body = { account: owner.address, budgetUsdc: 50, period: 'weekly', universe, strategy: 'chat', risk: 'balanced', maxPositionPct: 40, takeProfitPct: 10, stopLossPct: 7, batch };
  // Creation schedules the first evaluation; keep it out of this route test.
  const timer = t.mock.method(globalThis, 'setTimeout', () => 0 as unknown as NodeJS.Timeout);

  await t.test('an automatic mandate must cover every stock before it starts', async () => {
    const result = await request('/mandates', 'POST', { ...body, control: 'automatic' }, token);
    assert.equal(result.status, 400);
    assert.match((await result.json()).error, /sell permission for every stock/);
    assert.equal((await request('/mandates', 'POST', { ...body, control: 'chat', batch: { ...batch, permissions: [{ ...batch.permissions[0], token: STOCKS[0].token }] } }, token)).status, 400, 'USDC is always required');
  });
  let mandateId = '';
  await t.test('a chat mandate is created with the USDC permission alone', async () => {
    const result = await request('/mandates', 'POST', { ...body, control: 'chat' }, token);
    assert.equal(result.status, 201);
    const saved = await result.json();
    mandateId = saved.id;
    assert.equal(saved.batch.permissions.length, 1);
    assert.equal(saved.batch.permissions[0].token, USDC);
    assert.equal(saved.executionMode, 'live');
  });
  timer.mock.restore();
  const m = db.mandates.find(x => x.id === mandateId)!;
  m.status = 'active';
  for (const stock of [STOCKS[0], STOCKS[1]]) db.positions.push({ mandateId: m.id, executionMode: 'live', token: stock.token, symbol: stock.symbol, shares: 1, raw: '1000000000000000000', costUsd: 200 });
  const permission = (stock: number, n = 2) => ({ ...sellPermission(m.batch, STOCKS[stock].token), signature: sig(n) });
  const add = (p: object, auth = token) => request(`/mandates/${m.id}/permissions`, 'POST', p, auth);
  // Built while the batch is still USDC-only: a second prompt for the same stock would sign an identical permission.
  const first = permission(0);

  await t.test('sell permissions are bound to the owner, the agent and the mandate stocks', async () => {
    assert.equal((await request(`/mandates/${m.id}/permissions`, 'POST', permission(0))).status, 401);
    assert.equal((await add(permission(0), otherToken)).status, 404);
    assert.equal((await add({ ...permission(0), spender: other.address })).status, 409);
    assert.equal((await add({ ...permission(0), token: STOCKS[5].token })).status, 409);
    assert.equal((await add({ ...permission(0), token: USDC })).status, 409);
    assert.equal((await add({ ...permission(0), signature: 'nope' })).status, 400);
    assert.equal(m.batch.permissions.length, 1);
    assert.equal(registered.length, 0);
  });
  await t.test('the first sell of a stock stores its signature and registers it on Base', async () => {
    const result = await add(permission(0));
    assert.equal(result.status, 201);
    assert.equal((await result.json()).batch.permissions.length, 2);
    assert.equal(permissionFor(m.batch, STOCKS[0].token)?.signature, sig(2));
    assert.deepEqual(registered, [{ token: STOCKS[0].token, signature: sig(2) }]);
    assert.ok(approved.has(STOCKS[0].token.toLowerCase()));
    assert.equal(m.transactions?.filter(s => s.name === 'permission-approval' && s.status === 'confirmed').length, 1);
    assert.ok(db.activity.some(a => a.kind === 'approved' && a.mandateId === m.id && a.symbol === STOCKS[0].symbol));
  });
  await t.test('a covered stock keeps its first signature and is never registered twice', async () => {
    const result = await add({ ...first, signature: sig(9) });
    assert.equal(result.status, 200);
    assert.equal(m.batch.permissions.length, 2);
    assert.equal(permissionFor(m.batch, STOCKS[0].token)?.signature, sig(2));
    assert.equal(registered.length, 1);
  });
  await t.test('a registration that never reaches Base is forgotten so the wallet is asked again', async () => {
    failPrepare = true;
    const result = await add(permission(1, 3));
    assert.equal(result.status, 409);
    assert.match((await result.json()).error, /ETH for fees/);
    assert.equal(m.batch.permissions.length, 2);
    assert.equal(permissionFor(m.batch, STOCKS[1].token), undefined);
    failPrepare = false;
  });
  await t.test('confirming a sell of an unapproved stock is refused until its permission is registered', async () => {
    const proposal = { id: randomUUID(), mandateId: m.id, action: 'sell' as const, symbol: STOCKS[1].symbol, token: STOCKS[1].token, fraction: 0.5, estimatedShares: 0.5, price, priceUpdatedAt: ts(), expiresAt: ts() + 300, dryRun: false, rationale: 'test' };
    chats.messages.push({ id: randomUUID(), account: owner.address.toLowerCase(), requestId: randomUUID(), role: 'assistant', text: 'proposal', ts: ts(), mandateId: m.id, proposal });
    const refused = await request(`/chat/proposals/${proposal.id}/confirm`, 'POST', undefined, token);
    assert.equal(refused.status, 409);
    assert.match((await refused.json()).error, /Approve selling/);
    assert.equal(db.orders.length, 0);
    assert.equal((await add(permission(1, 3))).status, 201);
    assert.equal(registered.length, 2);
    const queued = await request(`/chat/proposals/${proposal.id}/confirm`, 'POST', undefined, token);
    assert.equal(queued.status, 201);
    assert.equal(db.orders[0].action, 'sell');
  });
  await t.test('an activation that fails for lack of ETH tells the owner where to send fees', async () => {
    const { runMandate, ActivationError } = await import('./runner.js');
    for (const order of db.orders) order.status = 'cancelled';
    const before = registered.length;
    balance = 0n;
    await runMandate(m);
    const latest = db.activity.find(a => a.mandateId === m.id)!;
    assert.equal(latest.kind, 'error');
    assert.match(latest.rationale, /no ETH for fees/);
    assert.ok(latest.rationale.includes(`${agent.slice(0, 6)}…${agent.slice(-4)}`), 'names the agent account to fund');
    assert.match(latest.rationale, /Retry activation/);
    assert.equal(registered.length, before, 'nothing was prepared with an empty account');
    assert.equal(m.transactions?.some(s => s.status === 'prepared'), false, 'nothing was journaled, so the mandate is not quarantined');
    assert.equal(m.status, 'active');
    // A funded account that the node still refuses ("gas required exceeds allowance (0)" is Base's wording for an empty sender) reads the same.
    balance = 1n;
    const prepare = t.mock.method(walletClient, 'prepareTransactionRequest', async () => { throw new Error('Execution reverted with reason: gas required exceeds allowance (0).'); });
    await runMandate(m);
    prepare.mock.restore();
    assert.match(db.activity.find(a => a.mandateId === m.id)!.rationale, /no ETH for fees/);
    balance = 10n ** 16n;
    assert.equal(new ActivationError('x', new Error('y')).cause instanceof Error, true);
    // The sell-permission route reports the same funding problem in the owner's words.
    balance = 0n;
    const starved = await add({ ...first, token: STOCKS[1].token, salt: first.salt });
    balance = 10n ** 16n;
    assert.equal(starved.status, 200, 'an already covered stock does not need fees');
  });
  await t.test('sell approvals are a live-mode concern only', () => {
    assert.equal(sellApprovalNeeded({ batch: m.batch, executionMode: 'simulation' }, STOCKS[5].token, false), false);
    assert.equal(sellApprovalNeeded({ batch: m.batch, executionMode: 'live' }, STOCKS[5].token, true), false);
    assert.equal(sellApprovalNeeded({ batch: m.batch, executionMode: 'live' }, STOCKS[5].token, false), true);
    assert.equal(sellApprovalNeeded(m, STOCKS[0].token, false), false);
  });
});
