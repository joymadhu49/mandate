import { formatUnits, parseUnits } from 'viem';
import { config } from './config.js';
import { eligibility } from './eligibility.js';
import type { PrivateKeyAccount } from 'viem/accounts';
import { db, log, positionsFor, save, uid } from './db.js';
import {
  USDC,
  SPEND_PERMISSION_MANAGER,
  erc20Abi,
  spmAbi,
  encode,
  fetchQuotes,
  isBatchApproved,
  isPermissionApproved,
  isPermissionRevoked,
  permissionFromBatch,
  publicClient,
  sendTx,
  spenderFor,
  spentThisPeriod,
  stockByToken,
  tokenDecimals,
  type Quote,
} from './chain.js';
import { quoteSwap, type SwapQuote } from './lifi.js';
import { decide, riskExit, type MarketView } from './brain.js';
import type { Mandate, PermissionDetails, Position, Order, TransactionStep } from './types.js';
import { approvalRequests } from './permissions.js';

const now = () => Math.floor(Date.now() / 1000);
const running = new Set<string>();
/** Ask the owner for in a top-up sentence; matches TOP_UP_ETH in the app. */
const TOP_UP_ETH = 0.003;
/** An activation failure the owner can act on. Its message is shown as the activity rationale; `cause` goes to the operator log. */
export class ActivationError extends Error {
  constructor(message: string, readonly cause?: unknown) { super(message); }
}
const shortAddress = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const noFeesMessage = (m: Mandate) => `Agent account has no ETH for fees. Send ${TOP_UP_ETH} ETH on Base to ${shortAddress(spenderFor(m.account).address)}, then tap Retry activation.`;
// A sender with nothing for gas fails gas estimation; Base's node words that as "gas required exceeds allowance (0)",
// other nodes as "insufficient funds". Neither is a rejected signature, which is what a bare "reverted" would suggest.
const NO_FEES = /insufficient funds|exceeds allowance \(|exceeds the balance/i;
function activationFailure(m: Mandate, error: unknown): ActivationError {
  const message = error instanceof Error ? error.message : String(error);
  if (NO_FEES.test(message)) return new ActivationError(noFeesMessage(m), error);
  if (/revert|invalid signature/i.test(message)) {
    return new ActivationError('Base rejected the permission signature. Revoke this mandate and create a new one.', error);
  }
  return new ActivationError('Could not reach Base. Check the backend connection, then tap Retry activation.', error);
}
// A raw cause can carry RPC or router detail, so it is logged rather than shown. Name the causes an owner
// can act on; anything else keeps the generic wording.
const NO_ROUTE = /swap quote unavailable|swap provider is busy|swap quote does not match/i;
function orderFailure(m: Mandate, order: Order, error: unknown): string {
  if (order.transactions?.length) return 'Execution did not finish. Check the recorded transaction steps before attempting another trade.';
  const message = error instanceof Error ? error.message : String(error);
  if (NO_ROUTE.test(message)) return `No swap route is available for ${order.symbol} right now. No funds moved; try another stock or try again later.`;
  if (NO_FEES.test(message)) return noFeesMessage(m);
  return 'Order checks did not pass. No funds moved; the mandate will evaluate again.';
}
/** Refuse to prepare a registration the agent account cannot pay for, so the owner gets the funding message rather than a node error. */
async function assertFees(m: Mandate) {
  let balance: bigint;
  try { balance = await publicClient.getBalance({ address: spenderFor(m.account).address }); }
  catch (error) { throw new ActivationError('Could not reach Base. Check the backend connection, then tap Retry activation.', error); }
  if (balance === 0n) throw new ActivationError(noFeesMessage(m));
}
export async function withMandateLock<T>(id: string, operation: () => Promise<T>): Promise<T> {
  if (running.has(id)) throw new Error('This mandate is busy. Try again after the current operation finishes.');
  running.add(id);
  try { return await operation(); } finally { running.delete(id); }
}
const mode = () => config.dryRun ? 'simulation' as const : 'live' as const;
export const modeMatches = (m: Mandate) => m.executionMode === mode() || (config.dryRun && m.executionMode === undefined);
function recorder(owner: Mandate | Order, name: string) {
  return (hash: `0x${string}`, status: TransactionStep['status']) => {
    owner.transactions ??= [];
    const existing = owner.transactions.find(step => step.hash === hash);
    if (existing) { existing.status = status; existing.updatedAt = now(); }
    else owner.transactions.push({ name, hash, status, updatedAt: now() });
    save();
  };
}

// ---------- market view ----------
function recordPrices(quotes: Quote[]) {
  const prices: Record<string, number> = {};
  for (const q of quotes) if (Number.isFinite(q.price) && q.price > 0 && !q.stale) prices[q.token.toLowerCase()] = q.price;
  db.prices.push({ ts: now(), prices });
  // keep ~7 days at 30-min cadence
  if (db.prices.length > 400) db.prices.splice(0, db.prices.length - 400);
  save();
}

function changeVs(quotes: Quote[], ts: number): Record<string, number | null> {
  // closest recorded point at or before ts
  const ref = [...db.prices].reverse().find((p) => p.ts <= ts) ?? db.prices[0];
  const out: Record<string, number | null> = {};
  for (const q of quotes) {
    const prev = ref?.prices[q.token.toLowerCase()];
    out[q.token] = prev && q.price ? ((q.price - prev) / prev) * 100 : null;
  }
  return out;
}

async function marketView(lastRunAt?: number): Promise<MarketView> {
  const quotes = await fetchQuotes();
  const change24h = changeVs(quotes, now() - 86400);
  const changeSinceLastRun = changeVs(quotes, lastRunAt ?? now() - 1800);
  recordPrices(quotes);
  const marketOpen = quotes.some((q) => !q.stale && now() - q.updatedAt < 2 * 3600);
  return { quotes, change24h, changeSinceLastRun, marketOpen };
}

// ---------- period accounting ----------
function periodBounds(m: Mandate) {
  const p = m.batch.period;
  const idx = Math.floor((now() - m.batch.start) / p);
  return { start: m.batch.start + idx * p, end: m.batch.start + (idx + 1) * p };
}

export async function remainingBudget(m: Mandate) {
  const { start } = periodBounds(m);
  if (m.periodStart !== start) {
    m.periodStart = start;
    m.spentThisPeriod = 0;
  }
  if (!config.dryRun) {
    const onchain = await spentThisPeriod(m.batch);
    m.spentThisPeriod = Math.max(m.spentThisPeriod ?? 0, onchain);
  }
  save();
  return Math.max(0, m.budgetUsdc - (m.spentThisPeriod ?? 0));
}

// ---------- onchain steps ----------
async function ensureApproved(m: Mandate) {
  if (config.dryRun) {
    if (m.status === 'pending') {
      m.status = 'active';
      save();
      log({ mandateId: m.id, account: m.account, kind: 'approved', rationale: 'Simulation ready. No spending permission registered and no real funds used.' });
    }
    return;
  }
  if (await isBatchApproved(m.batch)) {
    if (m.status === 'pending') m.status = 'active';
    return;
  }
  for (const request of approvalRequests(m)) {
    if (request.permission && await isPermissionApproved(m.batch, request.permission)) continue;
    await assertFees(m);
    try {
      m.approvalTx = await sendTx(SPEND_PERMISSION_MANAGER, request.data, 0n, recorder(m, 'permission-approval'), spenderFor(m.account), () => eligibility.assert(m.account));
    } catch (error) { throw activationFailure(m, error); }
    save(); // Preserve partial registration so a retry can skip completed approvals.
  }
  m.status = 'active';
  save();
  log({ mandateId: m.id, account: m.account, kind: 'approved', rationale: 'Spending permissions registered on Base.', txHash: m.approvalTx });
}

/**
 * Registers one owner-signed permission on Base, for a sell permission a chat mandate gains after creation.
 * An already approved permission is left alone; a revoked one is refused rather than re-registered.
 */
export async function registerPermission(m: Mandate, permission: PermissionDetails): Promise<{ hash?: `0x${string}` }> {
  eligibility.assert(m.account);
  return withMandateLock(m.id, async () => {
    if (await isPermissionApproved(m.batch, permission)) return {};
    if (await isPermissionRevoked(m.batch, permission)) throw new Error('This permission was revoked in Base Account. Create a new mandate.');
    await assertFees(m);
    const [request] = approvalRequests({ batch: { ...m.batch, permissions: [permission] } });
    const hash = await sendTx(SPEND_PERMISSION_MANAGER, request.data, 0n, recorder(m, 'permission-approval'), spenderFor(m.account), () => eligibility.assert(m.account));
    return { hash };
  });
}

async function pullFromUser(m: Mandate, token: `0x${string}`, amount: bigint, order: Order) {
  const p = m.batch.permissions.find((x) => x.token.toLowerCase() === token.toLowerCase());
  if (!p) throw new Error(`No permission for token ${token}`);
  const data = encode({ abi: spmAbi, functionName: 'spend', args: [permissionFromBatch(m.batch, p), amount] });
  return sendTx(SPEND_PERMISSION_MANAGER, data, 0n, recorder(order, 'pull'), spenderFor(m.account), () => eligibility.assert(m.account));
}

async function swap(fromToken: `0x${string}`, toToken: `0x${string}`, amount: bigint, q: SwapQuote, order: Order, from: PrivateKeyAccount) {
  if (Date.now() >= q.expiresAt) throw new Error('Swap quote expired. Reconciliation is required.');
  const allowance = await publicClient.readContract({ address: fromToken, abi: erc20Abi, functionName: 'allowance', args: [from.address, q.approvalAddress] });
  if (allowance < amount) {
    await sendTx(fromToken, encode({ abi: erc20Abi, functionName: 'approve', args: [q.approvalAddress, amount] }), 0n, recorder(order, 'swap-approval'), from, () => eligibility.assert(order.account));
  }
  const before = await publicClient.readContract({ address: toToken, abi: erc20Abi, functionName: 'balanceOf', args: [from.address] });
  if (Date.now() >= q.expiresAt) throw new Error('Swap quote expired. Reconciliation is required.');
  const hash = await sendTx(q.to, q.data, q.value, recorder(order, 'swap'), from, () => eligibility.assert(order.account));
  const after = await publicClient.readContract({ address: toToken, abi: erc20Abi, functionName: 'balanceOf', args: [from.address] });
  const received = after - before;
  if (received <= 0n || received < q.toAmountMin) throw new Error('Swap output is below the minimum.');
  return { hash, received, tool: q.tool };
}

async function sendToUser(m: Mandate, token: `0x${string}`, amount: bigint, order: Order) {
  const before = await publicClient.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [m.account] });
  const hash = await sendTx(token, encode({ abi: erc20Abi, functionName: 'transfer', args: [m.account, amount] }), 0n, recorder(order, 'delivery'), spenderFor(m.account));
  const after = await publicClient.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [m.account] });
  if (after - before < amount) throw new Error('Token delivery could not be verified.');
  return hash;
}

