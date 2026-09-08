import type { Address } from './stocks';
import type { PeriodKey, PermissionDetails, SpendPermissionBatch } from './spendPermission';
import { sessionToken, saveSession, clearSession, invalidateSession } from './session';
import { validateBackendURL } from './backend-url';
import { usePreferences } from './preferences';

export type Risk = 'conservative' | 'balanced' | 'aggressive';

export interface AIStatus {
  configured: boolean;
  model: string;
  source: 'saved' | 'session' | 'environment' | 'none';
  developmentSettings: boolean;
}
// `spender`: the caller's own agent address, derived per wallet; null until the request carries a verified session.
// `liveAvailable`: a persistent spender key exists, so live mode can be switched on at runtime.
export interface AgentInfo { spender: Address | null; model: string; dryRun: boolean; ai: AIStatus; liveAvailable?: boolean }
export interface AIModel { id: string; name: string; pricing: { prompt: string; completion: string } }
export interface AIDraft { strategy: string; summary: string; model: string }
export interface DraftInput {
  instructions: string; budgetUsdc: number; period: PeriodKey; symbols: string[]; risk: Risk;
  maxPositionPct: number; takeProfitPct: number; stopLossPct: number;
}
export interface TransactionStep {
  name: string; status: 'prepared' | 'confirmed' | 'failed'; hash: `0x${string}`; updatedAt: number;
}

export interface Mandate {
  control?: 'chat' | 'automatic';
  executionMode?: 'simulation' | 'live';
  transactions?: TransactionStep[];
  id: string;
  account: Address;
  spender: Address;
  budgetUsdc: number;
  period: PeriodKey;
  universe: Address[];
  strategy: string;
  risk: Risk;
  maxPositionPct: number;
  takeProfitPct: number;
  stopLossPct: number;
  // Chat mandates start with the USDC permission only; each stock's sell permission is added on its first sell.
  batch: SpendPermissionBatch;
  signature?: `0x${string}`; // Legacy combined signature on older mandates.
  status: 'pending' | 'active' | 'revoked' | 'expired' | 'error';
  approvalTx?: string;
  createdAt: number;
  lastRunAt?: number;
  spentThisPeriod?: number;
  periodStart?: number; // Start of the current spending period (unix seconds), when the backend reports it.
}

export interface Activity {
  id: string;
  mandateId: string;
  ts: number;
  kind: 'buy' | 'sell' | 'hold' | 'error' | 'approved' | 'revoked' | 'queued' | 'cancelled';
  symbol?: string;
  token?: Address;
  amountUsd?: number;
  qty?: number;
  price?: number;
  rationale: string;
  txHash?: string;
}

export interface Order {
  source?: 'chat';
  transactions?: TransactionStep[];
  id: string; mandateId: string; account: Address; action: 'buy' | 'sell'; symbol: string; token: Address;
  usd?: number; fraction?: number; rationale: string; status: 'queued' | 'executing' | 'filled' | 'cancelled' | 'failed';
  createdAt: number; executeAfter: number; updatedAt: number; dryRun: boolean; error?: string; txHash?: string; filledUsd?: number;
}
/** A $usd ETH→USDC swap the user's own wallet signs and pays for. `tx` is the LI.FI router call; `expiresAt` is unix seconds. */
export interface WalletSwapPlan {
  usd: number; account: Address; ethPrice: number; ethAmount: number; expectedUsdc: number; minUsdc: number; tool: string; router: Address;
  expiresAt: number; tx: { to: Address; data: `0x${string}`; value: `0x${string}` };
}
export class APIError extends Error { constructor(message: string, public status: number) { super(message); } }

