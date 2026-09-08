import { z } from 'zod';

export class AdmissionError extends Error {
  readonly status = 429;
}

export const UsageSchema = z.object({
  day: z.string(),
  total: z.number().int().nonnegative(),
  owners: z.record(z.object({ tokens: z.number().int().nonnegative(), lastAt: z.number().nonnegative() }).strict()),
}).strict();
export type AIUsage = z.infer<typeof UsageSchema>;
export const emptyUsage = (): AIUsage => ({ day: '', total: 0, owners: {} });
// Daily token budgets can be tightened per deployment (e.g. a public demo on a small OpenRouter balance)
// with AI_DAILY_TOKENS_GLOBAL / AI_DAILY_TOKENS_WALLET; the defaults stay when unset or invalid.
const envLimit = (name: string, fallback: number) => {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
};
export const AI_LIMITS = {
  concurrency: 2,
  globalDailyTokens: envLimit('AI_DAILY_TOKENS_GLOBAL', 2_000_000),
  ownerDailyTokens: envLimit('AI_DAILY_TOKENS_WALLET', 300_000),
  ownerCooldownMs: 60_000,
  chatCooldownMs: envLimit('AI_CHAT_COOLDOWN_MS', 5_000),
  maxRequestTokens: 24_000,
} as const;

// Reserve a conservative upper bound before any paid request. Failed or
// interrupted requests keep their reservation: retries/restarts cannot refund it.
export class FundedAIAdmission {
  private active = 0;
  constructor(private read: () => AIUsage, private write: (usage: AIUsage) => void, private clock = Date.now) {}

  async run<T>(owner: string | undefined, tokens: number, work: () => Promise<T>, purpose: 'evaluation' | 'chat' = 'evaluation'): Promise<T> {
    if (!Number.isSafeInteger(tokens) || tokens <= 0 || tokens > AI_LIMITS.maxRequestTokens) throw new AdmissionError('The AI request exceeds the input limit.');
    if (this.active >= AI_LIMITS.concurrency) throw new AdmissionError('The agent is busy with other AI requests. Try again shortly.');
    const now = this.clock();
    const day = new Date(now).toISOString().slice(0, 10);
    const saved = UsageSchema.parse(this.read());
    const usage = saved.day === day ? structuredClone(saved) : { ...emptyUsage(), day };
    const principal = owner ? owner.toLowerCase() : 'development';
    if (owner && !/^0x[0-9a-f]{40}$/.test(principal)) throw new AdmissionError('A verified account is required for an AI decision.');
    const prior = usage.owners[principal];
    const cooldown = purpose === 'chat' ? AI_LIMITS.chatCooldownMs : AI_LIMITS.ownerCooldownMs;
    if (owner && prior && now - prior.lastAt < cooldown) throw new AdmissionError(purpose === 'chat' ? 'Wait five seconds between chat messages.' : 'Wait a minute between AI evaluations for this wallet.');
    if (usage.total + tokens > AI_LIMITS.globalDailyTokens || (prior?.tokens ?? 0) + tokens > AI_LIMITS.ownerDailyTokens) throw new AdmissionError('The daily AI usage limit has been reached. Try again tomorrow.');
    usage.total += tokens;
    usage.owners[principal] = { tokens: (prior?.tokens ?? 0) + tokens, lastAt: now };
    this.write(usage); // A storage error must prevent the paid request.
    this.active++;
    try { return await work(); } finally { this.active--; }
  }
}

type StoredMandate = { account: string; status: string; createdAt: number };
export function assertMandateAdmission(mandates: StoredMandate[], account: string, now = Date.now()): void {
  const mine = mandates.filter(m => m.account.toLowerCase() === account.toLowerCase());
  const active = (m: StoredMandate) => !['revoked', 'expired'].includes(m.status);
  if (mandates.length >= 1000 || mandates.filter(active).length >= 100 || mine.length >= 100 || mine.filter(active).length >= 5) {
    throw new AdmissionError('The mandate limit has been reached. Revoke an unused mandate or contact the backend operator.');
  }
  if (mine.some(m => now / 1000 - m.createdAt < 30)) throw new AdmissionError('Wait 30 seconds before creating another mandate.');
}
