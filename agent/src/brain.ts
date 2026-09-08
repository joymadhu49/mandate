import { z } from 'zod';
import { aiSettings, completeJSON } from './openrouter.js';
import type { Mandate, Position } from './types.js';
import type { Quote } from './chain.js';

export const Decision = z.object({
  actions: z
    .array(
      z.discriminatedUnion('action', [
        z.object({ action: z.literal('buy'), symbol: z.string().min(1).max(16), usd: z.number().positive(), rationale: z.string().min(3).max(400) }).strict(),
        z.object({ action: z.literal('sell'), symbol: z.string().min(1).max(16), fraction: z.number().positive().max(1), rationale: z.string().min(3).max(400) }).strict(),
      ]),
    )
    .max(4),
  summary: z.string().max(400),
}).strict();
export type Decision = z.infer<typeof Decision>;

const decisionSchema = {
  type: 'object', additionalProperties: false, required: ['actions', 'summary'],
  properties: {
    summary: { type: 'string' },
    actions: { type: 'array', items: { anyOf: [
      { type: 'object', additionalProperties: false, required: ['action', 'symbol', 'usd', 'rationale'], properties: {
        action: { type: 'string', enum: ['buy'] }, symbol: { type: 'string' }, usd: { type: 'number' }, rationale: { type: 'string' },
      } },
      { type: 'object', additionalProperties: false, required: ['action', 'symbol', 'fraction', 'rationale'], properties: {
        action: { type: 'string', enum: ['sell'] }, symbol: { type: 'string' }, fraction: { type: 'number' }, rationale: { type: 'string' },
      } },
    ] } },
  },
};

export interface MarketView {
  quotes: Quote[];
  change24h: Record<string, number | null>; // token -> % vs ~24h ago
  changeSinceLastRun: Record<string, number | null>;
  marketOpen: boolean;
}

export function riskExit(m: Mandate, pos: Position | undefined, q: Quote) {
  if (!pos || pos.costUsd <= 0 || !Number.isFinite(q.price) || q.price <= 0 || q.stale) return undefined;
  const pnl = ((q.price * pos.shares - pos.costUsd) / pos.costUsd) * 100;
  if (pnl <= -m.stopLossPct) return { reason: 'stop-loss' as const, fraction: 1, rationale: `Stop loss at -${m.stopLossPct}% hit (${pnl.toFixed(1)}%).` };
  if (pnl >= m.takeProfitPct) return { reason: 'take-profit' as const, fraction: 0.5, rationale: `Take-profit target +${m.takeProfitPct}% hit (${pnl.toFixed(1)}%); sell half.` };
  return undefined;
}