// On a physical iPhone, localhost is the phone. EXPO_PUBLIC_AGENT_API_URL bakes a default into the build (your Mac's LAN IP such as
// http://192.168.0.12:8842, or a deployed agent); Settings → Backend overrides it at runtime so one TestFlight build can reach any agent.
export const DEFAULT_BACKEND_URL: string = process.env.EXPO_PUBLIC_AGENT_API_URL ?? 'http://localhost:8842';
/** The address requests use right now: the saved override, else the build default. Read at call time, never cached. */
export function backendUrl() {
  return usePreferences.getState().backendUrl?.trim() || DEFAULT_BACKEND_URL;
}
const FULL_ADDRESS = 'Enter a full address, like https://agent.example.com or http://192.168.0.12:8842.';
/** Trims a typed address and validates it; throws the sentence the user should read. */
export function parseBackendAddress(text: string) {
  const address = text.trim().replace(/\/+$/, '');
  // Scheme and host are checked up front: React Native's URL accepts almost any string, so validateBackendURL alone cannot reject "garbage".
  if (!/^https?:\/\/[^\s/?#@]+/i.test(address)) throw new Error(FULL_ADDRESS);
  try { validateBackendURL(address); return address; }
  catch (error) {
    // validateBackendURL explains a TLS problem itself; a TypeError means the text is not a URL at all.
    if (error instanceof Error && !(error instanceof TypeError)) throw error;
    throw new Error(FULL_ADDRESS);
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  if (__DEV__) {
    const { useWallet } = await import('./wallet');
    if (useWallet.getState().address?.toLowerCase() === '0x000000000000000000000000000000000000dead') {
      const { previewResponse } = await import('./preview');
      const result = previewResponse(path, init?.method);
      if (result !== undefined) return result as T;
    }
  }
  // The override lives in preferences; wait for the one-time read so a cold start never hits the wrong backend.
  await usePreferences.getState().hydrate();
  const base = backendUrl();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 40_000);
  try {
    validateBackendURL(base);
    const privateRoute = /^\/(orders|mandates|activity|chat|ai|mode|test-swap)(\/|\?|$)/.test(path) || path === '/auth/session' || path === '/auth/logout';
    const token = privateRoute || path === '/agent' ? await sessionToken(base) : undefined;
    const res = await fetch(`${base}${path}`, {
      ...init, signal: controller.signal,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(init?.headers ?? {}) },
    });
    if (!res.ok) {
      if (res.status === 401 && privateRoute && path !== '/auth/logout') {
        await invalidateSession(base, token).catch(() => {});
      }
      const body = await res.json().catch(() => null);
      throw new APIError(typeof body?.error === 'string' ? body.error : `Agent request failed (${res.status}). Please try again.`, res.status);
    }
    return (await res.json()) as T;
  } catch (error) {
    if (controller.signal.aborted) throw new Error('The agent took too long to respond. Please try again.');
    if (error instanceof TypeError) throw new Error('Cannot reach the agent. Check your connection and backend address.');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/** What the agent's root route answers; the sheet's "Test connection" checks for exactly this shape. */
export interface BackendPing { ok: true; name: 'mandate-agent'; dryRun: boolean }
const NO_BACKEND = 'No Mandate backend answered at this address.';
function asBackendPing(body: unknown): BackendPing | undefined {
  const b = body as Partial<BackendPing> | null;
  return b?.ok === true && b.name === 'mandate-agent' && typeof b.dryRun === 'boolean' ? { ok: true, name: 'mandate-agent', dryRun: b.dryRun } : undefined;
}

export const api = {
  chatHistory: () => req<ChatMessage[]>('/chat'),
  chat: (body: { requestId: string; message: string; mandateId?: string }) => req<ChatMessage>('/chat', { method: 'POST', body: JSON.stringify(body) }),
  /** Clears the verified wallet's conversation: messages and unconfirmed proposals. */
  clearChat: () => req<{ ok: true }>('/chat', { method: 'DELETE' }),
  confirmChatTrade: (id: string) => req<Order>(`/chat/proposals/${encodeURIComponent(id)}/confirm`, { method: 'POST' }),
  authorization: (id: string) => req<MandateAuthorization>(`/chat/authorization/${encodeURIComponent(id)}`),
  session: () => req<{ account: Address }>('/auth/session'),
  verifyWallet: async (account: Address, sign: (message: string) => Promise<`0x${string}`>) => {
    const challenge = await req<{ nonce: string; message: string }>('/auth/challenge', { method: 'POST', body: JSON.stringify({ account }) });
    const signature = await sign(challenge.message);
    const session = await req<{ token: string; expiresAt: number; account: string }>('/auth/verify', { method: 'POST', body: JSON.stringify({ nonce: challenge.nonce, signature }) });
    if (session.account?.toLowerCase() !== account.toLowerCase()) throw new Error('Wallet verification returned a different account. Connect your wallet again.');
    await saveSession({ ...session, backend: backendUrl() });
  },
  logout: async () => {
    const token = await sessionToken(backendUrl());
    await clearSession();
    if (token) void req('/auth/logout', { method: 'POST', headers: { authorization: `Bearer ${token}` } }).catch(() => {});
  },
  orders: () => req<Order[]>('/orders'),
  cancelOrder: (id: string) => req<Order>(`/orders/${encodeURIComponent(id)}/cancel`, { method: 'POST' }),
  agent: () => req<AgentInfo>('/agent'),
  /** Switches the backend's execution mode for every wallet that uses it. Signs nothing by itself. */
  setMode: (live: boolean) => req<{ dryRun: boolean }>('/mode', { method: 'POST', body: JSON.stringify({ live }) }),
  aiModels: () => req<AIModel[]>('/ai/models'),
  configureAI: (body: { apiKey?: string; model: string }) => req<AIStatus>('/ai/settings', { method: 'POST', body: JSON.stringify(body) }),
  resetAI: () => req<AIStatus>('/ai/settings', { method: 'DELETE' }),
  draftInstructions: (body: DraftInput) => req<AIDraft>('/ai/draft', { method: 'POST', body: JSON.stringify(body) }),
  mandates: (account: Address) => req<Mandate[]>(`/mandates?account=${account}`),
  activity: (account: Address) => req<Activity[]>(`/activity?account=${account}`),
  createMandate: (body: Omit<Mandate, 'id' | 'status' | 'createdAt' | 'spender'>) =>
    req<Mandate>('/mandates', { method: 'POST', body: JSON.stringify(body) }),
  runNow: (id: string) => req<{ ok: true }>(`/mandates/${id}/run`, { method: 'POST' }),
  /** Adds one owner-signed sell permission to a live mandate and registers it on Base. Repeating a covered token changes nothing. */
  addSellPermission: (id: string, permission: PermissionDetails & { signature: `0x${string}` }) =>
    req<Mandate>(`/mandates/${encodeURIComponent(id)}/permissions`, { method: 'POST', body: JSON.stringify(permission) }),
  revoke: (id: string) => req<{ ok: true }>(`/mandates/${id}/revoke`, { method: 'POST' }),
  /** Swaps $usd of the spender's own ETH to USDC through the real trade path. A confirmed transaction on Base. */
  /** Quotes a $usd ETH→USDC swap for the user's own wallet to sign; valid for about 45 seconds. Sends nothing. */
  walletSwapPlan: (usd: number) => req<WalletSwapPlan>(`/test-swap/wallet?usd=${usd}`),
  /** Reachability check for a candidate address. Sends no credentials and bypasses the preview and session paths. */
  ping: async (url: string): Promise<BackendPing> => {
    const address = parseBackendAddress(url);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    let body: unknown;
    try {
      const res = await fetch(`${address}/`, { signal: controller.signal, headers: { accept: 'application/json' } });
      body = res.ok ? await res.json() : undefined;
    } catch {
      throw new Error(NO_BACKEND);
    } finally {
      clearTimeout(timer);
    }
    const ping = asBackendPing(body);
    if (!ping) throw new Error(NO_BACKEND);
    return ping;
  },
};

/** The build default. Kept for older call sites; new code reads backendUrl() at call time. */
export const API_BASE_URL = DEFAULT_BACKEND_URL;

export interface ChatProposal {
  id: string; mandateId: string; action: 'buy' | 'sell'; symbol: string; token: string;
  usd?: number; fraction?: number; estimatedShares: number; price: number; priceUpdatedAt: number;
  expiresAt: number; dryRun: boolean; rationale: string;
}
export interface ChatMessage {
  id: string; requestId: string; role: 'user' | 'assistant'; text: string; ts: number; mandateId?: string;
  proposal?: ChatProposal; model?: string;
  sources?: { symbol: string; price: number; updatedAt: number; stale: boolean; url: string }[];
}
export interface MandateAuthorization {
  mode: 'simulation' | 'live'; ready: boolean; checkedAt: number; detail: string;
  permissions: { token: string; approved: boolean; revoked: boolean }[];
}
