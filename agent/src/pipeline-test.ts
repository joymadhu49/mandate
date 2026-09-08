// "Test the live pipeline": the spender swaps about $1 of its own ETH for USDC on Base through the
// same quote, signing, broadcast and receipt path a real trade uses. No user funds or permissions
// are involved; the USDC stays with the spender. Results are journaled for later review.
import { formatEther, formatUnits, parseEther } from 'viem';
import type { PrivateKeyAccount } from 'viem/accounts';
import { config } from './config.js';
import { db, save, uid } from './db.js';
import { USDC, balanceOf, ethBalance, ethUsdPrice, publicClient, sendTx, spenderFor } from './chain.js';
import { NATIVE_TOKEN, quoteSwap, type SwapQuote } from './lifi.js';
import type { Address, Hex } from './types.js';

export const PIPELINE_TEST_MIN_USD = 0.5;
export const PIPELINE_TEST_MAX_USD = 5;
// Base gas is cheap, but the L1 data fee is charged on top of what estimateGas covers.
const L1_FEE_ALLOWANCE = parseEther('0.0001');
const FALLBACK_GAS = 400_000n;

export class PipelineError extends Error {
  constructor(message: string, public status: 400 | 409 | 500 = 409) { super(message); }
}

export interface PipelinePlan {
  usd: number; ready: boolean; reasons: string[]; live: boolean; spender: Address; spenderEth: number; ethPrice: number; ethAmount: number;
  quote?: { tool: string; router: Address; expectedUsdc: number; minUsdc: number; gasEth: number };
}
export interface PipelineResult {
  id: string; hash: Hex; status: 'confirmed'; usdcReceived: number; ethSpent: number; tool: string; ts: number;
}
export interface PipelineJournalEntry {
  id: string; account: Address; ts: number; usd: number; status: 'prepared' | 'confirmed' | 'failed'; hash?: Hex; tool?: string;
  usdcReceived?: number; ethSpent?: number; error?: string;
}

const now = () => Math.floor(Date.now() / 1000);
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

function assertAmount(usd: number) {
  if (!Number.isFinite(usd) || usd < PIPELINE_TEST_MIN_USD || usd > PIPELINE_TEST_MAX_USD) {
    throw new PipelineError(`Choose an amount between $${PIPELINE_TEST_MIN_USD} and $${PIPELINE_TEST_MAX_USD}.`, 400);
  }
}

async function gasCost(agent: PrivateKeyAccount, quote: SwapQuote): Promise<bigint> {
  const price = await publicClient.getGasPrice();
  let gas = FALLBACK_GAS;
  try { gas = await publicClient.estimateGas({ account: agent, to: quote.to, data: quote.data, value: quote.value }); }
  catch { /* An unfunded spender cannot estimate; the fallback keeps the readiness check honest. */ }
  return gas * price + L1_FEE_ALLOWANCE;
}

type Sized = { plan: PipelinePlan; quote?: SwapQuote; ethWei: bigint; gasWei: bigint };

async function size(account: Address, usd: number): Promise<Sized> {
  assertAmount(usd);
  const agent = spenderFor(account);
  const reasons: string[] = [];
  const live = !config.dryRun;
  if (!live) reasons.push('Switch to live mode first.');
  if (!config.hasSpenderKey) reasons.push('The backend has no persistent spender key.');
  const [{ price }, balance] = await Promise.all([ethUsdPrice(), ethBalance(agent.address)]);
  if (!(price > 0)) throw new PipelineError('The ETH price feed is unavailable.', 500);
  const ethWei = parseEther((usd / price).toFixed(18));
  let quote: SwapQuote | undefined;
  let gasWei = 0n;
  try {
    quote = await quoteSwap({ from: agent.address, fromToken: NATIVE_TOKEN, toToken: USDC, fromAmount: ethWei });
    gasWei = await gasCost(agent, quote);
  } catch (error) {
    reasons.push(`Swap quote unavailable: ${(error as Error).message}`);
  }
  const needed = ethWei + gasWei;
  if (balance < needed) {
    reasons.push(balance === 0n
      ? `Your agent account has 0 ETH; send about 0.005 ETH on Base to ${agent.address}.`
      : `Your agent account needs about ${formatEther(needed)} ETH but holds ${formatEther(balance)}; top it up at ${short(agent.address)}.`);
  }
  const plan: PipelinePlan = {
    usd, ready: reasons.length === 0, reasons, live, spender: agent.address, spenderEth: Number(formatEther(balance)),
    ethPrice: price, ethAmount: Number(formatEther(ethWei)),
    quote: quote ? {
      tool: quote.tool, router: quote.to, expectedUsdc: Number(formatUnits(quote.toAmount, 6)), minUsdc: Number(formatUnits(quote.toAmountMin, 6)),
      gasEth: Number(formatEther(gasWei)),
    } : undefined,
  };
  return { plan, quote, ethWei, gasWei };
}