async function preflight(m: Mandate, fromToken: `0x${string}`, toToken: `0x${string}`, amount: bigint) {
  const permission = m.batch.permissions.find(p => p.token.toLowerCase() === fromToken.toLowerCase());
  if (!permission) throw new Error('Missing spend permission.');
  const [valid, balance, quote] = await Promise.all([
    publicClient.readContract({ address: SPEND_PERMISSION_MANAGER, abi: spmAbi, functionName: 'isValid', args: [permissionFromBatch(m.batch, permission)] }),
    publicClient.readContract({ address: fromToken, abi: erc20Abi, functionName: 'balanceOf', args: [m.account] }),
    quoteSwap({ from: spenderFor(m.account).address, fromToken, toToken, fromAmount: amount }),
  ]);
  if (!valid || balance < amount) throw new Error('Permission or balance no longer permits this order.');
  return quote;
}

// ---------- execution ----------
async function executeBuy(m: Mandate, q: Quote, usd: number, rationale: string, order: Order) {
  const usdcAmount = parseUnits(usd.toFixed(6), 6);
  const dec = await tokenDecimals(q.token);
  let txHash: string | undefined;
  let receivedRaw: bigint;

  if (config.dryRun) {
    receivedRaw = parseUnits((usd / q.price).toFixed(dec), dec);
  } else {
    const route = await preflight(m, USDC, q.token, usdcAmount);
    await pullFromUser(m, USDC, usdcAmount, order);
    const s = await swap(USDC, q.token, usdcAmount, route, order, spenderFor(m.account));
    receivedRaw = s.received;
    await sendToUser(m, q.token, receivedRaw, order);
    txHash = s.hash;
  }
  const shares = Number(formatUnits(receivedRaw, dec));
  const pos = db.positions.find((p) => p.mandateId === m.id && p.token.toLowerCase() === q.token.toLowerCase());
  if (pos) {
    pos.executionMode = mode();
    pos.raw = (BigInt(pos.raw) + receivedRaw).toString();
    pos.shares = Number(formatUnits(BigInt(pos.raw), dec));
    pos.costUsd += usd;
  } else {
    db.positions.push({ mandateId: m.id, executionMode: mode(), token: q.token, symbol: q.symbol, shares, raw: receivedRaw.toString(), costUsd: usd });
  }
  m.spentThisPeriod = (m.spentThisPeriod ?? 0) + usd;
  save();
  return log({ mandateId: m.id, account: m.account, kind: 'buy', symbol: q.symbol, token: q.token, amountUsd: usd, qty: shares, price: q.price, rationale: `${rationale}${config.dryRun ? ' (simulated)' : ''}`, txHash });
}

