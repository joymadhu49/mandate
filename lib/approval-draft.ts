import { buildBatch, type SpendPermissionBatch } from './spendPermission';

type Input = Parameters<typeof buildBatch>[0];
export interface ApprovalDraft { key: string; batch: SpendPermissionBatch; signature?: `0x${string}`; approvalTx?: `0x${string}`; callsId?: string; approvalFromBlock?: string }

// Retain approvals and wallet references only for the exact reviewed settings, wallet, backend and
// execution mode. Kept in screen memory only, never in plain device storage.
export function prepareApprovalDraft(previous: ApprovalDraft | undefined, input: Input, context: string): ApprovalDraft {
  const key = JSON.stringify([input, context]);
  if (previous?.key === key && previous.batch.end > Date.now() / 1000) return previous;
  return { key, batch: buildBatch(input) };
}
