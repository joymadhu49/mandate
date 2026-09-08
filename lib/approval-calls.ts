import { encodeFunctionData, toHex } from 'viem';
import { directApprovalAbi } from './approval-transaction';
import { permissionTypedData, type SpendPermissionBatch } from './spendPermission';
import { CHAIN_ID, SPEND_PERMISSION_MANAGER } from './stocks';

type Hex = `0x${string}`;
export function approvalCallsRequest(batch: SpendPermissionBatch) {
  if (!batch.permissions.length) throw new Error('Select stocks before approving a mandate.');
  return { method: 'wallet_sendCalls' as const, params: [{
    version: '2.0.0', from: batch.account, chainId: toHex(CHAIN_ID), atomicRequired: true,
    calls: batch.permissions.map(permission => {
      const p = permissionTypedData(batch, permission).message;
      return { to: SPEND_PERMISSION_MANAGER, value: '0x0', data: encodeFunctionData({
        abi: directApprovalAbi, functionName: 'approve', args: [{ ...p, allowance: BigInt(p.allowance), salt: BigInt(p.salt) }],
      }) };
    }),
  }] };
}

export function callsIdFromResponse(response: unknown): string {
  const object = response && typeof response === 'object' ? response as { id?: unknown; batchId?: unknown } : undefined;
  const id = typeof response === 'string' ? response : object?.id ?? object?.batchId;
  if (typeof id !== 'string' || !id.length || id.length > 2048) throw new Error('Coinbase did not return an approval batch reference.');
  return id;
}

export interface ApprovalCallsState { callsId?: string; approvalFromBlock?: string; approvalTx?: Hex }
interface IO {
  blockNumber: () => Promise<bigint>;
  send: (request: ReturnType<typeof approvalCallsRequest>) => Promise<unknown>;
  findConfirmed: (batch: SpendPermissionBatch, fromBlock: bigint) => Promise<Hex | undefined>;
  wait: () => Promise<void>;
}
// Calls IDs are opaque wallet references, never Ethereum transaction hashes.
// The chain event binds the discovered receipt to the exact reviewed permission.
export async function confirmApprovalCalls(batch: SpendPermissionBatch, state: ApprovalCallsState, io: IO, onSubmitted?: () => void): Promise<Hex> {
  if (!state.approvalFromBlock) state.approvalFromBlock = (await io.blockNumber()).toString();
  const from = BigInt(state.approvalFromBlock);
  // Recover a confirmed approval when the wallet callback/save response was lost.
  const find = async () => {
    try { return await io.findConfirmed(batch, from); }
    catch { throw new Error('Could not check the approval on Base. Your draft is saved; try again.'); }
  };
  const existing = await find();
  if (existing) { state.approvalTx = existing; return existing; }
  if (!state.callsId) state.callsId = callsIdFromResponse(await io.send(approvalCallsRequest(batch)));
  onSubmitted?.();
  for (let attempt = 0; attempt < 15; attempt++) {
    const hash = await find();
    if (hash) { state.approvalTx = hash; return hash; }
    await io.wait();
  }
  throw new Error('Approval is still pending on Base. Tap Check approval to continue without approving again.');
}
