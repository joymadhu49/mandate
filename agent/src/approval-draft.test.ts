import assert from 'node:assert/strict';
import { test } from 'node:test';
import { prepareApprovalDraft } from '../../lib/approval-draft.js';
import { STOCKS } from '../../lib/stocks.js';
const input = {
  account: '0x0000000000000000000000000000000000000001' as const,
  spender: '0x0000000000000000000000000000000000000002' as const,
  budgetUsdc: 25, period: 'weekly' as const, universe: [STOCKS[0].token], durationDays: 30,
};
test('retry retains exact dates, salt and approvals for unchanged reviewed settings', () => {
  const draft = prepareApprovalDraft(undefined, input, 'backend/live/chat');
  draft.batch.permissions[0].signature = '0x01';
  draft.signature = '0x02';
  draft.approvalTx = '0x03';
  draft.callsId = 'opaque';
  draft.approvalFromBlock = '100';
  assert.equal(prepareApprovalDraft(draft, { ...input }, 'backend/live/chat'), draft);
  assert.equal(prepareApprovalDraft(draft, { ...input }, 'backend/live/chat').signature, '0x02');
  assert.equal(prepareApprovalDraft(draft, { ...input }, 'backend/live/chat').approvalTx, '0x03');
});
test('changed wallet, spender, budget, tokens, dates, period or context requires fresh approvals', () => {
  const draft = prepareApprovalDraft(undefined, input, 'backend/live/chat');
  draft.batch.permissions[0].signature = '0x01';
  draft.signature = '0x02';
  draft.approvalTx = '0x03';
  draft.callsId = 'opaque';
  draft.approvalFromBlock = '100';
  for (const update of [
    { account: input.spender }, { spender: input.account }, { budgetUsdc: 50 },
    { universe: [STOCKS[1].token] }, { durationDays: 7 }, { period: 'daily' as const },
  ]) {
    const next = prepareApprovalDraft(draft, { ...input, ...update }, 'backend/live/chat');
    assert.notEqual(next.batch.permissions[0].salt, draft.batch.permissions[0].salt);
    assert.ok(next.batch.permissions.every(p => !p.signature));
    assert.equal(next.signature, undefined);
    assert.equal(next.approvalTx, undefined);
    assert.equal(next.callsId, undefined);
    assert.equal(next.approvalFromBlock, undefined);
  }
  for (const context of ['other-backend/live/chat', 'backend/simulation/chat', 'backend/live/automatic']) {
    assert.notEqual(prepareApprovalDraft(draft, input, context), draft);
  }
});
test('expired approvals are not resumed', () => {
  const draft = prepareApprovalDraft(undefined, input, 'context');
  draft.batch.end = 1;
  assert.notEqual(prepareApprovalDraft(draft, input, 'context'), draft);
});