async function executeSell(m: Mandate, q: Quote, pos: Position, fraction: number, rationale: string, order: Order) {
  const dec = await tokenDecimals(q.token);
  const rawToSell = (BigInt(pos.raw) * BigInt(Math.floor(fraction * 10_000))) / 10_000n;
  if (rawToSell <= 0n) return;
  const shares = Number(formatUnits(rawToSell, dec));
  let usd = shares * q.price;
  let txHash: string | undefined;

  if (!config.dryRun) {
    // The user's account must still hold the tokens; the mandate's sell permission lets us pull them.
    const route = await preflight(m, q.token, USDC, rawToSell);
    await pullFromUser(m, q.token, rawToSell, order);
    const s = await swap(q.token, USDC, rawToSell, route, order, spenderFor(m.account));
    usd = Number(formatUnits(s.received, 6));
    await sendToUser(m, USDC, s.received, order);
    txHash = s.hash;
  }
  const costShare = pos.costUsd * (shares / pos.shares);
  pos.raw = (BigInt(pos.raw) - rawToSell).toString();
  pos.shares = Number(formatUnits(BigInt(pos.raw), dec));
  pos.costUsd = Math.max(0, pos.costUsd - costShare);
  save();
  return log({ mandateId: m.id, account: m.account, kind: 'sell', symbol: q.symbol, token: q.token, amountUsd: usd, qty: shares, price: q.price, rationale: `${rationale}${config.dryRun ? ' (simulated)' : ''}`, txHash });
}

