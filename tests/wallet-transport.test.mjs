import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const upstream = require.resolve('@mobile-wallet-protocol/client/dist/components/communication/postRequestToWallet');
const adapter = resolve('lib/wallet-transport.cjs');
const foreground = () => ({ currentState: 'active', addEventListener: () => ({ remove() {} }) });
// By default timers fire immediately so settle and retry delays do not slow the suite; ordering is still exercised.
const immediate = { setTimeout: fn => globalThis.setImmediate(fn), clearTimeout: globalThis.clearImmediate };
function transport(openAuthSessionAsync, { appState = foreground(), timers = immediate } = {}) {
  const path = existsSync(adapter) ? adapter : upstream;
  const scopedRequire = createRequire(path);
  const exports = {};
  vm.runInNewContext(readFileSync(path, 'utf8'), {
    exports, module: { exports }, URL, URLSearchParams, Uint8Array, Date, ...timers,
    require: name => name === 'expo-web-browser' ? {
      openAuthSessionAsync, dismissBrowser: () => {},
    } : name === 'react-native' ? { AppState: appState } : scopedRequire(name),
  }, { filename: path });
  return exports.postRequestToWallet;
}
const callback = 'mandate:///mwp';
const request = { id: 'request-1', sender: 'public-key', callbackUrl: callback, timestamp: new Date(), content: { handshake: { method: 'eth_requestAccounts' } } };
const wallet = { type: 'web', scheme: 'https://keys.coinbase.com/connect' };
function response(overrides = {}, url = callback) {
  const result = new URL(url);
  for (const [key, value] of Object.entries({ id: 'response-1', requestId: request.id, sender: 'wallet-public-key', timestamp: new Date(), content: { encrypted: { iv: 'AQ==', cipherText: 'Ag==' } }, ...overrides })) result.searchParams.set(key, JSON.stringify(value));
  return { type: 'success', url: result.toString() };
}
test('browser start errors are surfaced as failures, not user rejections', async () => {
  const send = transport(async () => { throw new Error('native failed with sensitive URL'); });
  await assert.rejects(send(request, callback, wallet), e => e.code !== 4001 && /open/i.test(e.message) && !e.message.includes('sensitive'));
});
test('malformed callback fails with a recoverable response error', async () => {
  await assert.rejects(transport(async () => ({ type: 'success', url: callback }))(request, callback, wallet), e => e.code !== 4001 && /response/i.test(e.message));
});
test('dismissal settles promptly instead of leaving signing pending forever', async () => {
  const send = transport(async () => ({ type: 'dismiss' }));
  const outcome = await Promise.race([send(request, callback, wallet).catch(e => e), new Promise(resolve => setTimeout(() => resolve('hung'), 50))]);
  assert.notEqual(outcome, 'hung');
  assert.equal(outcome.code, 4001);
});
test('native cancellation with an OS error remains a visible interruption', async () => {
  await assert.rejects(transport(async () => ({ type: 'cancel', error: 'OS error' }))(request, callback, wallet), e => /closed|complete|interrupt/i.test(e.message));
});
test('valid encrypted callback retains the SDK wire format and saved browser session', async () => {
  const send = transport(async (url, redirect, options) => {
    assert.equal(JSON.parse(new URL(url).searchParams.get('id')), request.id);
    assert.equal(redirect, callback);
    assert.equal(options.preferEphemeralSession, false);
    return response();
  });
  const result = await send(request, callback, wallet);
  assert.equal(result.requestId, request.id);
  assert.deepEqual([...result.content.encrypted.iv], [1]);
  assert.deepEqual([...result.content.encrypted.cipherText], [2]);
});
test('a callback for a different request or app is rejected', async () => {
  for (const result of [response({ requestId: 'stale' }), response({}, 'different:///mwp')]) {
    await assert.rejects(transport(async () => result)(request, callback, wallet), e => e.code !== 4001);
  }
});
test('unsupported browser results settle with a visible failure', async () => {
  const outcome = await Promise.race([transport(async () => ({ type: 'locked' }))(request, callback, wallet).catch(e => e), new Promise(resolve => setTimeout(() => resolve('hung'), 50))]);
  assert.notEqual(outcome, 'hung');
  assert.match(outcome.message, /complete|busy/i);
});

test('overlapping wallet requests are blocked and a closed request can be retried', async () => {
  let finish, opened = 0;
  // The first sheet stays open until the test closes it; the retry's sheet answers at once.
  const send = transport(() => opened++ === 0 ? new Promise(resolve => { finish = resolve; }) : Promise.resolve(response()));
  const first = send(request, callback, wallet);
  await assert.rejects(send(request, callback, wallet), e => e.code === -32002);
  assert.equal(opened, 1);
  finish({ type: 'cancel' });
  await assert.rejects(first, e => e.code === 4001);
  assert.equal((await send(request, callback, wallet)).requestId, request.id);
  assert.equal(opened, 2);
});

test('a sheet that fails to start right after the previous one closed is retried, then given up on', async () => {
  let attempts = 0;
  const send = transport(async () => { if (++attempts < 3) throw new Error('Another web browser is already open'); return response(); });
  assert.equal((await send(request, callback, wallet)).requestId, request.id);
  assert.equal(attempts, 3);
  attempts = 0;
  await assert.rejects(transport(async () => { attempts++; throw new Error('failed to start'); })(request, callback, wallet), e => e.code === -32000 && /open/i.test(e.message));
  assert.equal(attempts, 4);
});

test('the next sheet waits for the app to be active again before opening', async () => {
  const listeners = [];
  const appState = { currentState: 'inactive', addEventListener: (_event, listener) => { listeners.push(listener); return { remove() {} }; } };
  let opened = 0;
  // Real timers: the foreground wait's safety timeout must not fire during this test.
  const timers = { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout };
  const send = transport(async () => { assert.equal(appState.currentState, 'active'); opened++; return response(); }, { appState, timers });
  const pending = send(request, callback, wallet);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(opened, 0);
  assert.equal(listeners.length, 1);
  appState.currentState = 'active';
  listeners[0]('active');
  assert.equal((await pending).requestId, request.id);
  assert.equal(opened, 1);
});

test('Metro selects the repaired transport and leaves the codec untouched', () => {
  const config = require('../metro.config.js');
  for (const platform of ['ios', 'android']) {
    const context = { resolveRequest: (_ctx, name) => ({ type: 'sourceFile', filePath: require.resolve(name) }) };
    assert.equal(config.resolver.resolveRequest(context, upstream, platform).filePath, adapter);
    const codec = require.resolve('@mobile-wallet-protocol/client/dist/components/communication/utils/encoding');
    assert.equal(config.resolver.resolveRequest(context, codec, platform).filePath, codec);
  }
});
