import assert from 'node:assert/strict';
import test from 'node:test';
import { activityAccessibilityLabel, chatMandateLabel, orderAccessibilityLabel, privateAccountText, stockGridColumns, transactionStepName, transactionStepStatus, transactionUrl } from '../lib/ui-presentation.ts';

const activity = {
  id: 'event', mandateId: 'mandate', kind: 'buy', symbol: 'NVDAc',
  amountUsd: 1234.56, ts: 1_700_000_000,
  rationale: 'Bought $1,234.56 and reserved fifty dollars for fees.',
};
test('chat mandate labels identify the saved mandate independently of list order or selection', () => {
  assert.equal(chatMandateLabel('12345678-original', 'chat'), 'Chat · 12345678');
  assert.equal(chatMandateLabel('87654321-other', 'automatic'), 'Auto · 87654321');
  assert.equal(chatMandateLabel('12345678-original'), 'Mandate · 12345678');
});
const order = {
  id: 'order', mandateId: 'mandate', account: '0x0000000000000000000000000000000000000001',
  token: '0x0000000000000000000000000000000000000002', symbol: 'NVDAc',
  action: 'buy', usd: 1234.56, rationale: activity.rationale, dryRun: true,
  status: 'queued', createdAt: activity.ts, updatedAt: activity.ts, executeAfter: activity.ts + 60,
};

test('history labels distinguish stock, amount, timestamp and decision', () => {
  const label = activityAccessibilityLabel(activity, false);
  for (const content of ['Bought', 'NVDA', '$1,234.56', new Date(activity.ts * 1000).toLocaleString(), activity.rationale, 'View mandate']) {
    assert.ok(label.includes(content));
  }
  assert.notEqual(label, activityAccessibilityLabel({ ...activity, symbol: 'AAPLc' }, false));
  assert.ok(activityAccessibilityLabel({ ...activity, amountUsd: 0 }, false).includes('$0.00'));
});

test('privacy masks both structured amounts and freeform amounts in history and orders', () => {
  for (const label of [activityAccessibilityLabel(activity, true), orderAccessibilityLabel(order, 'Pending', '$1,234.56', true)]) {
    assert.ok(label.includes('NVDA'));
    assert.ok(label.includes('Amount hidden'));
    assert.ok(!label.includes('1,234'));
    assert.ok(!label.includes('fifty'));
    assert.ok(!label.includes(activity.rationale));
  }
  assert.equal(privateAccountText(activity.rationale, false), activity.rationale);
  assert.equal(privateAccountText(activity.rationale, true), 'Details hidden while balances are hidden.');
});

test('order label announces simulation, state and date independently of privacy', () => {
  for (const hidden of [false, true]) {
    const label = orderAccessibilityLabel(order, 'Pending', '$1,234.56', hidden);
    assert.ok(label.includes('Simulation'));
    assert.ok(label.includes('Pending'));
    assert.ok(label.includes(new Date(order.createdAt * 1000).toLocaleString()));
  }
  assert.ok(orderAccessibilityLabel({ ...order, dryRun: false }, 'Completed', '$1,234.56', false).includes('Live order'));
});

test('stock grid reduces columns to preserve readable tiles at accessibility sizes', () => {
  for (const contentWidth of [250, 305, 360]) {
    const counts = [1, 1.4, 2, 3.2].map(scale => stockGridColumns(contentWidth, scale));
    assert.ok(counts.every(count => count >= 1 && count <= 4));
    assert.ok(counts.every((count, index) => index === 0 || count <= counts[index - 1]));
    assert.equal(counts.at(-1), 1);
    for (const scale of [1, 1.4, 2, 3.2]) {
      const columns = stockGridColumns(contentWidth, scale);
      const tileWidth = (contentWidth - (columns - 1) * 8) / columns;
      assert.ok(columns === 1 || tileWidth >= 70 * scale);
    }
  }
});

test('prepared transaction steps never claim broadcast or confirmation', () => {
  assert.equal(transactionStepStatus('prepared'), 'Status unknown');
  assert.equal(transactionStepStatus('confirmed'), 'Confirmed on Base');
  assert.equal(transactionStepStatus('failed'), 'Failed on Base');
  assert.equal(transactionStepName('swap-approval', true), 'Approve swap spending');
  assert.equal(transactionStepName('transfer 1234 USDC', true), 'Transaction step');
  assert.equal(transactionStepName('toString', false), 'toString');
});

test('transaction links accept only a Base transaction hash', () => {
  const hash = `0x${'ab'.repeat(32)}`;
  assert.equal(transactionUrl(hash), `https://basescan.org/tx/${hash}`);
  for (const invalid of ['', '0x123', `${hash}/../../other`, 'https://example.com', `0x${'zz'.repeat(32)}`]) {
    assert.equal(transactionUrl(invalid), undefined);
  }
});

