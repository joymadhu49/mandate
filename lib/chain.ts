import { createPublicClient, http, parseAbi, formatUnits } from 'viem';
import { base } from 'viem/chains';
import { STOCKS, USDC, SPEND_PERMISSION_MANAGER, type Address, type Stock } from './stocks';
import { directApprovalAbi } from './approval-transaction';
import { permissionTypedData, type SpendPermissionBatch } from './spendPermission';

export const publicClient = createPublicClient({
  chain: base,
  transport: http('https://mainnet.base.org', { batch: true }),
});

export async function areMandatePermissionsApproved(batch: SpendPermissionBatch) {
  const results = await Promise.all(batch.permissions.map(async permission => {
    const p = permissionTypedData(batch, permission).message;
    const args = [{ ...p, allowance: BigInt(p.allowance), salt: BigInt(p.salt) }] as const;
    const [approved, revoked] = await Promise.all([
      publicClient.readContract({ address: SPEND_PERMISSION_MANAGER, abi: directApprovalAbi, functionName: 'isApproved', args }),
      publicClient.readContract({ address: SPEND_PERMISSION_MANAGER, abi: directApprovalAbi, functionName: 'isRevoked', args }),
    ]);
    return approved && !revoked;
  }));
  return results.length > 0 && results.every(Boolean);
}

export async function findConfirmedApproval(batch: SpendPermissionBatch, fromBlock: bigint): Promise<`0x${string}` | undefined> {
  if (!batch.permissions.length) return;
  const p = permissionTypedData(batch, batch.permissions[0]).message;
  const hash = await publicClient.readContract({ address: SPEND_PERMISSION_MANAGER, abi: directApprovalAbi, functionName: 'getHash',
    args: [{ ...p, allowance: BigInt(p.allowance), salt: BigInt(p.salt) }] });
  const logs = await publicClient.getContractEvents({ address: SPEND_PERMISSION_MANAGER, abi: directApprovalAbi,
    eventName: 'SpendPermissionApproved', args: { hash }, fromBlock, toBlock: 'latest' });
  const transactionHash = logs.at(-1)?.transactionHash;
  if (!transactionHash) return;
  const receipt = await publicClient.getTransactionReceipt({ hash: transactionHash });
  if (receipt.status !== 'success' || !await areMandatePermissionsApproved(batch)) return;
  return transactionHash;
}

const feedAbi = parseAbi([
  'function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)',
]);

const erc20Abi = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
]);

// B20 extras (docs.base.org): scaled balance = raw × multiplier (shares redeemable).
const b20Abi = parseAbi([
  'function scaledBalanceOf(address) view returns (uint256)',
  'function multiplier() view returns (uint256)',
]);

export interface Quote {
  stock: Stock;
  price: number; // USD, total-return (multiplier-adjusted)
  updatedAt: number; // unix seconds
  stale: boolean; // market closed / paused: feed is holding last value
}

export async function fetchQuotes(): Promise<Quote[]> {
  const results = await publicClient.multicall({
    contracts: STOCKS.map((s) => ({
      address: s.feed,
      abi: feedAbi,
      functionName: 'latestRoundData' as const,
    })),
    allowFailure: true,
  });
  const now = Math.floor(Date.now() / 1000);
  return STOCKS.map((stock, i) => {
    const r = results[i];
    if (r.status !== 'success') {
      return { stock, price: 0, updatedAt: 0, stale: true };
    }
    const [, answer, , updatedAt] = r.result as readonly [bigint, bigint, bigint, bigint, bigint];
    const updated = Number(updatedAt);
    return {
      stock,
      price: Number(formatUnits(answer, 8)),
      updatedAt: updated,
      // Feeds heartbeat every 24h during market hours; treat >26h as frozen.
      stale: now - updated > 26 * 3600,
    };
  });
}

export interface Holding {
  stock: Stock;
  raw: bigint;
  shares: number; // multiplier-adjusted
  decimals: number;
}

export async function fetchHoldings(account: Address): Promise<{ usdc: number; holdings: Holding[]; incomplete: boolean }> {
  if (__DEV__ && account.toLowerCase() === '0x000000000000000000000000000000000000dead') return { usdc: 0, holdings: [], incomplete: false };
  const contracts = [
    { address: USDC, abi: erc20Abi, functionName: 'balanceOf' as const, args: [account] as const },
    ...STOCKS.flatMap((s) => [
      { address: s.token, abi: erc20Abi, functionName: 'balanceOf' as const, args: [account] as const },
      { address: s.token, abi: b20Abi, functionName: 'scaledBalanceOf' as const, args: [account] as const },
      { address: s.token, abi: erc20Abi, functionName: 'decimals' as const, args: undefined },
    ]),
  ];
  const res = (await publicClient.multicall({ contracts: contracts as any, allowFailure: true })) as Array<
    { status: 'success'; result: unknown } | { status: 'failure'; error: Error }
  >;
  const first = res[0];
  if (first?.status !== 'success') throw new Error('USDC balance unavailable. Pull down to retry.');
  const usdcRaw = first?.status === 'success' ? (first.result as bigint) : 0n;
  const holdings: Holding[] = [];
  let incomplete = false;
  STOCKS.forEach((stock, i) => {
    const b = res[1 + i * 3];
    const sb = res[2 + i * 3];
    const d = res[3 + i * 3];
    if (b?.status !== 'success' || (b.result !== 0n && (sb?.status !== 'success' || d?.status !== 'success'))) { incomplete = true; return; }
    const decimals = d?.status === 'success' ? Number(d.result) : 18;
    const raw = b?.status === 'success' ? (b.result as bigint) : 0n;
    const scaled = sb?.status === 'success' ? (sb.result as bigint) : raw;
    if (raw > 0n) {
      holdings.push({ stock, raw, decimals, shares: Number(formatUnits(scaled, decimals)) });
    }
  });
  return { usdc: Number(formatUnits(usdcRaw, 6)), holdings, incomplete };
}

export async function fetchEthBalance(account: Address): Promise<number> {
  if (__DEV__ && account.toLowerCase() === '0x000000000000000000000000000000000000dead') return 0;
  return Number(formatUnits(await publicClient.getBalance({ address: account }), 18));
}

export const shortAddr = (a?: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '');
