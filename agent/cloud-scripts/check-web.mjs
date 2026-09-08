// Public deployment smoke test. Uses an ephemeral unfunded wallet and signs only
// its login challenge. Never creates a mandate, permission, order or transaction.
import assert from 'node:assert/strict';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
const origin = 'https://mandate.horizonbase.app';
const wallet = privateKeyToAccount(generatePrivateKey());
const call = (path, body, cookie, extra = {}) => fetch(origin + '/api' + path, {
  method: body === undefined ? 'GET' : 'POST', redirect: 'manual',
  headers: { 'content-type': 'application/json', origin, ...(cookie ? { cookie } : {}), ...extra },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
const html = await fetch(origin, { headers: { accept: 'text/html' }, redirect: 'manual' });
assert.equal(html.status, 200);
const document = await html.text();
assert.match(document, /base:app_id/);
assert.match(document, /_expo\/static\/js\/web/);
const native = await fetch(origin + '/', { headers: { 'content-type': 'application/json' } });
assert.equal((await native.json()).name, 'mandate-agent');
assert.equal((await call('/orders')).status, 401);
assert.equal((await call('/_migration/import', {})).status, 404);
assert.equal((await call('/auth/challenge', { account: wallet.address }, undefined, { origin: 'https://evil.example' })).status, 403);
const challengeResponse = await call('/auth/challenge', { account: wallet.address });
assert.equal(challengeResponse.status, 200);
const challenge = await challengeResponse.json();
const signature = await wallet.signMessage({ message: challenge.message });
const verified = await call('/auth/verify', { nonce: challenge.nonce, signature });
assert.equal(verified.status, 200);
const session = await verified.json();
assert.equal(session.token, 'browser-session');
assert.equal(session.account.toLowerCase(), wallet.address.toLowerCase());
const setCookie = verified.headers.get('set-cookie');
assert.match(setCookie, /Secure; HttpOnly; SameSite=Strict; Path=\//);
const cookie = setCookie.split(';')[0];
try {
  assert.equal((await call('/auth/verify', { nonce: challenge.nonce, signature })).status, 401);
  const restored = await call('/auth/session', undefined, cookie);
  assert.equal(restored.status, 200);
  assert.equal((await restored.json()).account.toLowerCase(), wallet.address.toLowerCase());
  assert.deepEqual(await (await call('/orders', undefined, cookie)).json(), []);
  const location = await (await call('/eligibility/location')).json();
  const forgedCountry = location.country === 'US' ? 'DE' : 'US';
  const spoofed = await (await call('/eligibility/location', undefined, undefined, { 'x-mandate-country': forgedCountry, 'cf-ipcountry': forgedCountry })).json();
  assert.equal(spoofed.country, location.country);
  assert.equal((await (await call('/eligibility', undefined, cookie)).json()).allowed, false);
  // Invalid payloads can never authorize spending, even if a gate regresses.
  assert.equal((await call('/mandates', {}, cookie)).status, 403);
  assert.equal((await call('/test-swap/wallet', undefined, cookie)).status, 403);
  const nativeBlocked = await fetch(origin + '/mandates', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + cookie.split('=')[1], 'cf-ipcountry': 'DE' }, body: '{}' });
  assert.equal(nativeBlocked.status, 403);
  assert.equal((await call('/auth/session', undefined, undefined, { authorization: 'Bearer ' + cookie.split('=')[1] })).status, 401);
} finally {
  const logout = await call('/auth/logout', {}, cookie);
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal((await call('/auth/session', undefined, cookie)).status, 401);
}
const demo = await fetch(origin + '/demo/mandate-build13-demo.mp4', { method: 'HEAD' });
assert.equal(demo.status, 200);
console.log('PASS: web document, native API, secure browser login, session restoration, replay rejection, ownership, CSRF, logout, eligibility denial, spoofed geo headers and existing App Review media. No financial transactions.');
