import { z } from 'zod';
import { db } from './db.js';
import { config } from './config.js';
import { executeOrder, modeMatches, runMandate } from './runner.js';
import { atomicWriteJson, loadValidatedJson } from './persistence.js';

const Schedule = z.record(z.number());
const schedulePath = '/data/schedule.json';
const eligible = (schedule: Record<string, number>) => db.mandates.filter(m => ['active', 'pending'].includes(m.status) && modeMatches(m) && (m.status === 'pending' || m.control !== 'chat' || schedule[m.id] === 0));

export function requestEvaluation(id: string) {
  const schedule = loadValidatedJson(schedulePath, Schedule, {});
  schedule[id] = 0;
  atomicWriteJson(schedulePath, schedule);
}

/** One item per alarm bounds execution duration. Existing journals/idempotence guard retries. */
export async function schedulerStep() {
  const order = [...db.orders].reverse().find(o => o.status === 'queued' && o.executeAfter * 1000 <= Date.now());
  if (order) { await executeOrder(order); return; }
  const schedule = loadValidatedJson(schedulePath, Schedule, {});
  const mandate = eligible(schedule).find(m => (schedule[m.id] ?? 0) <= Date.now());
  if (!mandate) return;
  // Reserve the next evaluation before any external operation; an alarm retry cannot repeat it.
  schedule[mandate.id] = Date.now() + config.intervalMin * 60_000;
  atomicWriteJson(schedulePath, schedule);
  await runMandate(mandate);
}

export function nextScheduledAt(): number | null {
  const schedule = loadValidatedJson(schedulePath, Schedule, {});
  const due = [
    ...db.orders.filter(o => o.status === 'queued').map(o => o.executeAfter * 1000),
    ...eligible(schedule).map(m => schedule[m.id] ?? Date.now()),
  ];
  return due.length ? Math.max(Date.now() + 5000, Math.min(...due)) : null;
}
