import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.NODE_ENV = 'test';
const { config } = await import('./config.js');
const { quoteSwap } = await import('./swap.js');
const { quoteSwap: relayQuote } = await import('./relay.js');
const { quoteSwap: lifiQuote, LIFI_BASE_DIAMOND } = await import('./lifi.js');
const from = '0x0000000000000000000000000000000000000001';
const fromToken = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const toToken = '0xb200000000000000000000C2e324d24d7eEcd1fb';
const params = { from, fromToken, toToken, fromAmount: 1000000n } as const;
const valid = () => ({
  transactionRequest: { from, to: LIFI_BASE_DIAMOND, chainId: 8453, data: '0x1234', value: '0' },
  action: { fromChainId: 8453, toChainId: 8453, fromAddress: from, toAddress: from, fromAmount: '1000000', fromToken: { address: fromToken }, toToken: { address: toToken } },
  estimate: { toAmount: '100', toAmountMin: '99', approvalAddress: LIFI_BASE_DIAMOND }, tool: 'lifi-fixture',
});

test('quote recovery uses validated providers and preserves the failure reason', async t => {
  const provider = config.swapProvider;
  t.after(() => { config.swapProvider = provider; });
  config.swapProvider = 'relay';
  await t.test('a Relay outage falls back to a validated LI.FI quote', async t => {
    const calls: string[] = [];
    t.mock.method(globalThis, 'fetch', async (url: string) => {
      calls.push(url);
      return url.startsWith('https://api.relay.link/')
        ? Response.json({ errorCode: 'SERVICE_UNAVAILABLE' }, { status: 503 })
        : Response.json(valid());
    });
    assert.equal((await quoteSwap(params)).tool, 'lifi-fixture');
    assert.equal(calls.length, 2);
  });
  for (const [name, ask, body, status, kind] of [
    ['Relay no route', relayQuote, { errorCode: 'NO_SWAP_ROUTES_FOUND' }, 400, 'no_route'],
    ['LI.FI no route', lifiQuote, { code: 1002 }, 404, 'no_route'],
    ['Relay outage', relayQuote, { errorCode: 'SERVICE_UNAVAILABLE' }, 503, 'unavailable'],
    ['LI.FI rate limit', lifiQuote, {}, 429, 'rate_limited'],
    ['Relay forbidden', relayQuote, { errorCode: 'FORBIDDEN' }, 403, 'blocked'],
  ] as const) {
    await t.test(name, async t => {
      t.mock.method(globalThis, 'fetch', async () => Response.json(body, { status }));
      await assert.rejects(ask(params), (e: any) => e.kind === kind);
    });
  }
  for (const [name, body, status] of [
    ['forbidden requests', { errorCode: 'FORBIDDEN' }, 403],
    ['invalid quote responses', { steps: [] }, 200],
    ['redirects', {}, 307],
  ] as const) {
    await t.test(`${name} never trigger provider fallback`, async t => {
      let calls = 0;
      t.mock.method(globalThis, 'fetch', async () => { calls++; return Response.json(body, { status }); });
      await assert.rejects(quoteSwap(params));
      assert.equal(calls, 1);
    });
  }
  await t.test('a fallback quote still has to pass transaction validation', async t => {
    t.mock.method(globalThis, 'fetch', async (url: string) => {
      const quote = valid(); quote.transactionRequest.to = '0x000000000000000000000000000000000000dead';
      return url.includes('relay.link') ? Response.json({}, { status: 503 }) : Response.json(quote);
    });
    await assert.rejects(quoteSwap(params), /does not match/);
  });
  await t.test('one missing route and one timeout is reported as unavailability', async t => {
    t.mock.method(globalThis, 'fetch', async (url: string) => {
      if (url.includes('relay.link')) throw new DOMException('Timeout', 'TimeoutError');
      return Response.json({ code: 1002 }, { status: 404 });
    });
    await assert.rejects(quoteSwap(params), (e: any) => e.kind === 'unavailable');
  });
});
