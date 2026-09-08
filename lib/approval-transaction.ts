import { encodeFunctionData, parseAbi } from 'viem';
import { SPEND_PERMISSION_MANAGER, type Address } from './stocks';
import { permissionTypedData, type SpendPermissionBatch } from './spendPermission';

type Hex = `0x${string}`;
export const walletBatchAbi = parseAbi([
  'struct Call { address target; uint256 value; bytes data; }',
  'function executeBatch(Call[] calls) payable',
]);
export const directApprovalAbi = parseAbi([
  'struct SpendPermission { address account; address spender; address token; uint160 allowance; uint48 period; uint48 start; uint48 end; uint256 salt; bytes extraData; }',
  'function approve(SpendPermission permission) returns (bool)',
  'function getHash(SpendPermission permission) view returns (bytes32)',
  'function isApproved(SpendPermission permission) view returns (bool)',
  'function isRevoked(SpendPermission permission) view returns (bool)',
  'event SpendPermissionApproved(bytes32 indexed hash, SpendPermission spendPermission)',
]);
export function buildApprovalTransaction(batch: SpendPermissionBatch) {
  if (!batch.permissions.length) throw new Error('Select stocks before approving a mandate.');
  const calls = batch.permissions.map(permission => {
    const p = permissionTypedData(batch, permission).message;
    return {
      target: SPEND_PERMISSION_MANAGER, value: 0n,
      data: encodeFunctionData({ abi: directApprovalAbi, functionName: 'approve', args: [{ ...p, allowance: BigInt(p.allowance), salt: BigInt(p.salt) }] }),
    };
  });
  // A wallet self-call is explicitly authorized by CoinbaseSmartWallet's
  // onlyEntryPointOrOwner modifier. Each nested approve is called by its owner.
  return { to: batch.account, value: '0x0' as const, data: encodeFunctionData({ abi: walletBatchAbi, functionName: 'executeBatch', args: [calls] }) };
}

interface IO {
  send: (account: Address, tx: ReturnType<typeof buildApprovalTransaction>) => Promise<Hex>;
  wait: (hash: Hex) => Promise<{ status: string }>;
  isApproved: (batch: SpendPermissionBatch) => Promise<boolean>;
}
export async function confirmApprovalTransaction(
  batch: SpendPermissionBatch,
  state: { approvalTx?: Hex },
  io: IO,
  onSubmitted?: (hash: Hex) => void,
): Promise<Hex> {
  if (!state.approvalTx) state.approvalTx = await io.send(batch.account, buildApprovalTransaction(batch));
  const hash = state.approvalTx;
  onSubmitted?.(hash);
  let receipt;
  try { receipt = await io.wait(hash); }
  catch { throw new Error('Still waiting for confirmation on Base. Tap Check approval to continue without approving again.'); }
  if (receipt.status !== 'success') {
    state.approvalTx = undefined;
    throw new Error('The approval transaction failed. You can try again.');
  }
  let approved;
  try { approved = await io.isApproved(batch); }
  catch { throw new Error('Could not check the permissions on Base. Tap Check approval to try again.'); }
  // ERC-4337 receipts can succeed even when the inner user operation failed.
  if (!approved) {
    state.approvalTx = undefined;
    throw new Error('The transaction did not enable all mandate permissions. You can try again.');
  }
  return hash;
}
