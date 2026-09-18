import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.NODE_ENV = 'test';
const { quoteSwap, RELAY_APPROVAL_PROXY, RELAY_ERC20_ROUTER } = await import('./relay.js');
const { NATIVE_TOKEN } = await import('./lifi.js');

type Hex40 = `0x${string}`;
const FROM: Hex40 = '0x5ab24818564cf2e9f931ef437c9a734be374b008';
const USDC: Hex40 = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const STOCK: Hex40 = '0xb200000000000000000000C2e324d24d7eEcd1fb';
const AMOUNT = 1_000_000n;
const pad = (hex: string) => hex.replace(/^0x/, '').toLowerCase().padStart(64, '0');
const approveData = (spender: string, allowance: bigint) => `0x095ea7b3${pad(spender)}${pad(allowance.toString(16))}`;
const step = (id: string, data: Record<string, unknown>, kind = 'transaction') => ({ id, kind, items: [{ data }] });

const valid = () => ({
  steps: [
    step('approve', { from: FROM, to: USDC, chainId: 8453, value: '0', data: approveData(RELAY_APPROVAL_PROXY, AMOUNT) }),
    step('swap', { from: FROM, to: RELAY_APPROVAL_PROXY, chainId: 8453, value: '0', data: '0x1234' }),
  ],
  details: {
    currencyIn: { amount: AMOUNT.toString(), currency: { address: USDC } },
    currencyOut: { amount: '296851', minimumAmount: '293882', currency: { address: STOCK } },
  },
});

const respondWith = (body: unknown, status = 200) => {
  globalThis.fetch = (async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })) as typeof fetch;
};
const ask = (fromToken: Hex40 = USDC, toToken: Hex40 = STOCK, fromAmount = AMOUNT) =>
  quoteSwap({ from: FROM, fromToken, toToken, fromAmount });

test('Relay quotes are accepted only when they match the requested trade', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });

  await t.test('a rejected optional API key retries once without credentials or attribution', async () => {
    const key = process.env.RELAY_API_KEY;
    process.env.RELAY_API_KEY = 'invalid-test-key';
    let calls = 0;
    try {
      globalThis.fetch = (async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        const headers = new Headers(init?.headers);
        calls++;
        if (calls === 1) {
          assert.equal(headers.get('x-api-key'), 'invalid-test-key');
          assert.equal(body.referrer, 'mandate');
          return Response.json({ errorCode: 'UNAUTHORIZED_QUOTE' }, { status: 401 });
        }
        assert.equal(headers.has('x-api-key'), false);
        assert.equal(body.referrer, undefined);
        return Response.json(valid());
      }) as typeof fetch;
      assert.equal((await ask()).tool, 'relay');
      assert.equal(calls, 2);
    } finally {
      if (key === undefined) delete process.env.RELAY_API_KEY; else process.env.RELAY_API_KEY = key;
    }
  });

  await t.test('a matching quote yields the swap call and the approval target', async () => {
    respondWith(valid());
    const quote = await ask();
    assert.equal(quote.to, RELAY_APPROVAL_PROXY);
    assert.equal(quote.approvalAddress, RELAY_APPROVAL_PROXY);
    assert.equal(quote.value, 0n);
    assert.equal(quote.toAmountMin, 293882n);
    assert.equal(quote.tool, 'relay');
    assert.ok(quote.expiresAt > Date.now());
  });

  await t.test('a native swap carries the quoted value and needs no approval', async () => {
    respondWith({
      steps: [step('swap', { from: FROM, to: RELAY_ERC20_ROUTER, chainId: 8453, value: AMOUNT.toString(), data: '0xabcd' })],
      details: {
        currencyIn: { amount: AMOUNT.toString(), currency: { address: NATIVE_TOKEN } },
        currencyOut: { amount: '2456262', minimumAmount: '2431699', currency: { address: USDC } },
      },
    });
    const quote = await ask(NATIVE_TOKEN, USDC);
    assert.equal(quote.value, AMOUNT);
    assert.equal(quote.approvalAddress, RELAY_ERC20_ROUTER);
  });

  // Each of these would send funds somewhere the request never asked for.
  const tampered: [string, () => unknown][] = [
    ['an approval aimed at an address Relay does not publish', () => {
      const q = valid(); q.steps[0].items[0].data.data = approveData('0x000000000000000000000000000000000000dead', AMOUNT); return q;
    }],
    ['a swap sent to an unknown contract', () => {
      const q = valid(); q.steps[1].items[0].data.to = '0x000000000000000000000000000000000000dead'; return q;
    }],
    ['a swap billed to another sender', () => {
      const q = valid(); q.steps[1].items[0].data.from = '0x000000000000000000000000000000000000dead'; return q;
    }],
    ['an ERC-20 swap carrying value', () => {
      const q = valid(); q.steps[1].items[0].data.value = '1'; return q;
    }],
    ['a different input amount', () => { const q = valid(); q.details.currencyIn.amount = '1'; return q; }],
    ['a different output token', () => { const q = valid(); q.details.currencyOut.currency.address = USDC; return q; }],
    ['an approval smaller than the trade', () => {
      const q = valid(); q.steps[0].items[0].data.data = approveData(RELAY_APPROVAL_PROXY, AMOUNT - 1n); return q;
    }],
    ['a minimum above the quoted output', () => {
      const q = valid(); q.details.currencyOut.minimumAmount = '999999999'; return q;
    }],
    ['a step this agent cannot execute', () => {
      const q = valid(); q.steps[1].kind = 'signature'; return q;
    }],
    ['a wrong chain', () => { const q = valid(); q.steps[1].items[0].data.chainId = 1; return q; }],
  ];
  for (const [name, build] of tampered) {
    await t.test(`rejects ${name}`, async () => {
      respondWith(build());
      await assert.rejects(ask(), /does not match/);
    });
  }

  await t.test('provider outages are reported without a quote', async () => {
    respondWith({ errorCode: 'NO_SWAP_ROUTES_FOUND', message: 'no routes found' }, 400);
    await assert.rejects(ask(), /No swap route/);
    respondWith({}, 429);
    await assert.rejects(ask(), /busy/);
  });
});