// ---------- one cycle for one mandate ----------
export async function runMandate(m: Mandate) {
  if (running.has(m.id) || db.orders.some((o) => o.mandateId === m.id && ['queued', 'executing'].includes(o.status))) return;
  if (m.status === 'revoked' || m.status === 'error') return;
  // Mode is switchable at runtime: a mandate from the other mode is dormant, not broken.
  if (!modeMatches(m)) return;
  if (!config.dryRun && !eligibility.status(m.account).allowed) return;
  if (now() < m.batch.start) return;
  if (now() > m.batch.end) {
    m.status = 'expired';
    save();
    return;
  }
  running.add(m.id);
  try {
    await ensureApproved(m);
    if (m.control === 'chat') return; // Only explicit chat confirmations queue trades.
    const mv = await marketView(m.lastRunAt);
    const positions = positionsFor(m.id);
    const remaining = await remainingBudget(m);
    const decision = await decide(m, positions, mv, remaining);

    let budgetLeft = remaining;
    const maxPos = (m.budgetUsdc * m.maxPositionPct) / 100;
    let acted = 0;

    for (const a of decision.actions) {
      const q = mv.quotes.find((x) => x.symbol.toLowerCase() === a.symbol.toLowerCase());
      if (!q || !q.price) continue;
      // Guardrail: universe
      if (!m.universe.some((t) => t.toLowerCase() === q.token.toLowerCase())) {
        log({ mandateId: m.id, account: m.account, kind: 'hold', symbol: q.symbol, rationale: `${q.symbol} is not in this mandate. ${a.action === 'buy' ? 'Buy' : 'Sell'} blocked.` });
        continue;
      }
      const pos = positions.find((p) => p.token.toLowerCase() === q.token.toLowerCase());
      if (a.action === 'buy') {
        const held = pos ? pos.shares * q.price : 0;
        const usd = Math.min(a.usd ?? 0, budgetLeft, Math.max(0, maxPos - held));
        if (usd < 1) {
          log({ mandateId: m.id, account: m.account, kind: 'hold', symbol: q.symbol, rationale: `Skipped ${q.symbol}: limits leave $${usd.toFixed(2)} of the $${(a.usd ?? 0).toFixed(0)} wanted.` });
          continue;
        }
        queueOrder(m, q, 'buy', a.rationale, Math.floor(usd * 100) / 100);
        budgetLeft -= usd;
        acted++;
      } else if (a.action === 'sell' && pos) {
        const fraction = Math.min(1, Math.max(0, a.fraction ?? 1));
        queueOrder(m, q, 'sell', a.rationale, undefined, fraction, riskExit(m, pos, q)?.reason);
        acted++;
      }
    }
    if (acted === 0) {
      log({ mandateId: m.id, account: m.account, kind: 'hold', rationale: decision.summary || 'No action this cycle.' });
    }
    m.lastRunAt = now();
    save();
  } catch (e: any) {
    if (m.transactions?.some(step => step.status === 'prepared')) m.status = 'error';
    // Operator log only; the owner sees the rationale below. Never echo raw RPC errors to the app.
    const detail = e instanceof ActivationError && e.cause instanceof Error ? e.cause : e;
    console.error('mandate_run_failed', detail instanceof Error ? detail.message.split('\n')[0].slice(0, 160) : 'unknown');
    log({ mandateId: m.id, account: m.account, kind: 'error', rationale: e instanceof ActivationError ? e.message
      : 'Evaluation failed. Check the backend connection and AI settings, then try again.' });
    m.lastRunAt = now();
    save();
  } finally {
    running.delete(m.id);
  }
}