export async function decide(m: Mandate, positions: Position[], mv: MarketView, remainingBudget: number): Promise<Decision> {
  const universe = mv.quotes.filter((q) => m.universe.some((t) => t.toLowerCase() === q.token.toLowerCase()));
  const exits = universe.flatMap(q => {
    const exit = riskExit(m, positions.find(p => p.token.toLowerCase() === q.token.toLowerCase()), q);
    return exit ? [{ ...exit, symbol: q.symbol }] : [];
  }).sort((a, b) => Number(b.reason === 'stop-loss') - Number(a.reason === 'stop-loss'));
  if (exits.length) return { actions: exits.slice(0, 4).map(exit => ({ action: 'sell' as const, symbol: exit.symbol, fraction: exit.fraction, rationale: exit.rationale })), summary: 'Mandatory risk exits take priority.' };
  const table = universe
    .map((q) => {
      const pos = positions.find((p) => p.token.toLowerCase() === q.token.toLowerCase());
      const pnl = pos && pos.costUsd > 0 ? ((q.price * pos.shares - pos.costUsd) / pos.costUsd) * 100 : null;
      return [
        q.symbol,
        `$${q.price.toFixed(2)}`,
        `24h ${fmt(mv.change24h[q.token])}`,
        `since last check ${fmt(mv.changeSinceLastRun[q.token])}`,
        pos ? `held ${pos.shares.toFixed(4)} sh ($${(q.price * pos.shares).toFixed(2)}, ${fmt(pnl)} P&L)` : 'not held',
      ].join(' | ');
    })
    .join('\n');

  const system = `You are a disciplined portfolio agent operating under a user-signed mandate on Base.
You trade Coinbase Tokenized Stocks (B20 tokens; 1 token ≈ 1 share, multiplier-adjusted). Prices are Chainlink total-return feeds.
The blockchain enforces signed token spending permissions. The backend enforces the strategy's remaining USDC budget, allowed universe, max position size, and mandatory take-profit/stop-loss exits. Do not exceed these backend limits.
Be conservative by default: when the market is closed or the feed is frozen, prefer no action unless a stop-loss is hit. Don't churn. Each action needs a concrete, honest rationale a user can read in one glance. Never invent news.
Respond with JSON only matching: {"actions":[{"action":"buy"|"sell","symbol":string,"usd"?:number,"fraction"?:number,"rationale":string}],"summary":string}. "actions" may be empty.`;

  const user = `MANDATE
Risk profile: ${m.risk}. Max per position: ${m.maxPositionPct}% of budget ($${((m.budgetUsdc * m.maxPositionPct) / 100).toFixed(2)}). Take profit +${m.takeProfitPct}%. Stop loss -${m.stopLossPct}%.
Budget: $${m.budgetUsdc} per ${m.period.replace('ly', '')}. Remaining this period: $${remainingBudget.toFixed(2)}.
User's instructions: "${m.strategy}"

MARKET (${mv.marketOpen ? 'US market open — feeds live' : 'US market closed — feeds hold last close'})
${table}

Decide now.`;

  const settings = aiSettings(m.account);
  if (!settings.apiKey) {
    return heuristic(m, positions, mv, remainingBudget);
  }

  return completeJSON(settings, 'portfolio_decision', decisionSchema, Decision, system, user, 1200, m.account);
}

// Fallback when no LLM key is configured: rules only (TP/SL + buy-the-dip), so the demo still works.
function heuristic(m: Mandate, positions: Position[], mv: MarketView, remaining: number): Decision {
  const actions: Decision['actions'] = [];
  for (const q of mv.quotes) {
    if (q.stale || !Number.isFinite(q.price) || q.price <= 0) continue;
    if (!m.universe.some((t) => t.toLowerCase() === q.token.toLowerCase())) continue;
    const pos = positions.find((p) => p.token.toLowerCase() === q.token.toLowerCase());
    const pnl = pos && pos.costUsd > 0 ? ((q.price * pos.shares - pos.costUsd) / pos.costUsd) * 100 : null;
    if (pos && pnl !== null && pnl >= m.takeProfitPct) {
      actions.push({ action: 'sell', symbol: q.symbol, fraction: 0.5, rationale: `Up ${pnl.toFixed(1)}% vs cost — taking half off at the +${m.takeProfitPct}% target.` });
    } else if (pos && pnl !== null && pnl <= -m.stopLossPct) {
      actions.push({ action: 'sell', symbol: q.symbol, fraction: 1, rationale: `Down ${pnl.toFixed(1)}% vs cost — stop loss at -${m.stopLossPct}% hit.` });
    } else if (!pos && mv.marketOpen && remaining > 5) {
      const ch = mv.change24h[q.token];
      if (ch !== null && ch !== undefined && ch <= -2) {
        const usd = Math.min(remaining, (m.budgetUsdc * m.maxPositionPct) / 100);
        actions.push({ action: 'buy', symbol: q.symbol, usd: Math.floor(usd), rationale: `${q.symbol} is ${ch.toFixed(1)}% on the day; buying the dip per mandate.` });
        remaining -= usd;
      }
    }
  }
  return { actions: actions.slice(0, 4), summary: actions.length ? `${actions.length} rule-based action(s).` : 'No rule triggered; holding.' };
}

const fmt = (n: number | null | undefined) => (n === null || n === undefined ? 'n/a' : `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`);
