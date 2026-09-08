import assert from 'node:assert/strict';
import { test } from 'node:test';
import { browserAPI, wantsWebApp } from './browser-api.js';
const origin = 'https://mandate.example';
const token = 'a'.repeat(64), account = '0x' + '1'.repeat(40);
function request(path: string, method = 'GET', headers: Record<string, string> = {}, body?: string) {
  return new Request(origin + '/api' + path, { method, headers: { ...(method !== 'GET' ? { origin, 'content-type': 'application/json' } : {}), ...headers }, body });
}
test('browser verification sets a secure HttpOnly cookie and redacts the bearer token', async () => {
  const res = await browserAPI(request('/auth/verify', 'POST', {}, '{}'), origin, async () => Response.json({ token, account, expiresAt: Date.now() + 86_400_000 }));
  assert.equal(res.status, 200); assert.equal((await res.json()).token, 'browser-session');
  assert.match(res.headers.get('set-cookie')!, /^__Host-mandate_session=[a-f0-9]{64}; Secure; HttpOnly; SameSite=Strict; Path=\/; Max-Age=/);
  assert.equal(res.headers.get('access-control-allow-origin'), null);
  assert.equal(res.headers.get('cache-control'), 'no-store');
});
test('only the cookie supplies browser authorization; native CORS headers are removed', async () => {
  const calls: Request[] = [];
  const forward = async (req: Request) => { calls.push(req); return Response.json({ ok: true }, { headers: { 'access-control-allow-origin': '*' } }); };
  const res = await browserAPI(request('/orders', 'GET', { cookie: `__Host-mandate_session=${token}`, authorization: 'Bearer attacker', 'x-mandate-client-ip': 'transport-ip' }), origin, forward);
  assert.equal(new URL(calls[0].url).pathname, '/orders');
  assert.equal(calls[0].headers.get('authorization'), `Bearer ${token}`);
  assert.equal(calls[0].headers.get('cookie'), null);
  assert.equal(calls[0].headers.get('x-mandate-client-ip'), 'transport-ip');
  assert.equal(res.headers.get('access-control-allow-origin'), null);
  await browserAPI(request('/orders', 'GET', { authorization: `Bearer ${token}`, cookie: 'wrong=value' }), origin, forward);
  assert.equal(calls[1].headers.get('authorization'), null);
});
test('CSRF, other origins, migration routes and oversized bodies fail closed', async () => {
  const forward = async () => { throw new Error('Must not be called'); };
  for (const headers of [{ origin: 'https://evil.example' }, { origin: '' }, { 'content-type': 'text/plain' }, { 'sec-fetch-site': 'cross-site' }] as Record<string, string>[]) {
    assert.equal((await browserAPI(request('/auth/challenge', 'POST', headers), origin, forward)).status, 403);
  }
  assert.equal((await browserAPI(new Request('https://other.example/api/agent'), origin, forward)).status, 403);
  assert.equal((await browserAPI(request('/_migration/import', 'POST'), origin, forward)).status, 404);
  assert.equal((await browserAPI(request('/chat', 'POST', {}, 'a'.repeat(140_000)), origin, forward)).status, 413);
});
test('logout clears expired cookies; malformed verification never sets a cookie', async () => {
  const out = await browserAPI(request('/auth/logout', 'POST'), origin, async () => Response.json({ error: 'Verify wallet' }, { status: 401 }));
  assert.equal(out.status, 200); assert.match(out.headers.get('set-cookie')!, /Max-Age=0/);
  const bad = await browserAPI(request('/auth/verify', 'POST'), origin, async () => Response.json({ token: 'bad', account, expiresAt: Date.now() + 5000 }));
  assert.equal(bad.status, 502); assert.equal(bad.headers.get('set-cookie'), null);
});
test('browser documents and native JSON APIs keep separate routing', () => {
  for (const path of ['/', '/home', '/agent', '/orders', '/history', '/settings', '/new-mandate', '/profile', '/mandate/abc', '/order/abc']) {
    assert.equal(wantsWebApp(new Request(origin + path, { headers: { accept: 'text/html' } })), true, path);
    assert.equal(wantsWebApp(new Request(origin + path, { headers: { accept: '*/*', 'content-type': 'application/json' } })), false, path);
  }
  for (const path of ['/api/orders', '/auth/session', '/_migration/import', '/demo/file.mp4', '/missing.js']) assert.equal(wantsWebApp(new Request(origin + path, { headers: { accept: 'text/html' } })), false, path);
  assert.equal(wantsWebApp(new Request(origin + '/', { headers: { accept: '*/*' } })), true);
  assert.equal(wantsWebApp(new Request(origin + '/orders', { headers: { accept: '*/*' } })), false);
});