// ---- Shared vocabulary ----------------------------------------------------------
import { approvalPlan, budgetProgress, countdownLabel, mandateSummary, mandateTitle, modeLabel, resetsLabel, whenLabel } from '../lib/ui-presentation.ts';

test('approval plan: chat mandates approve USDC now and each stock on first sell; automatic mandates approve everything up front', () => {
  const chat = approvalPlan('chat', 5);
  assert.equal(chat.total, 1);
  assert.match(chat.summary, /^One approval now/);
  assert.match(chat.summary, /first time you sell/i);
  const automatic = approvalPlan('automatic', 5);
  assert.equal(automatic.total, 6);
  assert.match(automatic.summary, /^6 approvals now: USDC plus one per stock/);
  assert.equal(approvalPlan('automatic', 0).total, 1);
});

test('mandate titles read the same everywhere and mask the budget when hidden', () => {
  const m = { budgetUsdc: 100, period: 'weekly', control: 'chat', universe: ['0x1', '0x2', '0x3'], risk: 'balanced', batch: { end: 1_800_000_000 } };
  assert.equal(mandateTitle(m, false), '$100 / week · Confirm in chat');
  assert.equal(mandateTitle({ ...m, control: 'automatic', period: 'daily' }, false), '$100 / day · Automatic');
  assert.equal(mandateTitle({ ...m, control: undefined }, false), '$100 / week');
  assert.equal(mandateTitle(m, true), '•••• / week · Confirm in chat');
  assert.ok(!mandateTitle(m, true).includes('100'));
  assert.ok(mandateSummary(m).startsWith('3 stocks · Balanced · expires '));
  assert.ok(mandateSummary({ ...m, universe: ['0x1'] }).startsWith('1 stock · '));
});

test('execution mode has exactly one phrasing', () => {
  assert.equal(modeLabel(true), 'Simulation · no real funds');
  assert.equal(modeLabel(false), 'Live · real funds');
  assert.equal(modeLabel(undefined), 'Connecting…');
});

test('budget progress clamps to the envelope', () => {
  assert.deepEqual(budgetProgress(100, 15), { spent: 15, remaining: 85, fraction: 0.15 });
  assert.deepEqual(budgetProgress(100, 250), { spent: 100, remaining: 0, fraction: 1 });
  assert.deepEqual(budgetProgress(100, -5), { spent: 0, remaining: 100, fraction: 0 });
  assert.equal(budgetProgress(0, 0).fraction, 0);
});

test('one timestamp format: relative inside a day, short date beyond', () => {
  const now = 1_700_000_000_000;
  assert.equal(whenLabel(now / 1000 - 5, now), 'Just now');
  assert.equal(whenLabel(now / 1000 - 120, now), '2m ago');
  assert.equal(whenLabel(now / 1000 - 7200, now), '2h ago');
  assert.ok(!whenLabel(now / 1000 - 3 * 86400, now).includes('ago'));
  assert.equal(countdownLabel(now / 1000 + 272, now), '4:32');
  assert.equal(countdownLabel(now / 1000 - 10, now), '0:00');
  assert.equal(resetsLabel(now / 1000 - 4 * 86400, 'weekly', now), 'resets in 3d');
  assert.equal(resetsLabel(undefined, 'weekly', now), undefined);
});

test('mandate title variants keep the budget and vary only the control word', () => {
  const m = { budgetUsdc: 200, period: 'weekly', control: 'chat', universe: ['0x1'] };
  assert.equal(mandateTitle(m, false, 'short'), '$200 / week · Chat');
  assert.equal(mandateTitle({ ...m, control: 'automatic' }, false, 'short'), '$200 / week · Auto');
  assert.equal(mandateTitle(m, false, 'none'), '$200 / week');
  assert.equal(mandateTitle(m, true, 'short'), '•••• / week · Chat');
});

// ---- US market hours ------------------------------------------------------------
import { US_MARKET_HOLIDAYS, US_MARKET_HOLIDAYS_2026, US_MARKET_HOLIDAYS_2027, marketIsOpen, nextMarketOpen, reopensLabel } from '../lib/ui-presentation.ts';

const utc = (...args) => Date.UTC(...args);
const seconds = ms => ms / 1000;

