import { z } from 'zod';
import { eligibility } from './eligibility.js';
import { db } from './db.js';
import { config } from './config.js';
import { executeOrder, modeMatches, needsReturn, returnStrandedFunds, runMandate } from './runner.js';
import { atomicWriteJson, loadValidatedJson } from './persistence.js';

const Schedule = z.record(z.number());
const schedulePath = '/data/schedule.json';
const eligible = (schedule: Record<string, number>) => db.mandates.filter(m => ['active', 'pending'].includes(m.status) && modeMatches(m) && (config.dryRun || eligibility.status(m.account).allowed) && (m.status === 'pending' || m.control !== 'chat' || schedule[m.id] === 0));

export function requestEvaluation(id: string) {
  const schedule = loadValidatedJson(schedulePath, Schedule, {});
  schedule[id] = 0;
  atomicWriteJson(schedulePath, schedule);
}

/** One item per alarm bounds execution duration. Existing journals/idempotence guard retries. */
export async function schedulerStep() {
  // Returning stranded funds outranks starting new trades: the owner's money never waits behind a queue.
  const stranded = db.orders.find(needsReturn);
  if (stranded) {
    const m = db.mandates.find(item => item.id === stranded.mandateId);
    if (m) { await returnStrandedFunds(m, stranded); return; }
  }
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
    ...(db.orders.some(needsReturn) ? [Date.now()] : []),
    ...db.orders.filter(o => o.status === 'queued').map(o => o.executeAfter * 1000),
    ...eligible(schedule).map(m => schedule[m.id] ?? Date.now()),
  ];
  return due.length ? Math.max(Date.now() + 5000, Math.min(...due)) : null;
}
