// Explicit development preview only. Never used by a connected wallet or Release build.
import type { Activity, AIModel, ChatMessage, Mandate, Order, WalletSwapPlan } from './api';
import { STOCKS } from './stocks';
import { buildBatch } from './spendPermission';

export const PREVIEW_ACCOUNT = '0x000000000000000000000000000000000000dEaD' as const;
const ts = Math.floor(Date.now() / 1000);
const mandate: Mandate = { id: 'sample-mandate', account: PREVIEW_ACCOUNT, spender: PREVIEW_ACCOUNT, control: 'automatic', executionMode: 'simulation', budgetUsdc: 100, period: 'weekly', universe: [STOCKS[0].token], strategy: 'Sample strategy: build a small position while respecting the weekly budget.', risk: 'balanced', maxPositionPct: 40, takeProfitPct: 10, stopLossPct: 7, status: 'active', createdAt: ts - 86400, spentThisPeriod: 15, periodStart: ts - 4 * 86400, batch: buildBatch({ account: PREVIEW_ACCOUNT, spender: PREVIEW_ACCOUNT, budgetUsdc: 100, period: 'weekly', universe: [STOCKS[0].token], durationDays: 30 }) };
const orders: Order[] = [
  { id: 'sample-pending', account: PREVIEW_ACCOUNT, mandateId: mandate.id, action: 'buy', symbol: STOCKS[0].symbol, token: STOCKS[0].token, usd: 25, rationale: 'Sample decision: add a small position within the weekly budget and 40% position limit.', status: 'queued', createdAt: ts, executeAfter: ts + 60, updatedAt: ts, dryRun: true },
  { id: 'sample-filled', account: PREVIEW_ACCOUNT, mandateId: mandate.id, action: 'buy', symbol: STOCKS[0].symbol, token: STOCKS[0].token, usd: 15, filledUsd: 15, rationale: 'Sample decision: a measured initial allocation.', status: 'filled', createdAt: ts - 86400, executeAfter: ts - 86340, updatedAt: ts - 86330, dryRun: true },
];
const activity: Activity[] = [
  { id: 'sample-event-1', mandateId: mandate.id, kind: 'queued', symbol: STOCKS[0].symbol, amountUsd: 25, ts, rationale: 'Sample order proposed. Pending orders can be cancelled before execution.' },
  { id: 'sample-event-2', mandateId: mandate.id, kind: 'buy', symbol: STOCKS[0].symbol, amountUsd: 15, ts: ts - 86330, rationale: 'Sample trade completed (simulated). No real tokens transferred.' },
  { id: 'sample-event-3', mandateId: mandate.id, kind: 'approved', ts: ts - 86400, rationale: 'Sample mandate created with a $100 weekly budget.' },
];
const chat: ChatMessage[] = [
  { id: 'sample-chat-user', requestId: 'sample-chat', role: 'user', text: 'Sample request: Buy $10 of Apple', ts, mandateId: mandate.id },
  { id: 'sample-chat-assistant', requestId: 'sample-chat', role: 'assistant', text: 'Sample simulation proposal. This preview cannot submit orders or use real funds.', ts, mandateId: mandate.id,
    proposal: { id: 'sample-chat-proposal', mandateId: mandate.id, action: 'buy', symbol: 'AAPLc', token: STOCKS[0].token, usd: 10, estimatedShares: 0.05, price: 200, priceUpdatedAt: ts, expiresAt: ts + 300, dryRun: true, rationale: 'Sample only' } },
];
// Deterministic catalog so the AI settings form renders without a network in preview.
const aiModels: AIModel[] = [
  { id: 'google/gemini-2.5-flash', name: 'Google: Gemini 2.5 Flash', pricing: { prompt: '0.0000003', completion: '0.0000025' } },
  { id: 'openai/gpt-4.1-mini', name: 'OpenAI: GPT-4.1 Mini', pricing: { prompt: '0.0000004', completion: '0.0000016' } },
];
const LIFI_ROUTER = '0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE';
// A quote the wallet swap sheet can render and count down. The preview account has no wallet, so the sheet never signs it.
const walletSwapPlan = (): WalletSwapPlan => ({
  usd: 1, account: PREVIEW_ACCOUNT, ethPrice: 2500, ethAmount: 0.0004, expectedUsdc: 0.9995, minUsdc: 0.9895, tool: 'fly', router: LIFI_ROUTER,
  expiresAt: Math.floor(Date.now() / 1000) + 45, tx: { to: LIFI_ROUTER, data: '0x', value: '0x16e9d8a92c6e00' },
});
export function previewResponse(path: string, method = 'GET'): unknown {
  if (path === '/auth/session') return { account: PREVIEW_ACCOUNT };
  // The preview counts as verified, so its agent address is the sample account rather than the null an unauthenticated caller gets.
  if (path === '/agent') return { spender: PREVIEW_ACCOUNT, model: 'rules-only', dryRun: true, liveAvailable: true, ai: { configured: false, model: 'google/gemini-2.5-flash', source: 'none', developmentSettings: true } };
  if (path === '/orders') return orders.map(order => ({ ...order }));
  if (path.startsWith('/activity?')) return [...activity];
  if (path.startsWith('/mandates?')) return [mandate, { ...mandate, id: 'second-preview', control: 'chat', budgetUsdc: 200 }];
  if (path === '/chat/authorization/second-preview') return { mode: 'simulation', ready: true, checkedAt: Math.floor(Date.now() / 1000), detail: 'Second sample mandate. No real permissions were checked.', permissions: [] };
  // A copy, so the cache notices when /new empties the sample conversation in place.
  if (path === '/chat' && method === 'GET') return [...chat];
  if (path === '/chat' && method === 'DELETE') { chat.length = 0; return { ok: true }; }
  if (path === `/chat/authorization/${mandate.id}`) return { mode: 'simulation', ready: true, checkedAt: Math.floor(Date.now() / 1000), detail: 'Sample simulation only. No real permissions were checked.', permissions: [] };
  if (path === '/ai/models') return aiModels.map(model => ({ ...model }));
  // Before the broader /test-swap match below, which would otherwise answer this path with the spender plan.
  if (path.startsWith('/test-swap/wallet') && method === 'GET') return walletSwapPlan();
  if (path.startsWith('/orders/') && path.endsWith('/cancel') && method === 'POST') {
    const order = orders.find(o => `/orders/${o.id}/cancel` === path);
    if (!order || order.status !== 'queued') throw new Error('This sample order is no longer pending.');
    order.status = 'cancelled'; order.updatedAt = Math.floor(Date.now() / 1000);
    activity.unshift({ id: 'sample-cancel', mandateId: mandate.id, kind: 'cancelled', symbol: order.symbol, ts: order.updatedAt, rationale: 'Sample pending order cancelled. No backend request or transaction was sent.' });
    return { ...order };
  }
  // Every other write, including /mode, /ai/settings and /ai/draft, stays on the device.
  if (method !== 'GET') throw new Error('Connect a real wallet to use this action. Preview data stays on this device.');
  return undefined;
}
