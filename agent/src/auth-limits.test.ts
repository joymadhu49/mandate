import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Hono } from 'hono';
import { AuthLimiter, authSource } from './auth-limits.js';

test('challenge floods only exhaust that source and endpoint, then expire', () => {
  let now = 1;
  const limiter = new AuthLimiter(() => now);
  for (let i = 0; i < 30; i++) assert.equal(limiter.allow('challenge', 'attacker'), true);
  assert.equal(limiter.allow('challenge', 'attacker'), false);
  assert.equal(limiter.allow('challenge', 'other-connection'), true);
  assert.equal(limiter.allow('verify', 'attacker'), true);
  now += 60_000;
  assert.equal(limiter.allow('challenge', 'attacker'), true);
});

test('a forwarding header cannot replace the actual socket source', async () => {
  const app = new Hono();
  app.get('/', c => c.text(authSource(c)));
  const connection = { incoming: { socket: { remoteAddress: '127.0.0.1' } } };
  const first = await (await app.request('/', {}, connection)).text();
  const spoofed = await (await app.request('/', { headers: { 'x-forwarded-for': '203.0.113.3' } }, connection)).text();
  const different = await (await app.request('/', {}, { incoming: { socket: { remoteAddress: '203.0.113.3' } } })).text();
  assert.equal(first, spoofed);
  assert.notEqual(first, different);
});
