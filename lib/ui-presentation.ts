import type { Activity, Order, TransactionStep } from './api';
import { money } from './theme';

export const activityLabels: Record<Activity['kind'], string> = {
  buy: 'Bought', sell: 'Sold', hold: 'Agent update', error: 'Attention needed',
  approved: 'Permission approved', revoked: 'Mandate revoked', queued: 'Order proposed', cancelled: 'Order cancelled',
};

// Freeform account text can contain amounts written as digits or words. Hide the
// whole field rather than guessing which fragments are safe to disclose.
export function privateAccountText(text: string, hidden: boolean) {
  return hidden ? 'Details hidden while balances are hidden.' : text;
}

export function activityAccessibilityLabel(activity: Activity, hidden: boolean) {
  return [
    activityLabels[activity.kind], activity.symbol?.replace(/c$/, ''),
    activity.amountUsd !== undefined ? hidden ? 'Amount hidden' : money(activity.amountUsd) : undefined,
    new Date(activity.ts * 1000).toLocaleString(),
    privateAccountText(activity.rationale, hidden), 'View mandate',
  ].filter(Boolean).join('. ');
}

export function orderAccessibilityLabel(order: Order, status: string, amount: string, hidden: boolean) {
  return [
    `${order.action === 'buy' ? 'Buy' : 'Sell'} ${order.symbol.replace(/c$/, '')}`, status,
    hidden ? 'Amount hidden' : amount, order.dryRun ? 'Simulation' : 'Live order',
    new Date(order.createdAt * 1000).toLocaleString(),
    privateAccountText(order.rationale, hidden), 'View order',
  ].join('. ');
}

export function stockGridColumns(contentWidth: number, fontScale: number) {
  return Math.max(1, Math.min(4, Math.floor((contentWidth + 8) / (70 * Math.max(1, fontScale) + 8))));
}

const transactionNames: Record<string, string> = {
  'permission-approval': 'Approve spending permission',
  pull: 'Transfer funds for the order',
  'swap-approval': 'Approve swap spending',
  swap: 'Execute swap',
  delivery: 'Deliver assets to your wallet',
  return: 'Return funds to your wallet',
  'permission-revocation': 'Revoke spending permission',
};

export function transactionStepName(name: string, hidden: boolean) {
  return Object.hasOwn(transactionNames, name) ? transactionNames[name] : hidden ? 'Transaction step' : name.replace(/[-_]/g, ' ');
}

export function transactionStepStatus(status: TransactionStep['status']) {
  return status === 'confirmed' ? 'Confirmed on Base' : status === 'failed' ? 'Failed on Base' : 'Status unknown';
}

export function transactionUrl(hash: string) {
  return /^0x[0-9a-fA-F]{64}$/.test(hash) ? `https://basescan.org/tx/${hash}` : undefined;
}
// Kept for accessibility provenance labels; visible UI uses mandateTitle().
export function chatMandateLabel(id: string, control?: 'chat' | 'automatic') {
  return `${control === 'chat' ? 'Chat' : control === 'automatic' ? 'Auto' : 'Mandate'} · ${id.slice(0, 8)}`;
}

// ---- Shared vocabulary -------------------------------------------------------
// One phrasing per concept so the same object reads the same on every screen.

export type PeriodKey = 'daily' | 'weekly' | 'monthly';
export const periodNoun: Record<PeriodKey, string> = { daily: 'day', weekly: 'week', monthly: 'month' };
export const periodPhrase: Record<PeriodKey, string> = { daily: 'per day', weekly: 'per week', monthly: 'per month' };
export const periodSeconds: Record<PeriodKey, number> = { daily: 86400, weekly: 7 * 86400, monthly: 30 * 86400 };

export const riskLabel: Record<'conservative' | 'balanced' | 'aggressive', string> = {
  conservative: 'Conservative', balanced: 'Balanced', aggressive: 'Aggressive',
};

export const controlLabel: Record<'chat' | 'automatic', string> = { chat: 'Confirm in chat', automatic: 'Automatic' };

/**
 * Wallet approvals a new live mandate asks for at setup. A chat mandate approves the USDC budget now and each
 * stock the first time it is sold; an automatic mandate must be able to exit positions unattended, so it
 * approves every stock up front.
 */
export function approvalPlan(control: 'chat' | 'automatic', stocks: number) {
  if (control === 'chat') return { total: 1, summary: 'One approval now. Each stock asks once, the first time you sell it.' };
  const total = stocks + 1;
  return { total, summary: `${total} approvals now: USDC plus one per stock. Trades never ask again.` };
}

export const mandateStatusLabel: Record<'pending' | 'active' | 'revoked' | 'expired' | 'error', string> = {
  pending: 'Pending', active: 'Active', revoked: 'Revoked', expired: 'Expired', error: 'Needs review',
};

export const mandateStatusTone: Record<keyof typeof mandateStatusLabel, 'green' | 'amber' | 'red' | 'muted'> = {
  pending: 'amber', active: 'green', revoked: 'muted', expired: 'muted', error: 'red',
};

