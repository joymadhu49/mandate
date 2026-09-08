import test from 'node:test';
import assert from 'node:assert/strict';
import { createGateway } from './gateway.mjs';
const origin = 'http://localhost:8082';
const token = 'a'.repeat(64);
const account = '0x' + '1'.repeat(40);
function request(path, { method = 'GET', cookie, headers = {}, body } = {}) {
  return new Request(origin + '/api' + path, { method, headers: { ...(method !== 'GET' ? { origin, 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
}
const authResponse = () => Response.json({ token, account, expiresAt: Date.now() + 60_000 });
test('wallet tokens stay on the server; only the cookie restores authorization', async () => {
  const calls = [];
  const gateway = createGateway({ origin, fetcher: async (url, init) => { calls.push({ url, init }); return url.endsWith('/auth/verify') ? authResponse() : Response.json({ account }); } });
  const verified = await gateway(request('/auth/verify', { method: 'POST', body: { nonce: 'challenge', signature: 'signed' } }));
  const body = await verified.json();
  assert.equal(body.token, 'browser-session');
  const setCookie = verified.headers.get('set-cookie');
  assert.ok(setCookie.includes('HttpOnly; SameSite=Strict; Path=/api;'));
  assert.ok(!setCookie.includes(token));
  const cookie = setCookie.split(';')[0];
  await gateway(request('/auth/session', { cookie, headers: { authorization: 'Bearer attacker' } }));
  assert.equal(calls.at(-1).init.headers.authorization, `Bearer ${token}`);
  await gateway(request('/orders', { headers: { authorization: `Bearer ${token}` } }));
  assert.equal(calls.at(-1).init.headers.authorization, undefined);
  const logout = await gateway(request('/auth/logout', { method: 'POST', cookie }));
  assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);
  await gateway(request('/auth/session', { cookie }));
  assert.equal(calls.at(-1).init.headers.authorization, undefined);
});
test('rejects cross origin writes, DNS rebinding, migration routes, and oversized bodies', async () => {
  const gateway = createGateway({ origin, fetcher: () => { throw new Error('Must not reach upstream'); } });
  for (const headers of [{ origin: 'https://evil.example' }, { origin: '' }, { 'content-type': 'text/plain' }, { 'sec-fetch-site': 'cross-site' }]) {
    assert.equal((await gateway(request('/auth/challenge', { method: 'POST', headers }))).status, 403);
  }
  assert.equal((await gateway(new Request('http://evil.example/api/agent'))).status, 403);
  assert.equal((await gateway(request('/_migration'))).status, 404);
  assert.equal((await gateway(request('/auth/verify', { method: 'POST', body: { data: 'a'.repeat(140_000) } }))).status, 413);
});
test('expired cookies never authorize requests and failed upstream responses are sanitized', async () => {
  let clock = Date.now(); const calls = [];
  const gateway = createGateway({ origin, now: () => clock, fetcher: async (url, init) => { calls.push(init); return url.endsWith('/auth/verify') ? authResponse() : Response.json({ account }); } });
  const verified = await gateway(request('/auth/verify', { method: 'POST' }));
  const cookie = verified.headers.get('set-cookie').split(';')[0];
  clock += 120_000;
  await gateway(request('/orders', { cookie }));
  assert.equal(calls.at(-1).headers.authorization, undefined);
  const broken = createGateway({ origin, fetcher: async () => { throw new Error('private diagnostic'); } });
  const response = await broken(request('/agent'));
  assert.equal(response.status, 502);
  assert.ok(!(await response.text()).includes('private diagnostic'));
});