function queueOrder(m: Mandate, quote: Quote, action: Order['action'], rationale: string, usd?: number, fraction?: number, riskExit?: Order['riskExit']) {
  const ts = now();
  db.orders.unshift({ id: uid(), account: m.account, mandateId: m.id, action, symbol: quote.symbol, token: quote.token, usd, fraction, riskExit, rationale, status: 'queued', createdAt: ts, executeAfter: ts + 60, updatedAt: ts, dryRun: config.dryRun });
  save();
  log({ mandateId: m.id, account: m.account, kind: 'queued', symbol: quote.symbol, amountUsd: usd, rationale: 'Queued. Cancel within 60 seconds.' });
}

export async function executeOrder(order: Order) {
  if (order.status !== 'queued' || order.executeAfter > now() || running.has(order.mandateId)) return;
  const m = db.mandates.find((item) => item.id === order.mandateId);
  if (!m || !['active', 'pending'].includes(m.status) || now() >= m.batch.end || now() < m.batch.start) {
    order.status = 'cancelled'; order.updatedAt = now(); save(); return;
  }
  if (order.dryRun !== config.dryRun || !modeMatches(m)) {
    order.status = 'cancelled'; order.error = 'The backend switched execution mode before this order ran. Ask for a new proposal.';
    order.updatedAt = now(); save(); return;
  }
  if (!order.dryRun && !eligibility.status(m.account).allowed) {
    order.status = 'cancelled'; order.error = eligibility.status(m.account).reason; order.updatedAt = now(); save(); return;
  }
  running.add(m.id);
  order.status = 'executing'; order.updatedAt = now(); save();
  try {
    const quote = (await fetchQuotes()).find((q) => q.token.toLowerCase() === order.token.toLowerCase());
    if (!quote || !Number.isFinite(quote.price) || quote.price <= 0 || quote.stale) throw new Error('A fresh market price is unavailable.');
    if (!m.universe.some((token) => token.toLowerCase() === order.token.toLowerCase())) throw new Error('The stock is outside the mandate.');
    const pos = positionsFor(m.id).find((p) => p.token.toLowerCase() === order.token.toLowerCase());
    if (pos && (pos.executionMode !== mode()) && !(config.dryRun && pos.executionMode === undefined)) throw new Error('Position execution mode does not match.');
    const exit = riskExit(m, pos, quote);
    let result;
    if (order.action === 'buy') {
      if (exit) throw new Error('A mandatory risk exit now takes priority over buying.');
      const remaining = await remainingBudget(m);
      const room = m.budgetUsdc * m.maxPositionPct / 100 - (pos?.shares ?? 0) * quote.price;
      const amount = Math.floor(Math.min(order.usd ?? 0, remaining, Math.max(0, room)) * 100) / 100;
      if (amount < 1) throw new Error('Budget or position limits no longer permit this order.');
      if (order.source === 'chat' && Math.abs(amount - (order.usd ?? 0)) > 0.001) throw new Error('The confirmed amount no longer fits the mandate.');
      result = await executeBuy(m, quote, amount, order.rationale, order);
    } else {
      if (!pos || !order.fraction || order.fraction <= 0 || order.fraction > 1) throw new Error('No eligible position is available to sell.');
      if (order.riskExit && !exit) throw new Error('The risk threshold no longer applies.');
      result = await executeSell(m, quote, pos, order.source === 'chat' ? order.fraction : exit?.fraction ?? order.fraction, order.source === 'chat' ? order.rationale : exit?.rationale ?? order.rationale, order);
    }
    if (!result) throw new Error('The order amount is too small.');
    order.status = 'filled'; order.filledUsd = result.amountUsd; order.txHash = result.txHash;
  } catch (error) {
    order.status = 'failed';
    const submitted = !!order.transactions?.length;
    console.error('order_execution_failed', error instanceof Error ? error.message.split('\n')[0].slice(0, 160) : 'unknown');
    order.error = orderFailure(m, order, error);
    if (!config.dryRun && submitted) m.status = 'error'; // Quarantine uncertain/partial trades only.
    log({ mandateId: m.id, account: m.account, kind: 'error', symbol: order.symbol, rationale: order.error });
  } finally {
    order.updatedAt = now(); running.delete(m.id); save();
  }
}

