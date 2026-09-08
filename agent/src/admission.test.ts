import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AI_LIMITS, FundedAIAdmission, assertMandateAdmission, emptyUsage } from './admission.js';

const alice = `0x${'1'.repeat(40)}`;
const bob = `0x${'2'.repeat(40)}`;
function fixture() {
  let now = Date.UTC(2026, 8, 5);
  let usage = emptyUsage();
  const read = () => usage;
  const write = (value: typeof usage) => { usage = value; };
  const clock = () => now;
  return { gate: new FundedAIAdmission(read, write, clock), read, write, clock, advance: (ms: number) => { now += ms; } };
}

test('wallet cooldown survives reconstructing the guard and cannot be bypassed by another mandate', async () => {
  const f = fixture(); let calls = 0;
  const work = async () => { calls++; };
  await f.gate.run(alice, 1000, work);
  const restarted = new FundedAIAdmission(f.read, f.write, f.clock);
  await assert.rejects(restarted.run(alice.toUpperCase().replace('0X', '0x'), 1000, work), /Wait a minute/);
  await restarted.run(bob, 1000, work);
  f.advance(60_000);
  await restarted.run(alice, 1000, work);
  assert.equal(calls, 3);
});

test('failed completions consume their reserved budget and UTC rollover restores admission', async () => {
  const f = fixture(); let calls = 0;
  await assert.rejects(f.gate.run(alice, 2000, async () => { calls++; throw new Error('provider failed'); }), /provider failed/);
  assert.equal(f.read().total, 2000);
  f.write({ ...f.read(), total: AI_LIMITS.globalDailyTokens });
  await assert.rejects(f.gate.run(bob, 2000, async () => { calls++; }), /daily AI usage/);
  f.advance(86400_000);
  await f.gate.run(bob, 2000, async () => { calls++; });
  assert.equal(calls, 2);
  assert.equal(f.read().total, 2000);
});

test('development requests and independent wallets share the concurrency and daily budget', async () => {
  const f = fixture();
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const first = f.gate.run(alice, 1000, () => pending);
  const second = f.gate.run(undefined, 1000, () => pending);
  await assert.rejects(f.gate.run(bob, 1000, async () => {}), /busy/);
  assert.equal(f.read().total, 2000);
  release(); await Promise.all([first, second]);
  await f.gate.run(bob, 1000, async () => {});
});

test('owner budgets, malformed identities, oversized requests and failed persistence block external work', async () => {
  const f = fixture(); let calls = 0;
  const work = async () => { calls++; };
  await f.gate.run(alice, 1000, work);
  f.advance(60_000);
  f.write({ ...f.read(), owners: { [alice]: { tokens: AI_LIMITS.ownerDailyTokens, lastAt: 0 } } });
  await assert.rejects(f.gate.run(alice, 1000, work), /daily AI usage/);
  await assert.rejects(f.gate.run('__proto__', 1000, work), /verified account/);
  await assert.rejects(f.gate.run(bob, AI_LIMITS.maxRequestTokens + 1, work), /input limit/);
  const blocked = new FundedAIAdmission(f.read, () => { throw new Error('disk failure'); }, f.clock);
  await assert.rejects(blocked.run(bob, 1000, work), /disk failure/);
  assert.equal(calls, 1);
});

test('creation limits cover rapid repeats, owner caps and alternate-wallet global caps', () => {
  const now = Date.now();
  const mandate = { account: alice, status: 'active', createdAt: now / 1000 - 60 };
  assert.throws(() => assertMandateAdmission([{ ...mandate, createdAt: now / 1000 }], alice, now), /30 seconds/);
  assert.throws(() => assertMandateAdmission(Array(5).fill(mandate), alice, now), /mandate limit/);
  assert.doesNotThrow(() => assertMandateAdmission(Array(5).fill({ ...mandate, status: 'revoked' }), alice, now));
  assert.throws(() => assertMandateAdmission(Array(100).fill(mandate), bob, now), /mandate limit/);
});

test('chat allows conversation after five seconds without resetting shared owner budgets', async () => {
  const f = fixture();
  await f.gate.run(alice, 1000, async () => {}, 'chat');
  await assert.rejects(f.gate.run(alice, 1000, async () => {}, 'chat'), /five seconds/);
  f.advance(5000);
  await f.gate.run(alice, 1000, async () => {}, 'chat');
  assert.equal(f.read().owners[alice].tokens, 2000);
  await assert.rejects(f.gate.run(alice, 1000, async () => {}), /Wait a minute/);
});
