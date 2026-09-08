import {
  createPublicClient,
  createWalletClient,
  http,
  fallback,
  parseAbi,
  formatUnits,
  encodeFunctionData,
  keccak256,
  concatHex,
  type Hex,
} from 'viem';
import { privateKeyToAccount, generatePrivateKey, type PrivateKeyAccount } from 'viem/accounts';
import { base } from 'viem/chains';
import { config } from './config.js';
import { flushPersistence, cloudRuntime } from './runtime.js';
import type { Address, SpendPermissionBatch, PermissionDetails, TransactionStep } from './types.js';

export const CHAIN_ID = 8453;
export const USDC: Address = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
export const SPEND_PERMISSION_MANAGER: Address = '0xf85210B21cC50302F477BA56686d2019dC9b67Ad';

export interface Stock { symbol: string; name: string; token: Address; feed: Address }
export const STOCKS: Stock[] = [
  { symbol: 'AAPLc', name: 'Apple', token: '0xb200000000000000000000C2e324d24d7eEcd1fb', feed: '0x787f13dEa48Db0897CbCDD985de77809D837F988' },
  { symbol: 'AMZNc', name: 'Amazon', token: '0xb200000000000000000000d9192b6B456483C2E8', feed: '0x06A8E4b3aBB3B7543d8396FB2B763d22820cB295' },
  { symbol: 'COINc', name: 'Coinbase', token: '0xb200000000000000000000c85a31389D71F3ecfb', feed: '0x408e44f504A7371a345F03a73dDC96A4b48e8aa7' },
  { symbol: 'CRCLc', name: 'Circle', token: '0xB20000000000000000000019f6E7C675b73C2e4D', feed: '0x0231cF2635D1E17bB5c2462cc7504Ba1fBd61f33' },
  { symbol: 'GOOGLc', name: 'Alphabet', token: '0xb2000000000000000000002D0BA3164cc74f58B7', feed: '0x5bF49E0ffA937CE2FfF033c739aD7C634c4D34F2' },
  { symbol: 'INTCc', name: 'Intel', token: '0xB2000000000000000000004AFF16039bA04bdFBc', feed: '0xAB657C39bac0D5886250D70849e2E3E008F2EECB' },
  { symbol: 'METAc', name: 'Meta', token: '0xb2000000000000000000008bC8786B856E61707C', feed: '0x6526aE6797A76123638b863AeE4dD27Ba4E4b27D' },
  { symbol: 'MSFTc', name: 'Microsoft', token: '0xB200000000000000000000Ab99cFa739E253872B', feed: '0xeB10A6c9aa7E537aEd766C08c35Dae35B321b18c' },
  { symbol: 'MSTRc', name: 'Strategy', token: '0xb2000000000000000000004884b426556b92883d', feed: '0xB3cE282CD188b35DA0E38D8Bc7d58e33173D202a' },
  { symbol: 'NVDAc', name: 'NVIDIA', token: '0xb20000000000000000000078ee7ce2fE4908108C', feed: '0x04689a41629776563E6822F76f2e57D148d28513' },
  { symbol: 'SNDKc', name: 'SanDisk', token: '0xb200000000000000000000397293Cb8cda9a10c5', feed: '0x388b0dC46C0Fb05A74BeE0994fa5b02c6Fcca2eA' },
  { symbol: 'SPCXc', name: 'SpaceX', token: '0xb2000000000000000000007b9fcbd005511aCBd5', feed: '0x6A634B235903C4ad6376892180d6fF8612e3Fa68' },
  { symbol: 'TSLAc', name: 'Tesla', token: '0xb2000000000000000000001e800a7f5189430cD0', feed: '0xFaf869185383a24F8cb00e27BdA6b63B9905DCb4' },
];
export const stockByToken = (t: string) => STOCKS.find((s) => s.token.toLowerCase() === t.toLowerCase());

const rpcTransport = (batch = false) => config.rpcFallbackUrl
  ? fallback([http(config.rpcUrl, { batch, timeout: 8000, retryCount: 0 }), http(config.rpcFallbackUrl, { batch, timeout: 8000, retryCount: 0 })], { rank: false, retryCount: 1 })
  : http(config.rpcUrl, { batch });