test('next market open skips weekends and Labor Day and keeps 09:30 New York across daylight saving', () => {
  // Saturday 2026-09-05 12:00 UTC: Sunday, then Labor Day (Monday 09-07), so Tuesday 09-08 09:30 EDT.
  assert.equal(nextMarketOpen(utc(2026, 8, 5, 12)), seconds(utc(2026, 8, 8, 13, 30)));
  // Wednesday before the open is the same day; after the open is Thursday.
  assert.equal(nextMarketOpen(utc(2026, 8, 9, 12)), seconds(utc(2026, 8, 9, 13, 30)));
  assert.equal(nextMarketOpen(utc(2026, 8, 9, 15)), seconds(utc(2026, 8, 10, 13, 30)));
  // Strictly after: exactly at the open bell rolls to the next session.
  assert.equal(nextMarketOpen(utc(2026, 8, 9, 13, 30)), seconds(utc(2026, 8, 10, 13, 30)));
  // Standard time: 09:30 EST is 14:30 UTC.
  assert.equal(nextMarketOpen(utc(2026, 11, 10, 12)), seconds(utc(2026, 11, 10, 14, 30)));
  // Year rollover through New Year's Day (Friday) and the weekend into the 2027 list.
  assert.equal(nextMarketOpen(utc(2026, 11, 31, 22)), seconds(utc(2027, 0, 4, 14, 30)));
  // Good Friday 2027 (03-26) is closed; the following Monday opens at 09:30 EDT.
  assert.equal(nextMarketOpen(utc(2027, 2, 25, 21)), seconds(utc(2027, 2, 29, 13, 30)));
});

test('the market is open only during the regular session on trading days', () => {
  assert.equal(marketIsOpen(utc(2026, 8, 9, 13, 29)), false);
  assert.equal(marketIsOpen(utc(2026, 8, 9, 13, 30)), true);
  assert.equal(marketIsOpen(utc(2026, 8, 9, 19, 59)), true);
  assert.equal(marketIsOpen(utc(2026, 8, 9, 20, 0)), false);
  assert.equal(marketIsOpen(utc(2026, 8, 7, 15)), false); // Labor Day
  assert.equal(marketIsOpen(utc(2026, 8, 5, 15)), false); // Saturday
  assert.equal(marketIsOpen(utc(2026, 11, 10, 14, 30)), true); // EST open bell
  assert.equal(marketIsOpen(utc(2026, 11, 10, 13, 30)), false); // an hour before it in winter
});

test('reopen countdown reads like the budget reset label', () => {
  assert.equal(reopensLabel(utc(2026, 8, 5, 12)), 'reopens in 3d 1h');
  assert.equal(reopensLabel(utc(2026, 8, 5, 13, 30)), 'reopens in 3d');
  assert.equal(reopensLabel(utc(2026, 8, 9, 20)), 'reopens in 17h');
  assert.equal(reopensLabel(utc(2026, 8, 9, 13, 18)), 'reopens in 12m');
  assert.equal(reopensLabel(utc(2026, 8, 9, 13, 29, 30)), 'reopens soon');
});

test('holiday lists are well-formed weekday dates and the combined list covers both years', () => {
  assert.equal(US_MARKET_HOLIDAYS_2026.length, 10);
  assert.equal(US_MARKET_HOLIDAYS_2027.length, 10);
  assert.deepEqual(US_MARKET_HOLIDAYS, [...US_MARKET_HOLIDAYS_2026, ...US_MARKET_HOLIDAYS_2027]);
  assert.ok(US_MARKET_HOLIDAYS_2026.includes('2026-09-07'));
  for (const iso of US_MARKET_HOLIDAYS) {
    assert.match(iso, /^\d{4}-\d{2}-\d{2}$/);
    const weekday = new Date(`${iso}T12:00:00Z`).getUTCDay();
    assert.ok(weekday >= 1 && weekday <= 5, `${iso} is not a weekday`);
  }
});

import { longCountdownLabel, nextMarketClose, newYorkTimeLabel } from '../lib/ui-presentation.ts';

test('market status countdown pieces', () => {
  const laborDayNoonUTC = Date.UTC(2026, 8, 7, 12, 0);
  assert.equal(nextMarketClose(laborDayNoonUTC), undefined);
  const wedOpen = Date.UTC(2026, 8, 9, 15, 0); // 11:00 ET, session open
  assert.equal(nextMarketClose(wedOpen), Date.UTC(2026, 8, 9, 20, 0) / 1000); // 16:00 EDT
  const now = 1_700_000_000_000;
  assert.equal(longCountdownLabel(now / 1000 + 45, now), '45s');
  assert.equal(longCountdownLabel(now / 1000 + 7 * 60 + 5, now), '7m 05s');
  assert.equal(longCountdownLabel(now / 1000 + 19 * 3600 + 41 * 60 + 3, now), '19h 41m 03s');
  assert.equal(longCountdownLabel(now / 1000 + 2 * 86400 + 3 * 3600 + 12 * 60 + 5, now), '2d 03h 12m 05s');
  assert.equal(longCountdownLabel(now / 1000 - 10, now), '0s');
  assert.equal(newYorkTimeLabel(Date.UTC(2026, 8, 8, 13, 30) / 1000), 'Tue 9:30 AM ET');
});