export const activityTone: Record<Activity['kind'], 'green' | 'red' | 'amber' | 'muted' | 'base'> = {
  buy: 'green', sell: 'red', hold: 'muted', error: 'red', approved: 'base', revoked: 'muted', queued: 'amber', cancelled: 'muted',
};

/** VoiceOver label for a mandate row; honors privacy like the order and activity labels. */
export function mandateAccessibilityLabel(m: MandateLike & { status: keyof typeof mandateStatusLabel }, symbols: string[], hidden: boolean) {
  return [
    mandateTitle(m, hidden), mandateStatusLabel[m.status],
    symbols.length ? symbols.map(s => s.replace(/c$/, '')).join(', ') : undefined, 'View mandate',
  ].filter(Boolean).join('. ');
}

/** Exactly one phrasing for execution mode, everywhere. */
export function modeLabel(dryRun: boolean | undefined) {
  return dryRun === undefined ? 'Connecting…' : dryRun ? 'Simulation · no real funds' : 'Live · real funds';
}

type MandateLike = { budgetUsdc: number; period: PeriodKey; control?: 'chat' | 'automatic'; universe: readonly unknown[] };

export const controlShortLabel: Record<'chat' | 'automatic', string> = { chat: 'Chat', automatic: 'Auto' };

/**
 * Human-readable identity for a mandate: "$100 / week · Confirm in chat". Budget masked when hidden.
 * `short` uses the compact control word ("$100 / week · Chat") for pills and row meta; `none` omits it.
 */
export function mandateTitle(m: MandateLike, hidden: boolean, control: 'full' | 'short' | 'none' = 'full') {
  const budget = hidden ? '••••' : money(m.budgetUsdc, 0);
  const suffix = !m.control || control === 'none' ? '' : ` · ${(control === 'short' ? controlShortLabel : controlLabel)[m.control]}`;
  return `${budget} / ${periodNoun[m.period]}${suffix}`;
}

/** Secondary line: "5 stocks · Balanced · expires Oct 5". */
export function mandateSummary(m: MandateLike & { risk: keyof typeof riskLabel; batch: { end: number } }) {
  const stocks = `${m.universe.length} ${m.universe.length === 1 ? 'stock' : 'stocks'}`;
  return `${stocks} · ${riskLabel[m.risk]} · expires ${shortDate(m.batch.end)}`;
}

/** Remaining budget for the current period, clamped. */
export function budgetProgress(budgetUsdc: number, spentThisPeriod = 0) {
  const spent = Math.max(0, Math.min(budgetUsdc, spentThisPeriod));
  return { spent, remaining: budgetUsdc - spent, fraction: budgetUsdc > 0 ? spent / budgetUsdc : 0 };
}

/** "2m ago" inside a day, otherwise "Sep 5, 2:42 AM". One format for every list. */
export function whenLabel(unix: number, now = Date.now()) {
  const s = Math.floor(now / 1000 - unix);
  if (s < 0) return shortDateTime(unix);
  if (s < 60) return 'Just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return shortDateTime(unix);
}

