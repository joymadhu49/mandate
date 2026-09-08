import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import type { Mandate, Order } from './types.js';
import { atomicWriteJson, loadValidatedJson } from './persistence.js';

const directory = mkdtempSync(join(tmpdir(), 'mandate-execution-'));
process.env.NODE_ENV = 'test'; process.env.DRY_RUN = '1'; process.env.AGENT_PRIVATE_KEY = ''; process.env.OPENROUTER_API_KEY = '';
process.env.DB_PATH = join(directory, 'db.json');
const { config } = await import('./config.js');
const { db, DatabaseSchema } = await import('./db.js');
const { publicClient, walletClient, sendTx, STOCKS, USDC, spenderFor } = await import('./chain.js');
const { executeOrder, modeMatches, revokeMandate, recoverInterruptedExecutions } = await import('./runner.js');
const { decide } = await import('./brain.js');
const { setAISettings, resetAISettings } = await import('./openrouter.js');
const { quoteSwap, LIFI_BASE_DIAMOND } = await import('./lifi.js');
const token = STOCKS[0].token;
const owner = '0x0000000000000000000000000000000000000001' as const;
const agent = spenderFor(owner);
const ts = Math.floor(Date.now() / 1000);
const mandate = (): Mandate => ({ id: 'm', executionMode: 'simulation', account: owner, spender: agent.address, budgetUsdc: 100, period: 'weekly', universe: [token], strategy: 'Hold', risk: 'balanced', maxPositionPct: 100, takeProfitPct: 10, stopLossPct: 7, createdAt: ts, status: 'active', batch: { account: owner, period: 604800, start: ts - 1000, end: ts + 604800, permissions: [{ spender: agent.address, token: USDC, allowance: '100000000', salt: '1', extraData: '0x' }, { spender: agent.address, token, allowance: '100000000000000000000', salt: '2', extraData: '0x' }] } });
const order = (): Order => ({ id: 'o', mandateId: 'm', account: owner, action: 'buy', token, symbol: STOCKS[0].symbol, usd: 10, rationale: 'Fixture', status: 'queued', createdAt: ts - 61, executeAfter: ts - 1, updatedAt: ts, dryRun: true });
function quoteResponse() {
  return { transactionRequest: { from: agent.address, to: LIFI_BASE_DIAMOND, chainId: 8453, data: '0x1234', value: '0' }, action: { fromChainId: 8453, toChainId: 8453, fromAddress: agent.address, toAddress: agent.address, fromAmount: '10000000', fromToken: { address: USDC }, toToken: { address: token } }, estimate: { toAmount: '100000000000000000', toAmountMin: '90000000000000000', approvalAddress: LIFI_BASE_DIAMOND }, tool: 'fixture' };
}

