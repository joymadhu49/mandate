import assert from 'node:assert/strict';
import { after, test, mock } from 'node:test';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { verifyMessage } from 'viem';
import { z } from 'zod';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DEV_AI_SETTINGS = '1';
process.env.DRY_RUN = '1';
process.env.AGENT_PRIVATE_KEY = '';
process.env.OPENROUTER_API_KEY = '';
process.env.MODEL = 'google/gemini-2.5-flash';
process.env.NODE_ENV = 'test';
const testDirectory = mkdtempSync(join(tmpdir(), 'mandate-ai-test-'));
process.env.DB_PATH = join(testDirectory, 'db.json');
let clock = Date.now();
mock.method(Date, 'now', () => clock);

const { aiRoutes } = await import('./ai-routes.js');
const { authRoutes } = await import('./auth.js');
const { publicClient } = await import('./chain.js');
const { config } = await import('./config.js');
const { aiSettings, completeJSON, resetAISettings, aiStatus } = await import('./openrouter.js');
const { decide, Decision } = await import('./brain.js');
const originalFetch = globalThis.fetch;
const owner = privateKeyToAccount(generatePrivateKey());
const other = privateKeyToAccount(generatePrivateKey());
mock.method(publicClient, 'verifyMessage', async (args: Parameters<typeof publicClient.verifyMessage>[0]) => verifyMessage(args));
const login = async (wallet: typeof owner) => {
  const challenge = await (await authRoutes.request('/challenge', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ account: wallet.address }) })).json();
  return (await (await authRoutes.request('/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nonce: challenge.nonce, signature: await wallet.signMessage({ message: challenge.message }) }) })).json()).token;
};
const token = await login(owner), otherToken = await login(other);
after(() => { globalThis.fetch = originalFetch; resetAISettings(); rmSync(testDirectory, { recursive: true, force: true }); });

const testKey = 'sk-or-test-key-not-a-real-credential';
const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
const model = 'google/gemini-2.5-flash';
let mode: 'valid' | 'invalid' | 'truncated' | 'unauthorized' | 'credits' | 'timeout' = 'valid';
let calls = 0;
let lastRequest: Record<string, any> = {};
globalThis.fetch = async (input, init) => {
  calls++;
  assert.ok(String(input).startsWith('https://openrouter.ai/api/v1/'));
  assert.equal(init?.redirect, 'manual');
  assert.ok(init?.signal);
  if (String(input).endsWith('/models')) return Response.json({ data: [
    { id: model, name: 'Gemini 2.5 Flash', supported_parameters: ['structured_outputs'], pricing: { prompt: '0.0000003', completion: '0.0000025' } },
    { id: 'unsupported/model', name: 'No JSON', supported_parameters: [], pricing: { prompt: '0', completion: '0' } },
  ] });
  lastRequest = JSON.parse(String(init?.body));
  if (mode === 'timeout') throw new DOMException('internal host and secret', 'TimeoutError');
  if (mode === 'unauthorized') return new Response(`do not leak ${testKey}`, { status: 401 });
  if (mode === 'credits') return new Response(`do not leak ${testKey}`, { status: 402 });
  const content = lastRequest.response_format.json_schema.name === 'connection_check'
    ? { ok: true }
    : { strategy: 'Buy selected stocks only within the budget and position limits. Hold when data is stale.', summary: 'Clarified entry rules and limits.' };
  return Response.json({ choices: [{ finish_reason: mode === 'truncated' ? 'length' : 'stop', message: { content: mode === 'invalid' ? '{bad json' : JSON.stringify(content) } }] });
};
const request = (path: string, body?: object, method = 'POST') => {
  clock += 61_000;
  return aiRoutes.request(path, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
};
const input = { instructions: 'Buy tech dips', budgetUsdc: 100, period: 'weekly', symbols: ['AAPLc'], risk: 'balanced', maxPositionPct: 40, takeProfitPct: 10, stopLossPct: 7 };

test('AI integration trust boundaries and failure handling', async (t) => {
  await t.test('unauthenticated requests cannot use OpenRouter', async () => {
    const response = await aiRoutes.request('/models');
    assert.equal(response.status, 401); assert.equal(calls, 0);
    for (const method of ['POST', 'DELETE']) assert.equal((await aiRoutes.request('/settings', { method })).status, 401);
    assert.equal((await aiRoutes.request('/models', { headers: { authorization: 'Bearer old-development-token-not-a-wallet-session' } })).status, 401);
  });
  await t.test('development controls stay available in live mode', async () => {
    config.dryRun = false;
    assert.equal(aiStatus().developmentSettings, true);
    config.dryRun = true;
    assert.equal(calls, 0);
  });
  await t.test('catalog excludes models without structured output', async () => {
    const response = await request('/models', undefined, 'GET');
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).map((m: { id: string }) => m.id), [model]);
  });
  await t.test('invalid input and malformed JSON are rejected before external calls', async () => {
    const before = calls;
    assert.equal((await request('/draft', { ...input, budgetUsdc: -1 })).status, 400);
    assert.equal((await request('/draft', { ...input, symbols: ['FAKE'] })).status, 400);
    assert.equal((await aiRoutes.request('/settings', { method: 'POST', headers, body: '{' })).status, 400);
    assert.equal(calls, before);
  });
  await t.test('oversized input is rejected', async () => {
    assert.equal((await request('/draft', { ...input, instructions: 'a'.repeat(9000) })).status, 413);
  });
  await t.test('missing key fails clearly without a synthetic AI draft', async () => {
    assert.equal((await request('/draft', input)).status, 503);
  });
  await t.test('connection check saves wallet settings without exposing key', async () => {
    const response = await request('/settings', { apiKey: testKey, model });
    assert.equal(response.status, 200);
    const result = await response.text();
    assert.ok(!result.includes(testKey));
    assert.equal(JSON.parse(result).source, 'saved');
    assert.equal(lastRequest.max_tokens, 256);
    assert.equal(aiSettings(owner.address).apiKey, testKey);
    assert.equal(aiSettings(other.address).apiKey, '');
    assert.equal(aiSettings().apiKey, '');
  });
  await t.test('invalid model does not change active settings', async () => {
    assert.equal((await request('/settings', { apiKey: testKey, model: 'unsupported/model' })).status, 400);
    assert.equal(aiSettings(owner.address).model, model);
  });
  await t.test('draft passes limits to provider and returns a validated editable strategy', async () => {
    const response = await request('/draft', input);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).model, model);
    assert.deepEqual(JSON.parse(lastRequest.messages[1].content), input);
    assert.equal(lastRequest.provider.require_parameters, true);
    assert.equal(lastRequest.response_format.json_schema.strict, true);
  });
  await t.test('malformed and truncated completions fail closed', async () => {
    for (const value of ['invalid', 'truncated'] as const) {
      mode = value;
      assert.equal((await request('/draft', input)).status, 502);
    }
    mode = 'valid';
  });
  await t.test('credential errors do not leak provider bodies or replace settings', async () => {
    mode = 'unauthorized';
    const response = await request('/settings', { apiKey: 'sk-or-another-test-credential', model });
    assert.equal(response.status, 400);
    assert.ok(!(await response.text()).includes(testKey));
    assert.equal(aiSettings(owner.address).apiKey, testKey);
    mode = 'valid';
  });
  await t.test('credits and timeouts produce safe actionable errors', async () => {
    for (const value of ['credits', 'timeout'] as const) {
      mode = value;
      await assert.rejects(completeJSON(aiSettings(owner.address), 'test', {}, z.object({}), '', ''), value === 'credits' ? /credits/ : /timed out/);
    }
    mode = 'valid';
  });
  await t.test('trade decision schema rejects missing amounts and unsafe actions', () => {
    assert.equal(Decision.safeParse({ actions: [{ action: 'buy', symbol: 'AAPLc', rationale: 'A reason' }], summary: '' }).success, false);
    assert.equal(Decision.safeParse({ actions: [{ action: 'sell', symbol: 'AAPLc', fraction: 2, rationale: 'A reason' }], summary: '' }).success, false);
  });
  await t.test('scheduled decisions use configured OpenRouter and reject bad output', async () => {
    mode = 'invalid';
    clock += 61_000;
    const address = owner.address;
    const mandate: Parameters<typeof decide>[0] = {
      id: 'test', account: address, spender: address, signature: '0x', status: 'active', createdAt: 0,
      batch: { account: address, start: 0, end: 1000, period: 100, permissions: [] },
      universe: [], risk: 'balanced', budgetUsdc: 100, period: 'weekly', maxPositionPct: 40, takeProfitPct: 10, stopLossPct: 7, strategy: 'Hold',
    };
    await assert.rejects(decide(mandate, [], { quotes: [], change24h: {}, changeSinceLastRun: {}, marketOpen: false }, 100), /invalid response/);
    assert.equal(lastRequest.model, model);
    assert.equal(lastRequest.response_format.json_schema.name, 'portfolio_decision');
    const before = calls;
    await assert.rejects(decide({ ...mandate, id: 'another-mandate-same-wallet' }, [], { quotes: [], change24h: {}, changeSinceLastRun: {}, marketOpen: false }, 100), /Wait a minute/);
    assert.equal(calls, before);
    mode = 'valid';
  });
  await t.test('portfolio calls require an owner and reserve input as well as output tokens', async () => {
    const before = calls;
    await assert.rejects(completeJSON(aiSettings(owner.address), 'portfolio_decision', {}, z.object({}), '', ''), /verified account/);
    await assert.rejects(completeJSON(aiSettings(owner.address), 'draft', {}, z.object({}), '', 'x'.repeat(25_000)), /input limit/);
    assert.equal(calls, before);
  });
  await t.test('another wallet cannot reuse or remove the saved credential', async () => {
    const otherHeaders = { ...headers, authorization: `Bearer ${otherToken}` };
    clock += 61_000;
    const before = calls;
    assert.equal((await aiRoutes.request('/settings', { method: 'POST', headers: otherHeaders, body: JSON.stringify({ model }) })).status, 503);
    assert.equal(calls, before);
    assert.equal((await aiRoutes.request('/settings', { method: 'DELETE', headers: otherHeaders })).status, 200);
    assert.equal(aiSettings(owner.address).apiKey, testKey);
  });
  await t.test('reset discards only the wallet credential', async () => {
    const response = await request('/settings', undefined, 'DELETE');
    assert.equal(response.status, 200);
    assert.equal((await response.json()).configured, false);
    assert.equal(aiSettings(owner.address).apiKey, '');
  });
  await t.test('authenticated requests are rate limited', async () => {
    let response: Response | undefined;
    for (let i = 0; i < 21; i++) response = await aiRoutes.request('/models', { headers });
    assert.equal(response?.status, 429);
  });
});