export const publicClient = createPublicClient({ chain: base, transport: rpcTransport(true) });

// Spender account. In dry-run without a key we still need a deterministic address for the app to
// build permissions against, so generate one per process and persist nothing (trades are simulated).
// The root key never signs a user's trades itself: it derives one agent account per wallet, stable across
// restarts with nothing stored per user. `spender` is the root account (operator tooling, derivation root).
const rootKey = (config.privateKey || generatePrivateKey()) as Hex;
export const spender = privateKeyToAccount(rootKey);
export const walletClient = createWalletClient({ account: spender, chain: base, transport: rpcTransport() });
const agents = new Map<string, PrivateKeyAccount>();
/** The agent account that submits this wallet's trades and pays their fees. */
export function spenderFor(account: Address): PrivateKeyAccount {
  const key = account.toLowerCase();
  let agent = agents.get(key);
  if (!agent) { agent = privateKeyToAccount(keccak256(concatHex([rootKey, key as Hex]))); agents.set(key, agent); }
  return agent;
}

const feedAbi = parseAbi([
  'function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)',
]);
export const erc20Abi = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function transfer(address to, uint256 value) returns (bool)',
  'function approve(address spender, uint256 value) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
]);
export const b20Abi = parseAbi([
  'function multiplier() view returns (uint256)',
  'function WAD_PRECISION() view returns (uint256)',
  'function isAuthorized(bytes32 policyID, address account) view returns (bool)',
]);

// SpendPermissionManager (subset). Struct layouts from @base-org/account.
export const spmAbi = parseAbi([
  'struct SpendPermission { address account; address spender; address token; uint160 allowance; uint48 period; uint48 start; uint48 end; uint256 salt; bytes extraData; }',
  'struct PermissionDetails { address spender; address token; uint160 allowance; uint256 salt; bytes extraData; }',
  'struct SpendPermissionBatch { address account; uint48 period; uint48 start; uint48 end; PermissionDetails[] permissions; }',
  'struct PeriodSpend { uint48 start; uint48 end; uint160 spend; }',
  'function approveBatchWithSignature(SpendPermissionBatch spendPermissionBatch, bytes signature) returns (bool)',
  'function approveWithSignature(SpendPermission spendPermission, bytes signature) returns (bool)',
  'function spend(SpendPermission spendPermission, uint160 value)',
  'function isValid(SpendPermission spendPermission) view returns (bool)',
  'function isApproved(SpendPermission spendPermission) view returns (bool)',
  'function isRevoked(SpendPermission spendPermission) view returns (bool)',
  'function getCurrentPeriod(SpendPermission spendPermission) view returns (PeriodSpend)',
  'function revokeAsSpender(SpendPermission spendPermission)',
]);

export function permissionFromBatch(batch: SpendPermissionBatch, p: PermissionDetails) {
  return {
    account: batch.account,
    spender: p.spender,
    token: p.token,
    allowance: BigInt(p.allowance),
    period: batch.period,
    start: batch.start,
    end: batch.end,
    salt: BigInt(p.salt),
    extraData: p.extraData,
  } as const;
}

export interface Quote { token: Address; symbol: string; price: number; updatedAt: number; stale: boolean }

export async function fetchQuotes(): Promise<Quote[]> {
  const res = await publicClient.multicall({
    contracts: STOCKS.map((s) => ({ address: s.feed, abi: feedAbi, functionName: 'latestRoundData' as const })),
    allowFailure: true,
  });
  const now = Math.floor(Date.now() / 1000);
  return STOCKS.map((s, i) => {
    const r = res[i];
    if (!r || r.status !== 'success') return { token: s.token, symbol: s.symbol, price: 0, updatedAt: 0, stale: true };
    const [, answer, , updatedAt] = r.result as readonly [bigint, bigint, bigint, bigint, bigint];
    return {
      token: s.token,
      symbol: s.symbol,
      price: Number(formatUnits(answer, 8)),
      updatedAt: Number(updatedAt),
      stale: now - Number(updatedAt) > 26 * 3600,
    };
  });
}