export function shortDate(unix: number) {
  return new Date(unix * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function shortDateTime(unix: number) {
  return new Date(unix * 1000).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** "4:32" for a deadline in the future, "0:00" once it has passed. */
export function countdownLabel(untilUnix: number, now = Date.now()) {
  const s = Math.max(0, Math.floor(untilUnix - now / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** "resets in 3d" / "resets in 4h" / "resets soon". */
export function resetsLabel(periodStart: number | undefined, period: PeriodKey, now = Date.now()) {
  if (!periodStart) return undefined;
  const end = periodStart + periodSeconds[period];
  const s = Math.floor(end - now / 1000);
  if (s <= 0) return 'resets soon';
  if (s < 3600) return `resets in ${Math.max(1, Math.floor(s / 60))}m`;
  if (s < 86400) return `resets in ${Math.floor(s / 3600)}h`;
  return `resets in ${Math.floor(s / 86400)}d`;
}

// ---- US market hours ----------------------------------------------------------
// Tokenized-stock feeds freeze while the NYSE is closed; Home shows when it reopens.

/** NYSE full-day closures, 'YYYY-MM-DD'. Weekday holidays observed on the nearest weekday. */
export const US_MARKET_HOLIDAYS_2026 = [
  '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25', '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25',
];
export const US_MARKET_HOLIDAYS_2027 = [
  '2027-01-01', '2027-01-18', '2027-02-15', '2027-03-26', '2027-05-31', '2027-06-18', '2027-07-05', '2027-09-06', '2027-11-25', '2027-12-24',
];
export const US_MARKET_HOLIDAYS = [...US_MARKET_HOLIDAYS_2026, ...US_MARKET_HOLIDAYS_2027];
const holidaySet = new Set(US_MARKET_HOLIDAYS);

const MARKET_OPEN_MINUTES = 9 * 60 + 30;
const MARKET_CLOSE_MINUTES = 16 * 60;

type NewYorkParts = { year: number; month: number; day: number; hour: number; minute: number; weekday: string };

// Built once: Intl formatters are costly to construct on Hermes.
let newYorkFormatter: Intl.DateTimeFormat | undefined;
function newYorkParts(ms: number): NewYorkParts {
  newYorkFormatter ??= new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short',
  });
  const parts = newYorkFormatter.formatToParts(new Date(ms));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(p => p.type === type)?.value ?? '';
  return {
    year: Number(part('year')), month: Number(part('month')), day: Number(part('day')),
    // Some engines print midnight as "24" even with h23.
    hour: Number(part('hour')) % 24, minute: Number(part('minute')), weekday: part('weekday'),
  };
}

const isoDate = (year: number, month: number, day: number) =>
  `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

/** Unix ms for a New York wall-clock time; the zone offset comes from the formatter, so DST is right either way. */
function newYorkWallToMs(year: number, month: number, day: number, hour: number, minute: number) {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const p = newYorkParts(guess);
  const offset = guess - Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return guess + offset;
}

function isTradingDay(year: number, month: number, day: number, weekday: number) {
  return weekday !== 0 && weekday !== 6 && !holidaySet.has(isoDate(year, month, day));
}

/** Unix seconds of the next NYSE regular-session open (09:30 New York) strictly after `nowMs`. */
export function nextMarketOpen(nowMs = Date.now()): number {
  const today = newYorkParts(nowMs);
  // Walk calendar dates in UTC purely as a date carrier; the weekday of a calendar date does not depend on the zone.
  for (let i = 0; i < 10; i++) {
    const d = new Date(Date.UTC(today.year, today.month - 1, today.day + i));
    const year = d.getUTCFullYear(), month = d.getUTCMonth() + 1, day = d.getUTCDate();
    if (!isTradingDay(year, month, day, d.getUTCDay())) continue;
    const open = newYorkWallToMs(year, month, day, 9, 30);
    if (open > nowMs) return Math.floor(open / 1000);
  }
  // Unreachable with the holiday list above (the longest closure is four days); keep the caller's countdown sane.
  return Math.floor(nowMs / 1000) + 86400;
}

/** True during the NYSE regular session: a trading day, 09:30 ≤ New York time < 16:00. */
export function marketIsOpen(nowMs = Date.now()) {
  const p = newYorkParts(nowMs);
  if (p.weekday === 'Sat' || p.weekday === 'Sun' || holidaySet.has(isoDate(p.year, p.month, p.day))) return false;
  const minutes = p.hour * 60 + p.minute;
  return minutes >= MARKET_OPEN_MINUTES && minutes < MARKET_CLOSE_MINUTES;
}

/** "reopens in 2d 3h" / "reopens in 19h" / "reopens in 12m" / "reopens soon". */
export function reopensLabel(nowMs = Date.now()) {
  const s = nextMarketOpen(nowMs) - Math.floor(nowMs / 1000);
  if (s < 60) return 'reopens soon';
  if (s < 3600) return `reopens in ${Math.floor(s / 60)}m`;
  if (s < 86400) return `reopens in ${Math.floor(s / 3600)}h`;
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  return hours ? `reopens in ${days}d ${hours}h` : `reopens in ${days}d`;
}

/** Unix seconds of the current session's close (16:00 New York) when the market is open, else undefined. */
export function nextMarketClose(nowMs = Date.now()): number | undefined {
  if (!marketIsOpen(nowMs)) return undefined;
  const p = newYorkParts(nowMs);
  return Math.floor(newYorkWallToMs(p.year, p.month, p.day, 16, 0) / 1000);
}

/** "19h 41m 03s" / "2d 03h 12m 05s" / "45s" — a ticking countdown for the market status card. */
export function longCountdownLabel(untilUnix: number, nowMs = Date.now()) {
  const s = Math.max(0, untilUnix - Math.floor(nowMs / 1000));
  const days = Math.floor(s / 86400), hours = Math.floor((s % 86400) / 3600), minutes = Math.floor((s % 3600) / 60), seconds = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (days) return `${days}d ${pad(hours)}h ${pad(minutes)}m ${pad(seconds)}s`;
  if (hours) return `${hours}h ${pad(minutes)}m ${pad(seconds)}s`;
  if (minutes) return `${minutes}m ${pad(seconds)}s`;
  return `${seconds}s`;
}

// Built once, like the New York parts formatter.
let newYorkClock: Intl.DateTimeFormat | undefined;
/** "Tue 9:30 AM ET" for an instant, in New York time. */
export function newYorkTimeLabel(unix: number) {
  newYorkClock ??= new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: '2-digit' });
  return `${newYorkClock.format(new Date(unix * 1000))} ET`;
}

/** "7:30 PM" in the device's own zone, so the New York time has a local anchor. */
export function localTimeLabel(unix: number) {
  return new Date(unix * 1000).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}
