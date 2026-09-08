import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';

test('provider redirects are rejected without following them or forwarding credentials', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'mandate-redirect-test-'));
  process.env.NODE_ENV = 'test'; process.env.DB_PATH = join(directory,'db.json');
  t.after(() => rmSync(directory,{recursive:true,force:true}));
  const priorKey = process.env.LIFI_API_KEY;
  process.env.LIFI_API_KEY = 'test-only-lifi-key';
  t.after(() => { if (priorKey === undefined) delete process.env.LIFI_API_KEY; else process.env.LIFI_API_KEY = priorKey; });
  const { quoteSwap } = await import('./lifi.js');
  const { completeJSON } = await import('./openrouter.js');
  const fetchMock = t.mock.method(globalThis,'fetch',async (_input: unknown, init?: RequestInit) => {
    assert.equal(init?.redirect,'manual');
    if (String(_input).startsWith('https://li.quest/')) assert.equal(new Headers(init?.headers).get('x-lifi-api-key'), 'test-only-lifi-key');
    return new Response('untrusted redirect body',{status:302,headers:{location:'https://untrusted.invalid/collect'}});
  });
  await assert.rejects(quoteSwap({from:'0x0000000000000000000000000000000000000001',fromToken:'0x0000000000000000000000000000000000000000',toToken:'0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',fromAmount:1n}), /Swap quote unavailable/); // gitleaks:allow -- public Base USDC contract address, not an API token
  await assert.rejects(completeJSON({apiKey:'sk-or-test-only-not-a-real-key',model:'test/model'},'connection_check',{},z.object({ok:z.boolean()}),'test','test',100), /OpenRouter is unavailable/);
  assert.equal(fetchMock.mock.callCount(),2);
});