export async function tokenDecimals(token: Address) {
  return Number(await publicClient.readContract({ address: token, abi: erc20Abi, functionName: 'decimals' }));
}

export async function balanceOf(token: Address, owner: Address) {
  return publicClient.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [owner] });
}

export async function isBatchApproved(batch: SpendPermissionBatch) {
  if (!batch.permissions.length) return false;
  const approved = await Promise.all(batch.permissions.map((p) => isPermissionApproved(batch, p)));
  return approved.every(Boolean);
}

export function isPermissionApproved(batch: SpendPermissionBatch, permission: PermissionDetails) {
  return publicClient.readContract({
    address: SPEND_PERMISSION_MANAGER, abi: spmAbi, functionName: 'isApproved',
    args: [permissionFromBatch(batch, permission)],
  });
}

export function isPermissionRevoked(batch: SpendPermissionBatch, permission: PermissionDetails) {
  return publicClient.readContract({ address: SPEND_PERMISSION_MANAGER, abi: spmAbi, functionName: 'isRevoked', args: [permissionFromBatch(batch, permission)] });
}

export async function spentThisPeriod(batch: SpendPermissionBatch): Promise<number> {
  const usdcPerm = batch.permissions.find((p) => p.token.toLowerCase() === USDC.toLowerCase());
  if (!usdcPerm) throw new Error('Missing USDC permission.');
    const ps = await publicClient.readContract({
      address: SPEND_PERMISSION_MANAGER,
      abi: spmAbi,
      functionName: 'getCurrentPeriod',
      args: [permissionFromBatch(batch, usdcPerm)],
    });
    return Number(formatUnits(ps.spend, 6));
}

// Chainlink ETH/USD on Base (8 decimals): sizes the $1 pipeline test. https://docs.chain.link/data-feeds/price-feeds/addresses?network=base
export const ETH_USD_FEED: Address = '0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70';
export async function ethUsdPrice(): Promise<{ price: number; updatedAt: number }> {
  const [, answer, , updatedAt] = await publicClient.readContract({ address: ETH_USD_FEED, abi: feedAbi, functionName: 'latestRoundData' }) as readonly [bigint, bigint, bigint, bigint, bigint];
  return { price: Number(formatUnits(answer, 8)), updatedAt: Number(updatedAt) };
}
export const ethBalance = (owner: Address) => publicClient.getBalance({ address: owner });

let transactionTail = Promise.resolve();
export async function sendTx(to: Address, data: Hex, value = 0n, record?: (hash: Hex, status: TransactionStep['status']) => void, from: PrivateKeyAccount = spender, beforeSend?: () => void) {
  if (cloudRuntime && process.env.SCHEDULER_ENABLED !== '1') throw new Error('Trading is temporarily paused for maintenance.');
  // One spender owns the nonce sequence across approvals, orders and revocations.
  const previous = transactionTail;
  let release!: () => void;
  transactionTail = new Promise<void>(resolve => { release = resolve; });
  await previous;
  try {
    beforeSend?.();
    const request = await walletClient.prepareTransactionRequest({ account: from, to, data, value });
    const signed = await walletClient.signTransaction({ ...request, account: from } as Parameters<typeof walletClient.signTransaction>[0]);
    const hash = keccak256(signed);
    // Durably record the hash BEFORE broadcasting. A crash cannot hide a submitted step.
    record?.(hash, 'prepared');
    await flushPersistence(); // Cloud storage must commit before any onchain broadcast.
    beforeSend?.(); // Recheck after nonce wait, signing and persistence awaits.
    await walletClient.sendRawTransaction({ serializedTransaction: signed });
    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 });
    if (receipt.status !== 'success') { record?.(hash, 'failed'); throw new Error('Transaction reverted.'); }
    record?.(hash, 'confirmed');
    return hash;
  } finally { release(); }
}

export const encode = encodeFunctionData;