export async function revokeMandate(m: Mandate) {
  if (running.has(m.id)) throw new Error('An operation is in progress. Retry after it finishes.');
  running.add(m.id);
  try {
  if (m.status === 'revoked') return;
  // Revocation is allowed in either backend mode. Simulation mandates have nothing on-chain; a live mandate is
  // revoked on-chain only if its permissions were ever registered, otherwise the record alone ends it (the backend
  // holds the only copies of the signatures and never registers a revoked mandate).
  const registered = !!m.approvalTx || !!m.transactions?.some(step => step.name === 'permission-approval');
  if (m.executionMode === 'live' && registered) {
    if (!config.hasSpenderKey) throw new Error('The agent’s signing key is unavailable. Revoke this mandate at account.base.app.');
    for (const p of m.batch.permissions) {
      try {
        if (await isPermissionRevoked(m.batch, p)) continue;
        await sendTx(SPEND_PERMISSION_MANAGER, encode({ abi: spmAbi, functionName: 'revokeAsSpender', args: [permissionFromBatch(m.batch, p)] }), 0n, recorder(m, 'permission-revocation'), spenderFor(m.account));
        if (!await isPermissionRevoked(m.batch, p)) throw new Error('Permission remains active.');
      } catch (e) {
        console.error('permission_revoke_failed');
        m.status = 'error'; save(); throw new Error('Not all permissions were revoked. Retry or revoke in Base Account.');
      }
    }
  }
  m.status = 'revoked';
  for (const order of db.orders) if (order.mandateId === m.id && order.status === 'queued') { order.status = 'cancelled'; order.updatedAt = now(); }
  save();
  log({ mandateId: m.id, account: m.account, kind: 'revoked', rationale: 'Permissions revoked. Submitted transactions may still settle.' });
  } finally { running.delete(m.id); }
}

export function recoverInterruptedExecutions() {
  for (const m of db.mandates) {
    if (m.status === 'revoked' || m.status === 'expired') continue;
    // Only an unknown-outcome transaction needs review; a mandate from the other mode simply waits.
    if (m.transactions?.some(step => step.status === 'prepared')) m.status = 'error';
  }
  for (const order of db.orders) {
    if (order.status === 'executing') {
      order.status = 'failed'; order.error = 'Execution was interrupted by a backend restart. Review on-chain activity before trading again.'; order.updatedAt = now();
      const m = db.mandates.find((item) => item.id === order.mandateId);
      if (m && !order.dryRun) m.status = 'error';
    }
  }
  save();
}

let schedulerStarted = false;
export function startScheduler() {
  if (schedulerStarted) return;
  schedulerStarted = true;
  recoverInterruptedExecutions();
  let processing = false;
  setInterval(async () => {
    if (processing) return;
    processing = true;
    try { for (const order of [...db.orders].reverse()) await executeOrder(order); }
    catch { console.error('order_queue_failed'); }
    finally { processing = false; }
  }, 5000);
  const tick = async () => {
    for (const m of db.mandates) {
      if (m.status === 'active' || m.status === 'pending') await runMandate(m);
    }
  };
  setTimeout(tick, 5_000);
  setInterval(tick, config.intervalMin * 60_000);
}