test('execution safety regressions without network or signing real transactions', async t => {
  t.after(() => { resetAISettings(); rmSync(directory, { recursive: true, force: true }); });
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected external request'); });
  let submitted = 0;
  let reverted = false;
  let revertAt = 0;
  let signedCount = 0;
  let zeroOutput = false;
  let fresh = true;
  t.mock.method(walletClient, 'prepareTransactionRequest', async () => ({} as any));
  t.mock.method(walletClient, 'signTransaction', async () => `0x${(++signedCount).toString(16).padStart(2, '0')}` as const);
  t.mock.method(walletClient, 'sendRawTransaction', async () => { submitted++; return `0x${'1'.repeat(64)}` as const; });
  t.mock.method(publicClient, 'waitForTransactionReceipt', async () => ({ status: reverted || submitted === revertAt ? 'reverted' : 'success' } as any));
  t.mock.method(publicClient, 'multicall', async () => STOCKS.map(() => ({ status: 'success', result: [1n, 10000000000n, 0n, BigInt(fresh ? ts : ts - 100000), 1n] })) as any);
  t.mock.method(publicClient, 'readContract', async (args: any) => {
    if (args.functionName === 'decimals') return 18;
    if (args.functionName === 'getCurrentPeriod') return { spend: 0n };
    if (args.functionName === 'isValid') return true;
    if (args.functionName === 'allowance') return 100000000000000000000n;
    if (args.functionName === 'balanceOf') {
      if (args.address === USDC) return 100000000n;
      if (zeroOutput) return 0n;
      return submitted >= (args.args[0] === agent.address ? 2 : 3) ? 100000000000000000n : 0n;
    }
    throw new Error('Unexpected contract read');
  });
  const reset = () => { db.mandates.length = db.orders.length = db.positions.length = db.activity.length = 0; submitted = 0; reverted = false; revertAt = 0; zeroOutput = false; fresh = true; config.dryRun = true; };

  await t.test('signed hash is recorded before broadcast and reverted receipts reject', async () => {
    const events: string[] = [];
    reverted = true;
    await assert.rejects(sendTx(owner, '0x', 0n, (_hash, status) => { events.push(status); if (status === 'prepared') assert.equal(submitted, 0); }), /reverted/);
    assert.deepEqual(events, ['prepared', 'failed']); assert.equal(submitted, 1);
  });
  await t.test('simulation orders fill with isolated provenance and correct budget', async () => {
    reset(); const m = mandate(); const o = order(); db.mandates.push(m); db.orders.push(o);
    await executeOrder(o);
    assert.equal(o.status, 'filled'); assert.equal(m.spentThisPeriod, 10); assert.equal(db.positions[0].executionMode, 'simulation'); assert.equal(submitted, 0);
  });
  await t.test('period rollover resets spent budget while execution enforces current position room', async () => {
    reset(); const m = mandate(); m.spentThisPeriod = 100; m.periodStart = ts - 1000000; m.maxPositionPct = 50;
    const o = order(); o.usd = 20; db.mandates.push(m); db.positions.push({ mandateId: m.id, executionMode: 'simulation', token, symbol: STOCKS[0].symbol, shares: 0.45, raw: '450000000000000000', costUsd: 45 });
    await executeOrder(o); assert.equal(o.status, 'filled'); assert.equal(o.filledUsd, 5); assert.equal(m.spentThisPeriod, 5); assert.equal(db.positions[0].shares, 0.5);
  });
  await t.test('unknown and simulated mandates cannot activate live', () => {
    reset(); config.dryRun = false; const m = mandate();
    assert.equal(modeMatches(m), false); delete m.executionMode; assert.equal(modeMatches(m), false);
    m.executionMode = 'live'; assert.equal(modeMatches(m), true);
  });
  await t.test('stale preflight preserves live mandate and submits nothing', async () => {
    reset(); config.dryRun = false; fresh = false; const m = mandate(); m.executionMode = 'live'; const o = order(); o.dryRun = false; db.mandates.push(m);
    await executeOrder(o); assert.equal(o.status, 'failed'); assert.equal(m.status, 'active'); assert.equal(submitted, 0);
  });
  await t.test('risk exits precede configured AI and never call the provider', async () => {
    reset(); const m = mandate(); setAISettings({ apiKey: 'fixture', model: 'fixture' });
    const position = { mandateId: m.id, token, symbol: STOCKS[0].symbol, shares: 1, raw: '1000000000000000000', costUsd: 100 };
    const result = await decide(m, [position], { quotes: [{ token, symbol: STOCKS[0].symbol, price: 80, updatedAt: ts, stale: false }], marketOpen: true, change24h: {}, changeSinceLastRun: {} }, 100);
    assert.equal(result.actions[0].action, 'sell'); assert.equal((result.actions[0] as { fraction: number }).fraction, 1); resetAISettings();
  });
  await t.test('execution blocks a buy after stop-loss is hit', async () => {
    reset(); const m = mandate(); const o = order(); db.mandates.push(m); db.positions.push({ mandateId: m.id, executionMode: 'simulation', token, symbol: STOCKS[0].symbol, shares: 0.5, raw: '500000000000000000', costUsd: 100 });
    await executeOrder(o); assert.equal(o.status, 'failed'); assert.equal(m.spentThisPeriod, undefined); assert.equal(db.positions[0].shares, 0.5);
  });
  await t.test('a recovered risk threshold cancels the queued exit without selling', async () => {
    reset(); const m = mandate(); const o = order(); o.action = 'sell'; o.fraction = 1; o.riskExit = 'stop-loss';
    db.mandates.push(m); db.positions.push({ mandateId: m.id, executionMode: 'simulation', token, symbol: STOCKS[0].symbol, shares: 1, raw: '1000000000000000000', costUsd: 100 });
    await executeOrder(o); assert.equal(o.status, 'failed'); assert.equal(db.positions[0].shares, 1); assert.equal(m.status, 'active');
  });
  await t.test('quote timeout/failure happens before pulling funds', async () => {
    reset(); config.dryRun = false; const m = mandate(); m.executionMode = 'live'; const o = order(); o.dryRun = false; db.mandates.push(m);
    await executeOrder(o); assert.equal(o.status, 'failed'); assert.equal(submitted, 0); assert.equal(m.status, 'active');
  });
  await t.test('reverted pull is durably journaled and quarantines mandate', async () => {
    reset(); config.dryRun = false; reverted = true; const m = mandate(); m.executionMode = 'live'; const o = order(); o.dryRun = false; db.mandates.push(m); db.orders.push(o);
    const mock = t.mock.method(globalThis, 'fetch', async () => Response.json(quoteResponse()));
    await executeOrder(o); mock.mock.restore();
    assert.equal(o.status, 'failed'); assert.equal(m.status, 'error'); assert.equal(o.transactions?.[0].status, 'failed');
    assert.equal(JSON.parse(readFileSync(config.dbPath, 'utf8')).orders[0].transactions[0].status, 'failed');
  });
  await t.test('already revoked permissions are skipped, making retry idempotent', async () => {
    reset(); config.dryRun = false; const m = mandate(); m.executionMode = 'live';
    const mock = t.mock.method(publicClient, 'readContract', async () => true as any);
    await revokeMandate(m); await revokeMandate(m); mock.mock.restore();
    assert.equal(m.status, 'revoked'); assert.equal(submitted, 0);
  });
  await t.test('failed final delivery never records a filled order or user position', async () => {
    reset(); config.dryRun = false; revertAt = 3; const m = mandate(); m.executionMode = 'live'; const o = order(); o.dryRun = false; db.mandates.push(m); db.orders.push(o);
    const mock = t.mock.method(globalThis, 'fetch', async () => Response.json(quoteResponse()));
    await executeOrder(o); mock.mock.restore();
    assert.equal(o.status, 'failed'); assert.equal(m.status, 'error'); assert.equal(db.positions.length, 0);
    assert.deepEqual(o.transactions?.map(step => [step.name, step.status]), [['pull', 'confirmed'], ['swap', 'confirmed'], ['delivery', 'failed']]);
  });
  await t.test('confirmed live steps produce a position only after verified delivery', async () => {
    reset(); config.dryRun = false; const m = mandate(); m.executionMode = 'live'; const o = order(); o.dryRun = false; db.mandates.push(m); db.orders.push(o);
    const mock = t.mock.method(globalThis, 'fetch', async () => Response.json(quoteResponse()));
    await executeOrder(o); mock.mock.restore();
    assert.equal(o.status, 'filled'); assert.equal(m.status, 'active'); assert.equal(db.positions[0].executionMode, 'live'); assert.equal(db.positions[0].shares, 0.1);
    assert.deepEqual(o.transactions?.map(step => step.status), ['confirmed', 'confirmed', 'confirmed']);
  });
  await t.test('zero swap output is quarantined before transfer or accounting', async () => {
    reset(); config.dryRun = false; zeroOutput = true; const m = mandate(); m.executionMode = 'live'; const o = order(); o.dryRun = false; db.mandates.push(m); db.orders.push(o);
    const mock = t.mock.method(globalThis, 'fetch', async () => Response.json(quoteResponse()));
    await executeOrder(o); mock.mock.restore();
    assert.equal(o.status, 'failed'); assert.equal(m.status, 'error'); assert.equal(submitted, 2); assert.equal(db.positions.length, 0);
  });
  await t.test('restart preserves transaction hashes and quarantines interrupted live execution', () => {
    reset(); config.dryRun = false; const m = mandate(); m.executionMode = 'live'; const o = order(); o.dryRun = false; o.status = 'executing';
    o.transactions = [{ name: 'pull', hash: `0x${'1'.repeat(64)}`, status: 'prepared', updatedAt: ts }];
    db.mandates.push(m); db.orders.push(o); recoverInterruptedExecutions();
    assert.equal(m.status, 'error'); assert.equal(o.status, 'failed'); assert.equal(o.transactions[0].hash, `0x${'1'.repeat(64)}`);
  });
  await t.test('LI.FI requests have deadline and reject mismatched transaction intent', async () => {
    const mock = t.mock.method(globalThis, 'fetch', async (_url: any, init: any) => { assert.ok(init.signal); assert.equal(init.redirect, 'manual'); const quote = quoteResponse(); quote.action.fromAmount = '1'; return Response.json(quote); });
    await assert.rejects(quoteSwap({ from: agent.address, fromToken: USDC, toToken: token, fromAmount: 10000000n }), /does not match/); mock.mock.restore();
  });
  await t.test('atomic persistence preserves valid state and refuses corrupt or invalid input', () => {
    const file = join(directory, 'persist.json'); const schema = z.object({ count: z.number().int() });
    atomicWriteJson(file, { count: 1 }); atomicWriteJson(file, { count: 2 });
    assert.equal(loadValidatedJson(file, schema, { count: 0 }).count, 2);
    writeFileSync(file, '{'); assert.throws(() => loadValidatedJson(file, schema, { count: 0 }), /invalid/);
    writeFileSync(file, '{"count":"wrong"}'); assert.throws(() => loadValidatedJson(file, schema, { count: 0 }), /invalid/);
    assert.equal(DatabaseSchema.safeParse({ mandates: 'invalid', positions: [], activity: [], prices: [] }).success, false);
  });
});
