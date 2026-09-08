import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { atomicWriteJson, persistentObject } from './persistence.js';
import { config } from './config.js';
import type { Activity, Mandate, Position, PricePoint, Order } from './types.js';
import type { PipelineJournalEntry } from './pipeline-test.js';

interface Schema {
  mandates: Mandate[];
  positions: Position[];
  activity: Activity[];
  prices: PricePoint[];
  orders: Order[];
  pipelineTests: PipelineJournalEntry[];
}

const empty: Schema = { mandates: [], positions: [], activity: [], prices: [], orders: [], pipelineTests: [] };

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const number = z.number().finite();
const unsigned = number.nonnegative();
const mode = z.enum(['simulation', 'live']).optional();
const journal = z.array(z.object({ name: z.string(), status: z.enum(['prepared', 'confirmed', 'failed']), hash: z.string().regex(/^0x[0-9a-fA-F]{64}$/), updatedAt: unsigned })).optional();
const identity = { id: z.string().min(1), account: address };
export const DatabaseSchema = z.object({
  mandates: z.array(z.object({ ...identity, spender: address, executionMode: mode, transactions: journal,
    control: z.enum(['chat', 'automatic']).optional(),
    budgetUsdc: number.positive(), period: z.enum(['daily', 'weekly', 'monthly']), universe: z.array(address).min(1), strategy: z.string(),
    risk: z.enum(['conservative', 'balanced', 'aggressive']), maxPositionPct: number.positive().max(100), takeProfitPct: number.positive(), stopLossPct: number.positive(),
    status: z.enum(['pending', 'active', 'revoked', 'expired', 'error']), createdAt: unsigned, lastRunAt: unsigned.optional(), spentThisPeriod: unsigned.optional(), periodStart: number.optional(),
    batch: z.object({ account: address, period: number.int().positive(), start: number.int(), end: number.int(), permissions: z.array(z.object({ spender: address, token: address, allowance: z.string().regex(/^\d+$/), salt: z.string().regex(/^\d+$/), extraData: z.string().regex(/^0x(?:[0-9a-fA-F]{2})*$/), signature: z.string().optional() })) }),
  }).passthrough()),
  positions: z.array(z.object({ mandateId: z.string(), token: address, symbol: z.string(), shares: unsigned, raw: z.string().regex(/^\d+$/), costUsd: unsigned, executionMode: mode })),
  orders: z.array(z.object({ ...identity, mandateId: z.string(), action: z.enum(['buy', 'sell']), symbol: z.string(), token: address, rationale: z.string(),
    status: z.enum(['queued', 'executing', 'filled', 'cancelled', 'failed']), createdAt: unsigned, updatedAt: unsigned, executeAfter: unsigned, dryRun: z.boolean(),
    usd: unsigned.optional(), fraction: number.positive().max(1).optional(), transactions: journal, riskExit: z.enum(['stop-loss', 'take-profit']).optional(),
  }).passthrough()).default([]),
  activity: z.array(z.object({ ...identity, mandateId: z.string(), ts: unsigned, kind: z.enum(['buy', 'sell', 'hold', 'error', 'approved', 'queued', 'cancelled', 'revoked']), rationale: z.string() }).passthrough()),
  prices: z.array(z.object({ ts: unsigned, prices: z.record(unsigned) })),
  pipelineTests: z.array(z.object({
    ...identity, ts: unsigned, usd: number.positive(), status: z.enum(['prepared', 'confirmed', 'failed']),
    hash: z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional(), tool: z.string().optional(),
    usdcReceived: number.optional(), ethSpent: number.optional(), error: z.string().optional(),
  })).default([]),
});

export const db: Schema = persistentObject(config.dbPath, DatabaseSchema as z.ZodType<Schema>, empty);

export function save() {
  atomicWriteJson(config.dbPath, db);
}

export const uid = () => randomUUID();

export function log(a: Omit<Activity, 'id' | 'ts'>) {
  const entry: Activity = { id: uid(), ts: Math.floor(Date.now() / 1000), ...a };
  db.activity.unshift(entry);
  if (db.activity.length > 2000) db.activity.length = 2000;
  save();
  console.log(`[${entry.kind}] ${entry.symbol ?? ''} ${entry.amountUsd ? `$${entry.amountUsd.toFixed(2)}` : ''} — ${entry.rationale}`);
  return entry;
}

export function positionsFor(mandateId: string) {
  return db.positions.filter((p) => p.mandateId === mandateId && p.shares > 0);
}
