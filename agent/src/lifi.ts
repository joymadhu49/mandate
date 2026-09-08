// Same-chain swaps on Base via LI.FI. Hosted requests use a server-side API key.
import type { Address, Hex } from './types.js';
import { z } from 'zod';

const API = 'https://li.quest/v1';
// Reviewed Base deployments: https://github.com/lifinance/contracts/blob/main/deployments/base.json
export const LIFI_BASE_DIAMOND = '0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE';
const routers = new Set([LIFI_BASE_DIAMOND, '0x8189AFcC5B73Dc90600FeE92e5267Aff1D192884'].map(a => a.toLowerCase()));
const approvers = new Set([...routers, '0x74a55cadb12501a3707e9f3c5dfd8b563c6a5940']);
// LI.FI's address for the chain's native asset (ETH on Base). Native swaps carry the amount as tx value.
export const NATIVE_TOKEN: Address = '0x0000000000000000000000000000000000000000';
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const amount = z.string().regex(/^\d+$/);
const QuoteResponse = z.object({
  transactionRequest: z.object({ to: address, from: address, chainId: z.number().int(), data: z.string().regex(/^0x(?:[0-9a-fA-F]{2})+$/), value: z.string().regex(/^(?:\d+|0x[0-9a-fA-F]+)$/).optional() }),
  action: z.object({ fromChainId: z.number(), toChainId: z.number(), fromAddress: address, toAddress: address.optional(), fromAmount: amount, fromToken: z.object({ address }), toToken: z.object({ address }) }),
  estimate: z.object({ toAmount: amount, toAmountMin: amount, approvalAddress: address }),
  tool: z.string().optional(), toolDetails: z.object({ name: z.string() }).optional(),
});

export interface SwapQuote {
  expiresAt: number;
  to: Address;
  data: Hex;
  value: bigint;
  toAmount: bigint;
  toAmountMin: bigint;
  approvalAddress: Address;
  tool: string;
}

export async function quoteSwap(params: {
  from: Address; // sender (our spender EOA)
  fromToken: Address;
  toToken: Address;
  fromAmount: bigint;
  slippage?: number; // 0.01 = 1%
}): Promise<SwapQuote> {
  const q = new URLSearchParams({
    fromChain: '8453',
    toChain: '8453',
    fromToken: params.fromToken,
    toToken: params.toToken,
    fromAmount: params.fromAmount.toString(),
    fromAddress: params.from,
    slippage: String(params.slippage ?? 0.01),
    integrator: 'mandate',
  });
  const apiKey = process.env.LIFI_API_KEY?.trim();
  const res = await fetch(`${API}/quote?${q}`, {
    signal: AbortSignal.timeout(15_000), redirect: 'manual',
    ...(apiKey ? { headers: { 'x-lifi-api-key': apiKey } } : {}),
  });
  if (res.status === 429) throw new Error('The swap provider is busy. Please try again shortly.');
  if (!res.ok) throw new Error('Swap quote unavailable.');
  const j = QuoteResponse.parse(await res.json());
  const tx = j.transactionRequest;
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  const native = same(params.fromToken, NATIVE_TOKEN);
  // ERC-20 swaps must carry no value; a native swap must carry exactly the quoted amount and needs no approval.
  const expectedValue = native ? params.fromAmount : 0n;
  if (tx.chainId !== 8453 || j.action.fromChainId !== 8453 || j.action.toChainId !== 8453 || !same(tx.from, params.from)
    || !routers.has(tx.to.toLowerCase()) || (!native && !approvers.has(j.estimate.approvalAddress.toLowerCase()))
    || !same(j.action.fromAddress, params.from) || (j.action.toAddress && !same(j.action.toAddress, params.from))
    || !same(j.action.fromToken.address, params.fromToken) || !same(j.action.toToken.address, params.toToken)
    || BigInt(j.action.fromAmount) !== params.fromAmount || BigInt(tx.value ?? '0') !== expectedValue
    || BigInt(j.estimate.toAmountMin) <= 0n || BigInt(j.estimate.toAmount) < BigInt(j.estimate.toAmountMin)) throw new Error('Swap quote does not match the requested trade.');
  return {
    expiresAt: Date.now() + 45_000,
    to: tx.to as Address,
    data: tx.data as Hex,
    value: BigInt(tx.value ?? '0'),
    toAmount: BigInt(j.estimate.toAmount),
    toAmountMin: BigInt(j.estimate.toAmountMin),
    approvalAddress: j.estimate.approvalAddress as Address,
    tool: j.tool ?? j.toolDetails?.name ?? 'lifi',
  };
}
