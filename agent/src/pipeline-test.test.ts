import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { keccak256, parseEther, verifyMessage } from 'viem';

test('pipeline test plans honestly and executes only when live, funded and confirmed', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'mandate-pipeline-test-'));
  process.env.DB_PATH = join(directory, 'db.json'); process.env.NODE_ENV = 'test';
  delete process.env.DRY_RUN; delete process.env.LOCK_MODE;
  process.env.AGENT_PRIVATE_KEY = generatePrivateKey(); process.env.OPENROUTER_API_KEY = '';
  const { app } = await import('./app.js');
  const { config } = await import('./config.js');
  const { db } = await import('./db.js');
  const { publicClient, walletClient, spender, USDC, ETH_USD_FEED } = await import('./chain.js');
  const { LIFI_BASE_DIAMOND, NATIVE_TOKEN, quoteSwap } = await import('./lifi.js');
  t.after(() => rmSync(directory, { recursive: true, force: true }));

  const ethPrice = 2500;
  const usdBefore = 0n, usdAfter = 990_000n; // 0.99 USDC received
  let spenderWei = 0n;
  let swaps = 0;
  const ethWeiFor = (usd: number) => parseEther((usd / ethPrice).toFixed(18));
  // Echo the requested sender and amount, like LI.FI does; `value` can be overridden to test the validator.
  const quoteResponse = (fromAmount: bigint, value = fromAmount, from: string = spender.address) => ({
    transactionRequest: { from, to: LIFI_BASE_DIAMOND, chainId: 8453, data: '0xabcdef', value: value.toString() },
    action: { fromChainId: 8453, toChainId: 8453, fromAddress: from, toAddress: from, fromAmount: fromAmount.toString(), fromToken: { address: NATIVE_TOKEN }, toToken: { address: USDC } },
    estimate: { toAmount: '1000000', toAmountMin: '990000', approvalAddress: '0x0000000000000000000000000000000000000000' },
    tool: 'test-dex',
  });
  const echoQuote = async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    assert.ok(url.href.startsWith('https://li.quest/v1/quote?'), `unexpected request ${url.href}`);
    return Response.json(quoteResponse(BigInt(url.searchParams.get('fromAmount')!), undefined, url.searchParams.get('fromAddress')!));
  };
  t.mock.method(globalThis, 'fetch', echoQuote);
  t.mock.method(publicClient, 'verifyMessage', async (args: Parameters<typeof publicClient.verifyMessage>[0]) => verifyMessage(args));
  t.mock.method(publicClient, 'readContract', async (args: { address: string; functionName: string }) => {
    if (args.address.toLowerCase() === ETH_USD_FEED.toLowerCase()) return [1n, BigInt(ethPrice * 1e8), 0n, BigInt(Math.floor(Date.now() / 1000)), 1n];
    if (args.functionName === 'balanceOf') return swaps ? usdAfter : usdBefore;
    throw new Error(`unexpected read ${args.functionName}`);
  });
  t.mock.method(publicClient, 'getBalance', async () => spenderWei);
  t.mock.method(publicClient, 'getGasPrice', async () => 1_000_000n);
  t.mock.method(publicClient, 'estimateGas', async () => 200_000n);
  t.mock.method(walletClient, 'prepareTransactionRequest', async () => ({} as never));
  t.mock.method(walletClient, 'signTransaction', async () => '0x01' as const);
  t.mock.method(walletClient, 'sendRawTransaction', async () => { swaps++; spenderWei -= ethWeiFor(1) + 200_000_000_000n; return `0x${'1'.repeat(64)}` as const; });
  t.mock.method(publicClient, 'waitForTransactionReceipt', async () => ({ status: 'success' } as never));

  const owner = privateKeyToAccount(generatePrivateKey());
  const request = (path: string, method = 'GET', body?: object, token?: string) => app.request(path, {
    method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined,
  });
  const challenge = await (await request('/auth/challenge', 'POST', { account: owner.address })).json();
  const signature = await owner.signMessage({ message: challenge.message });
  const token = (await (await request('/auth/verify', 'POST', { nonce: challenge.nonce, signature })).json()).token as string;

  await t.test('native quotes must carry exactly the quoted value', async () => {
    const amount = ethWeiFor(1);
    const ok = await quoteSwap({ from: spender.address, fromToken: NATIVE_TOKEN, toToken: USDC, fromAmount: amount });
    assert.equal(ok.value, amount); assert.equal(ok.tool, 'test-dex');
    const bad = t.mock.method(globalThis, 'fetch', async () => Response.json(quoteResponse(amount, 0n)));
    await assert.rejects(quoteSwap({ from: spender.address, fromToken: NATIVE_TOKEN, toToken: USDC, fromAmount: amount }), /does not match/);
    bad.mock.restore();
    t.mock.method(globalThis, 'fetch', echoQuote);
  });
  await t.test('requires a session and a sane amount', async () => {
    assert.equal((await request('/test-swap?usd=1')).status, 401);
    assert.equal((await request('/test-swap?usd=50', 'GET', undefined, token)).status, 400);
    assert.equal((await request('/test-swap', 'POST', { usd: 1 }, token)).status, 400);
  });
  await t.test('simulation mode and an empty spender are reported, not executed', async () => {
    const plan = await (await request('/test-swap?usd=1', 'GET', undefined, token)).json();
    assert.equal(plan.ready, false); assert.equal(plan.live, false);
    assert.ok(plan.reasons.some((r: string) => /live mode/i.test(r)));
    assert.ok(plan.reasons.some((r: string) => /0 ETH/.test(r)));
    assert.equal(plan.quote.tool, 'test-dex'); assert.equal(plan.ethPrice, ethPrice);
    const run = await request('/test-swap', 'POST', { usd: 1, confirm: true }, token);
    assert.equal(run.status, 409); assert.equal(swaps, 0); assert.equal(db.pipelineTests.length, 0);
  });
  await t.test('wallet-signed plan is prepared for the caller and never executed by the backend', async () => {
    const plan = await (await request('/test-swap/wallet?usd=1', 'GET', undefined, token)).json();
    assert.equal(plan.account.toLowerCase(), owner.address.toLowerCase());
    assert.equal(plan.tool, 'test-dex'); assert.equal(plan.router, LIFI_BASE_DIAMOND); assert.equal(plan.tx.to, LIFI_BASE_DIAMOND);
    assert.equal(BigInt(plan.tx.value), ethWeiFor(1)); assert.equal(plan.expectedUsdc, 1); assert.equal(plan.minUsdc, 0.99);
    assert.ok(plan.expiresAt > Math.floor(Date.now() / 1000));
    assert.equal(swaps, 0); assert.equal(db.pipelineTests.length, 0);
    assert.equal((await request('/test-swap/wallet?usd=1')).status, 401);
    assert.equal((await request('/test-swap/wallet?usd=0.1', 'GET', undefined, token)).status, 400);
  });
  await t.test('executes once live and funded, and journals the result', async () => {
    config.dryRun = false; spenderWei = parseEther('0.01');
    const plan = await (await request('/test-swap?usd=1', 'GET', undefined, token)).json();
    assert.equal(plan.ready, true); assert.deepEqual(plan.reasons, []);
    assert.ok(plan.quote.gasEth > 0 && plan.quote.gasEth < 0.001);
    const result = await (await request('/test-swap', 'POST', { usd: 1, confirm: true }, token)).json();
    // sendTx records keccak256(signed tx) before broadcasting, so the hash is derived from the mocked signature.
    assert.equal(result.status, 'confirmed'); assert.equal(result.hash, keccak256('0x01'));
    assert.equal(result.usdcReceived, 0.99); assert.ok(result.ethSpent > 0); assert.equal(swaps, 1);
    assert.equal(db.pipelineTests[0].status, 'confirmed'); assert.equal(db.pipelineTests[0].account, owner.address.toLowerCase());
    config.dryRun = true;
  });
});
