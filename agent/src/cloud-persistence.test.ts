import assert from 'node:assert/strict';
import { test } from 'node:test';
import { z } from 'zod';
import { generatePrivateKey } from 'viem/accounts';

process.env.CLOUDFLARE_WORKER = '1';
process.env.AGENT_PRIVATE_KEY = generatePrivateKey();
process.env.SCHEDULER_ENABLED = '1';
const { withRuntime } = await import('./runtime.js');
const { persistentObject, atomicWriteJson } = await import('./persistence.js');
const { persistentMap } = await import('./persistent-map.js');
const backing = () => {
  const values = new Map<string, string>();
  return { values, store: { cache: new Map<string, unknown>(), read: (key: string) => values.get(key), write: (key: string, value: string) => { values.set(key, value); }, flush: async () => {} } };
};

test('durable documents and sessions remain isolated across interleaved storage contexts and cache eviction', async () => {
  const a = backing(), b = backing();
  const document = persistentObject('/test.json', z.object({ items: z.array(z.string()) }), { items: [] });
  const sessions = persistentMap('/sessions.json', z.object({ account: z.string() }));
  await Promise.all([
    withRuntime(a.store, async () => { document.items.push('a'); await Promise.resolve(); atomicWriteJson('/test.json', document); sessions.set('token', { account: 'alice' }); }),
    withRuntime(b.store, async () => { document.items.push('b'); await Promise.resolve(); atomicWriteJson('/test.json', document); sessions.set('token', { account: 'bob' }); }),
  ]);
  a.store.cache.clear(); b.store.cache.clear();
  withRuntime(a.store, () => { assert.deepEqual(document.items, ['a']); assert.equal(sessions.get('token')?.account, 'alice'); sessions.delete('token'); });
  withRuntime(b.store, () => { assert.deepEqual(document.items, ['b']); assert.equal(sessions.get('token')?.account, 'bob'); });
  a.store.cache.clear();
  withRuntime(a.store, () => assert.equal(sessions.has('token'), false));
});

test('a failed durable commit prevents broadcasting a signed transaction', async t => {
  const { sendTx, walletClient } = await import('./chain.js');
  const state = backing();
  state.store.flush = async () => { throw new Error('durable commit failed'); };
  t.mock.method(walletClient, 'prepareTransactionRequest', async () => ({}));
  t.mock.method(walletClient, 'signTransaction', async () => '0x01');
  const broadcast = t.mock.method(walletClient, 'sendRawTransaction', async () => { throw new Error('must never broadcast'); });
  let prepared = false;
  await assert.rejects(withRuntime(state.store, () => sendTx('0x0000000000000000000000000000000000000001', '0x', 0n, () => { prepared = true; })), /durable commit failed/);
  assert.equal(prepared, true);
  assert.equal(broadcast.mock.callCount(), 0);
});
