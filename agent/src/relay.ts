// Same-chain swaps on Base via Relay. https://docs.relay.link/references/api/quickstart
import type { Address, Hex } from './types.js';
import { z } from 'zod';
import { NATIVE_TOKEN, type SwapQuote } from './lifi.js';
import { fetchQuote, quoteHttpError } from './swap-errors.js';

const API = 'https://api.relay.link';
// Relay publishes its own deployments: GET https://api.relay.link/chains -> chains[id=8453].contracts.
// The approval proxy receives token allowances, so it is pinned here rather than trusted from a response.
export const RELAY_APPROVAL_PROXY: Address = '0xccc88a9d1b4ed6b0eaba998850414b24f1c315be';
export const RELAY_ERC20_ROUTER: Address = '0xb92fe925dc43a0ecde6c8b1a2709c170ec4fff4f';
const routers = new Set([RELAY_APPROVAL_PROXY, RELAY_ERC20_ROUTER].map(a => a.toLowerCase()));

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const amount = z.string().regex(/^\d+$/);
const TransactionData = z.object({
  from: address, to: address, chainId: z.number().int(),
  data: z.string().regex(/^0x(?:[0-9a-fA-F]{2})+$/),
  value: z.string().regex(/^(?:\d+|0x[0-9a-fA-F]+)$/).optional(),
});
const Currency = z.object({ amount, minimumAmount: amount.optional(), currency: z.object({ address }) });
const QuoteResponse = z.object({
  steps: z.array(z.object({
    id: z.string(), kind: z.string(),
    items: z.array(z.object({ data: TransactionData })).min(1).max(1),
  })).min(1).max(4),
  details: z.object({ currencyIn: Currency, currencyOut: Currency }),
});

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
/** approve(address,uint256) calldata: selector, then the spender and the allowance. */
function approvalFrom(data: string) {
  if (!data.startsWith('0x095ea7b3') || data.length !== 138) return undefined;
  return { spender: `0x${data.slice(34, 74)}` as Address, allowance: BigInt(`0x${data.slice(74, 138)}`) };
}

export async function quoteSwap(params: {
  from: Address; // sender (our spender EOA)
  fromToken: Address;
  toToken: Address;
  fromAmount: bigint;
  slippage?: number; // 0.01 = 1%
}): Promise<SwapQuote> {
  // Attribution requires authentication: a `referrer` without a key is rejected (401 UNAUTHORIZED_QUOTE).
  // Without a key the public quote still works, so the key is optional and never required to trade.
  const apiKey = process.env.RELAY_API_KEY?.trim();
  const request = (key?: string) => fetchQuote(`${API}/quote`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(key ? { 'x-api-key': key } : {}) },
    body: JSON.stringify({
      user: params.from, recipient: params.from,
      originChainId: 8453, destinationChainId: 8453,
      originCurrency: params.fromToken, destinationCurrency: params.toToken,
      amount: params.fromAmount.toString(), tradeType: 'EXACT_INPUT',
      slippageTolerance: String(Math.round((params.slippage ?? 0.01) * 10_000)), // basis points
      ...(key ? { referrer: 'mandate' } : {}),
    }),
    signal: AbortSignal.timeout(15_000), redirect: 'manual',
  });
  let res = await request(apiKey);
  if (apiKey && res.status === 401) {
    const error = await res.clone().json().catch(() => null) as { errorCode?: string } | null;
    if (error?.errorCode === 'UNAUTHORIZED_QUOTE' || error?.errorCode === 'UNAUTHORIZED') res = await request();
  }
  if (!res.ok) throw await quoteHttpError(res);
  const parsed = QuoteResponse.safeParse(await res.json());
  if (!parsed.success) throw new Error('Swap quote does not match the requested trade.');
  const { steps, details } = parsed.data;

  // Only plain transactions are executable here; a signature step means a flow this agent cannot perform.
  if (steps.some(step => step.kind !== 'transaction')) throw new Error('Swap quote does not match the requested trade.');
  if (steps.some(step => step.id !== 'approve' && step.id !== 'swap')) throw new Error('Swap quote does not match the requested trade.');
  const swapSteps = steps.filter(step => step.id === 'swap');
  const approveSteps = steps.filter(step => step.id === 'approve');
  if (swapSteps.length !== 1 || approveSteps.length > 1) throw new Error('Swap quote does not match the requested trade.');

  const tx = swapSteps[0].items[0].data;
  const native = same(params.fromToken, NATIVE_TOKEN);
  // A native swap carries exactly the quoted amount; an ERC-20 swap must carry none.
  const expectedValue = native ? params.fromAmount : 0n;
  if (tx.chainId !== 8453 || !same(tx.from, params.from) || !routers.has(tx.to.toLowerCase())
    || BigInt(tx.value ?? '0') !== expectedValue) throw new Error('Swap quote does not match the requested trade.');

  // The allowance goes to the address Relay names, and only if that address is one of its published routers.
  let approvalAddress = tx.to as Address;
  if (approveSteps.length) {
    const step = approveSteps[0].items[0].data;
    const approval = approvalFrom(step.data);
    if (native || !approval || !same(step.to, params.fromToken) || !same(step.from, params.from)
      || step.chainId !== 8453 || BigInt(step.value ?? '0') !== 0n
      || !routers.has(approval.spender.toLowerCase()) || approval.allowance < params.fromAmount) {
      throw new Error('Swap quote does not match the requested trade.');
    }
    approvalAddress = approval.spender;
  }

  const toAmount = BigInt(details.currencyOut.amount);
  const toAmountMin = BigInt(details.currencyOut.minimumAmount ?? details.currencyOut.amount);
  if (BigInt(details.currencyIn.amount) !== params.fromAmount
    || !same(details.currencyIn.currency.address, params.fromToken)
    || !same(details.currencyOut.currency.address, params.toToken)
    || toAmountMin <= 0n || toAmount < toAmountMin) throw new Error('Swap quote does not match the requested trade.');

  return {
    expiresAt: Date.now() + 45_000,
    to: tx.to as Address,
    data: tx.data as Hex,
    value: BigInt(tx.value ?? '0'),
    toAmount,
    toAmountMin,
    approvalAddress,
    tool: 'relay',
  };
}
