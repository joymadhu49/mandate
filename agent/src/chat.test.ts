import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { verifyMessage } from 'viem';
import type { Mandate } from './types.js';

test('chat research, authorization and confirmed orders stay inside trust boundaries', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'mandate-chat-test-'));
  process.env.DB_PATH = join(directory, 'db.json'); process.env.DRY_RUN = '1'; process.env.NODE_ENV = 'test';
  process.env.AGENT_PRIVATE_KEY = ''; process.env.OPENROUTER_API_KEY = '';
  const { app } = await import('./app.js');
  const { db } = await import('./db.js');
  const { chats, makeProposal, validateTrade } = await import('./chat.js');
  const { runMandate, executeOrder } = await import('./runner.js');
  const { config } = await import('./config.js');
  const { setAISettings } = await import('./openrouter.js');
  const { fundedAI } = await import('./funded-ai.js');
  const { publicClient, spenderFor, STOCKS, USDC } = await import('./chain.js');
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  t.mock.method(publicClient, 'verifyMessage', async (args: Parameters<typeof publicClient.verifyMessage>[0]) => verifyMessage(args));
  t.mock.method(publicClient, 'multicall', async () => STOCKS.map(() => ({ status: 'success', result: [1n, BigInt(Math.round(price * 1e8)), 0n, BigInt(ts()), 1n] })));
  let readCalls = 0;
  t.mock.method(publicClient, 'readContract', async (args: { functionName: string }) => { readCalls++; return args.functionName === 'decimals' ? 18 : args.functionName === 'isApproved'; });
  t.mock.method(fundedAI, 'run', async (account: string | undefined, _tokens: number, work: () => Promise<unknown>) => { assert.equal(account, owner.address.toLowerCase()); return work(); });
  const owner = privateKeyToAccount(generatePrivateKey()), other = privateKeyToAccount(generatePrivateKey());
  const request = (path: string, method = 'GET', body?: object, token?: string) => app.request(path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const login = async (wallet: typeof owner) => {
    const challenge = await (await request('/auth/challenge', 'POST', { account: wallet.address })).json();
    return (await (await request('/auth/verify', 'POST', { nonce: challenge.nonce, signature: await wallet.signMessage({ message: challenge.message }) })).json()).token as string;
  };
  const token = await login(owner), otherToken = await login(other);
  const ts = () => Math.floor(Date.now() / 1000);
  let price = 200;
  const m: Mandate = { id: 'chat-mandate', account: owner.address, spender: spenderFor(owner.address).address, budgetUsdc: 100, period: 'weekly', universe: [STOCKS[0].token], strategy: 'Test', risk: 'balanced', maxPositionPct: 40, takeProfitPct: 10, stopLossPct: 7, executionMode: 'simulation', control: 'chat', status: 'active', createdAt: ts() - 60,
    batch: { account: owner.address, period: 604800, start: ts() - 60, end: ts() + 86400, permissions: [{ spender: spenderFor(owner.address).address, token: USDC, allowance: '100000000', salt: '1', extraData: '0x' }] } };
  db.mandates.push(m);
  let calls = 0, reply: unknown = { answer: 'Apple snapshot analysis, not current news.', trade: null, symbols: ['AAPLc'] };
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request, init?: RequestInit) => {
    assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions'); calls++;
    const body = JSON.parse(String(init?.body));
    assert.equal(body.response_format.json_schema.name, 'agent_chat');
    assert.ok(!JSON.stringify(body).includes(owner.address));
    assert.ok(!JSON.stringify(body).includes('signature'));
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(reply) } }] });
  });
  const send = (message = 'Explain Apple', extra: object = {}) => request('/chat', 'POST', { requestId: randomUUID(), message, ...extra }, token);
  const quotes = () => [{ token: STOCKS[0].token, symbol: 'AAPLc', price, updatedAt: ts(), stale: false }];
  await t.test('every chat route requires a wallet session', async () => {
    for (const [path, method] of [['/chat', 'GET'], ['/chat', 'POST'], ['/chat/proposals/test/confirm', 'POST'], ['/chat/authorization/test', 'GET']]) assert.equal((await request(path, method)).status, 401);
    assert.equal(calls, 0);
  });
  await t.test('invalid input, other wallets and missing AI configuration fail before paid calls', async () => {
    assert.equal((await send('x'.repeat(2001))).status, 400);
    assert.equal((await send('hello', { account: other.address })).status, 400);
    assert.equal((await request('/chat', 'POST', { requestId: randomUUID(), message: 'hello', mandateId: m.id }, otherToken)).status, 404);
    assert.equal((await send()).status, 503); assert.equal(calls, 0);
    setAISettings({ apiKey: 'sk-or-test-not-a-real-secret', model: 'test/model' });
  });
  await t.test('research returns source timestamps and persists a private conversation, without orders', async () => {
    const result = await send(); assert.equal(result.status, 200);
    const message = await result.json(); assert.equal(message.sources[0].symbol, 'AAPLc');
    assert.equal(message.sources[0].url, `https://basescan.org/address/${STOCKS[0].feed}`);
    assert.equal(db.orders.length, 0); assert.equal(chats.messages.length, 2);
    assert.deepEqual(await (await request('/chat', 'GET', undefined, otherToken)).json(), []);
    const history = await (await request('/chat', 'GET', undefined, token)).json();
    assert.equal(history.length, 2); assert.equal(history[0].account, undefined);
  });
  await t.test('retrying the same message is idempotent and does not charge again', async () => {
    const input = { requestId: randomUUID(), message: 'Explain Apple' };
    const a = await (await request('/chat', 'POST', input, token)).json(); const before = calls;
    const b = await (await request('/chat', 'POST', input, token)).json();
    assert.equal(a.id, b.id); assert.equal(calls, before);
  });
  await t.test('invalid model output cannot write history or create orders', async () => {
    reply = { answer: 'unsafe', trade: { action: 'transfer', symbol: 'AAPLc', unit: 'usdc', amount: 10 }, symbols: [] };
    const count = chats.messages.length; assert.equal((await send()).status, 502);
    assert.equal(chats.messages.length, count); assert.equal(db.orders.length, 0);
  });
  await t.test('a chat-only simulation activates without signatures, RPC reads or background orders', async () => {
    const before = readCalls; m.status = 'pending'; await runMandate(m);
    assert.equal(m.status, 'active'); assert.equal(db.orders.length, 0); assert.equal(readCalls, before);
    const result = await (await request(`/chat/authorization/${m.id}`, 'GET', undefined, token)).json();
    assert.equal(result.mode, 'simulation'); assert.equal(result.ready, true); assert.equal(readCalls, before);
    assert.equal((await request(`/chat/authorization/${m.id}`, 'GET', undefined, otherToken)).status, 404);
  });
  await t.test('server guards block oversized, unsupported, stale and revoked requests', async () => {
    for (const trade of [
      { action: 'buy' as const, symbol: 'AAPLc', unit: 'usdc' as const, amount: 41 },
      { action: 'buy' as const, symbol: 'UNKNOWN', unit: 'usdc' as const, amount: 10 },
      { action: 'buy' as const, symbol: 'AAPLc', unit: 'shares' as const, amount: 1 },
      { action: 'sell' as const, symbol: 'AAPLc', unit: 'shares' as const, amount: 1 },
    ]) await assert.rejects(makeProposal(m, trade, quotes()));
    await assert.rejects(validateTrade(m, { action: 'buy', token: STOCKS[0].token, usd: 10 }, [{ ...quotes()[0], stale: true }]));
    m.status = 'revoked'; await assert.rejects(validateTrade(m, { action: 'buy', token: STOCKS[0].token, usd: 10 }, quotes())); m.status = 'active';
  });
  let proposalId: string;
  await t.test('buy request produces a proposal only; no implicit execution', async () => {
    reply = { answer: 'Buy proposal', trade: { action: 'buy', symbol: 'Apple', unit: 'usdc', amount: 10 }, symbols: ['AAPLc'] };
    const response = await send('Buy $10 of Apple', { mandateId: m.id }); assert.equal(response.status, 200);
    const result = await response.json(); proposalId = result.proposal.id;
    assert.equal(result.proposal.usd, 10); assert.equal(result.proposal.dryRun, true);
    assert.equal(db.orders.length, 0);
    assert.equal((await request(`/chat/proposals/${proposalId}/confirm`, 'POST', {}, otherToken)).status, 404);
  });
  await t.test('changed prices and execution modes invalidate confirmation', async () => {
    price = 210; assert.equal((await request(`/chat/proposals/${proposalId}/confirm`, 'POST', {}, token)).status, 409); price = 200;
    config.dryRun = false; assert.equal((await request(`/chat/proposals/${proposalId}/confirm`, 'POST', {}, token)).status, 409); config.dryRun = true;
    assert.equal(db.orders.length, 0);
  });
  await t.test('expired and revoked proposals cannot be confirmed', async () => {
    const p = chats.messages.find(x => x.proposal?.id === proposalId)!.proposal!;
    const expiry = p.expiresAt; p.expiresAt = ts() - 1;
    assert.equal((await request(`/chat/proposals/${proposalId}/confirm`, 'POST', {}, token)).status, 409); p.expiresAt = expiry;
    m.status = 'revoked'; assert.equal((await request(`/chat/proposals/${proposalId}/confirm`, 'POST', {}, token)).status, 409); m.status = 'active';
    assert.equal(db.orders.length, 0);
  });
  await t.test('explicit confirmation creates one canonical queued order; tampered amounts are ignored', async () => {
    const result = await request(`/chat/proposals/${proposalId}/confirm`, 'POST', { usd: 900000 }, token);
    assert.equal(result.status, 201); const order = await result.json();
    assert.equal(order.usd, 10); assert.equal(order.status, 'queued'); assert.equal(order.source, 'chat');
    assert.ok(order.executeAfter >= ts() + 59);
    const retry = await request(`/chat/proposals/${proposalId}/confirm`, 'POST', {}, token);
    assert.equal(retry.status, 200); assert.equal(db.orders.length, 1);
  });
  await t.test('confirmed simulated orders fill through the existing execution engine', async () => {
    const order = db.orders[0]; order.executeAfter = ts() - 1;
    await executeOrder(order); assert.equal(order.status, 'filled');
    assert.equal(order.filledUsd, 10); assert.equal(order.txHash, undefined);
    assert.equal(db.positions[0].costUsd, 10);
  });
  await t.test('simulation creation accepts no spending signatures and discards any provided ones', async () => {
    const b = { ...m, batch: { ...m.batch, permissions: m.batch.permissions.map(p => ({ ...p, signature: '0x01' })) } };
    const response = await request('/mandates', 'POST', b, token); assert.equal(response.status, 201);
    const created = await response.json(); assert.equal(created.executionMode, 'simulation'); assert.equal(created.batch.permissions[0].signature, undefined);
    // Avoid the scheduled test fixture using disposed storage after this test exits.
    db.mandates.find(x => x.id === created.id)!.status = 'revoked';
    config.dryRun = false;
    assert.equal((await request('/mandates', 'POST', { ...b, batch: m.batch }, token)).status, 400);
    config.dryRun = true;
  });
  await new Promise(resolve => setTimeout(resolve, 550));
});
