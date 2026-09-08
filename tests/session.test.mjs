import assert from 'node:assert/strict';
import { test } from 'node:test';
import { QueryClient } from '@tanstack/react-query';
import { createSessionStore } from '../lib/session-state.ts';
import { expireSessionQueries } from '../lib/session-queries.ts';
import { validateBackendURL } from '../lib/backend-url.ts';

const backend = 'https://agent.example';
const session = (token = 'a'.repeat(64)) => ({ token, backend, account: `0x${'1'.repeat(40)}`, expiresAt: 2000 });
function fixture() {
  let raw = null;
  const store = createSessionStore({ read: async () => raw, write: async value => { raw = value; }, remove: async () => { raw = null; } }, () => 1000);
  return { store, raw: () => raw };
}
test('401 clears rejected credentials and denies mounted session queries', async () => {
  const { store } = fixture(); const client = new QueryClient();
  client.setQueryData(['session', session().account], { account: session().account });
  const unsubscribe = store.subscribe(() => expireSessionQueries(client));
  await store.save(session());
  await store.invalidate(backend, session().token);
  assert.equal(await store.token(backend), undefined);
  assert.deepEqual(client.getQueryData(['session', session().account]), { account: '' });
  assert.equal(client.getQueryState(['session', session().account]).isInvalidated, true);
  unsubscribe(); client.clear();
});
test('late unauthorized response cannot delete a newly saved verification', async () => {
  const { store } = fixture(); let denied = 0; store.subscribe(() => denied++);
  const old = session(); const fresh = session('b'.repeat(64));
  await store.save(old);
  await Promise.all([store.save(fresh), store.invalidate(backend, old.token)]);
  assert.equal(await store.token(backend), fresh.token);
  assert.equal(denied, 0);
  await store.invalidate(backend); // A request sent without a token before verification.
  assert.equal(await store.token(backend), fresh.token);
});
test('credentials are backend scoped and malformed or expired sessions fail closed', async () => {
  const { store } = fixture(); await store.save(session());
  assert.equal(await store.token('https://other.example'), undefined);
  await assert.rejects(store.save({ ...session(), expiresAt: 500 }));
  await assert.rejects(store.save({ ...session(), token: 'wrong' }));
  const expired = createSessionStore({ read: async () => JSON.stringify(session()), write: async () => {}, remove: async () => {} }, () => 3000);
  assert.equal(await expired.token(backend), undefined);
});
test('private screens close even when rejected credentials cannot be deleted', async () => {
  const store = createSessionStore({ read: async () => JSON.stringify(session()), write: async () => {}, remove: async () => { throw new Error('locked'); } }, () => 1000);
  let denied = false; store.subscribe(() => { denied = true; });
  await assert.rejects(store.invalidate(backend, session().token)); assert.equal(denied, true);
});
test('all API routes require HTTPS except explicit local development addresses', () => {
  for (const url of [backend, 'http://localhost:8842', 'http://192.168.50.122:8842', 'http://172.16.0.1:8842']) assert.doesNotThrow(() => validateBackendURL(url));
  for (const url of ['http://agent.example', 'http://192.168.50.122.evil.example', 'http://172.32.0.1', 'https://user:password@agent.example', 'file:///tmp/session']) assert.throws(() => validateBackendURL(url));
});