export async function planPipelineTest(account: Address, usd: number): Promise<PipelinePlan> {
  return (await size(account, usd)).plan;
}

/** A swap the user's own wallet signs: same route validation, but the wallet is the sender and pays gas. Nothing is executed here. */
export interface WalletSwapPlan {
  usd: number; account: Address; ethPrice: number; ethAmount: number; expectedUsdc: number; minUsdc: number; tool: string; router: Address; expiresAt: number;
  tx: { to: Address; data: Hex; value: Hex };
}

export async function planWalletSwap(account: Address, usd: number): Promise<WalletSwapPlan> {
  assertAmount(usd);
  const { price } = await ethUsdPrice();
  if (!(price > 0)) throw new PipelineError('The ETH price feed is unavailable.', 500);
  const ethWei = parseEther((usd / price).toFixed(18));
  let quote: SwapQuote;
  try { quote = await quoteSwap({ from: account, fromToken: NATIVE_TOKEN, toToken: USDC, fromAmount: ethWei }); }
  catch (error) { throw new PipelineError(`Swap quote unavailable: ${(error as Error).message}`, 500); }
  return {
    usd, account, ethPrice: price, ethAmount: Number(formatEther(ethWei)),
    expectedUsdc: Number(formatUnits(quote.toAmount, 6)), minUsdc: Number(formatUnits(quote.toAmountMin, 6)), tool: quote.tool, router: quote.to,
    expiresAt: Math.floor(quote.expiresAt / 1000),
    tx: { to: quote.to, data: quote.data, value: `0x${quote.value.toString(16)}` as Hex },
  };
}

let running = false;

export async function runPipelineTest(account: Address, usd: number): Promise<PipelineResult> {
  if (running) throw new PipelineError('A pipeline test is already running.');
  running = true;
  try {
    const agent = spenderFor(account);
    const { plan, quote } = await size(account, usd);
    if (!plan.ready || !quote) throw new PipelineError(plan.reasons.join(' '));
    const entry: PipelineJournalEntry = { id: uid(), account, ts: now(), usd, status: 'prepared', tool: quote.tool };
    db.pipelineTests.unshift(entry); save();
    const [usdcBefore, ethBefore] = await Promise.all([balanceOf(USDC, agent.address), ethBalance(agent.address)]);
    try {
      const hash = await sendTx(quote.to, quote.data, quote.value, (h, status) => { entry.hash = h; entry.status = status; save(); }, agent);
      const [usdcAfter, ethAfter] = await Promise.all([balanceOf(USDC, agent.address), ethBalance(agent.address)]);
      entry.usdcReceived = Number(formatUnits(usdcAfter - usdcBefore, 6));
      entry.ethSpent = Number(formatEther(ethBefore - ethAfter));
      entry.status = 'confirmed'; save();
      console.log(`pipeline test ${entry.id}: ${hash} received ${entry.usdcReceived} USDC for ${entry.ethSpent} ETH via ${quote.tool}`);
      return { id: entry.id, hash, status: 'confirmed', usdcReceived: entry.usdcReceived, ethSpent: entry.ethSpent, tool: quote.tool, ts: entry.ts };
    } catch (error) {
      entry.status = 'failed'; entry.error = (error as Error).message; save();
      throw new PipelineError(`The test swap failed: ${(error as Error).message}${entry.hash ? ` Transaction ${entry.hash}.` : ''}`, 500);
    }
  } finally { running = false; }
}
