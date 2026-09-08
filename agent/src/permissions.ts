import { USDC, encode, permissionFromBatch, spmAbi } from './chain.js';
import type { Address, Hex, Mandate, PermissionDetails, SpendPermissionBatch } from './types.js';

type SignedMandate = Pick<Mandate, 'batch' | 'signature'>;
const validSignature = (s?: string) => !!s && /^0x(?:[0-9a-fA-F]{2})+$/.test(s);

export function hasCompleteSignatures(m: SignedMandate): boolean {
  if (!m.batch.permissions.length) return false;
  const hasIndividual = m.batch.permissions.some((p) => p.signature !== undefined);
  return hasIndividual
    ? m.signature === undefined && m.batch.permissions.every((p) => validSignature(p.signature))
    : validSignature(m.signature);
}

export function approvalRequests(m: SignedMandate): { data: `0x${string}`; permission?: PermissionDetails }[] {
  if (!hasCompleteSignatures(m)) throw new Error('Every token requires its own valid permission signature.');
  if (m.batch.permissions.every((p) => p.signature)) {
    return m.batch.permissions.map((permission) => ({
      permission,
      data: encode({ abi: spmAbi, functionName: 'approveWithSignature', args: [permissionFromBatch(m.batch, permission), permission.signature!] }),
    }));
  }
  // Preserve support for existing stored mandates signed by batch-capable wallets.
  return [{ data: encode({
    abi: spmAbi, functionName: 'approveBatchWithSignature', args: [{
      account: m.batch.account, period: m.batch.period, start: m.batch.start, end: m.batch.end,
      permissions: m.batch.permissions.map((p) => ({
        spender: p.spender, token: p.token, allowance: BigInt(p.allowance), salt: BigInt(p.salt), extraData: p.extraData,
      })),
    }, m.signature!],
  }) }];
}

export const permissionFor = (batch: SpendPermissionBatch, token: string) => batch.permissions.find((p) => p.token.toLowerCase() === token.toLowerCase());

/** True when a live sell of `token` under this mandate still needs the owner's one-time sell approval. */
export function sellApprovalNeeded(m: Pick<Mandate, 'batch' | 'executionMode'>, token: string, dryRun: boolean): boolean {
  return !dryRun && m.executionMode === 'live' && !permissionFor(m.batch, token);
}

/**
 * Validates a sell permission the owner signs after creating a chat mandate and stores it beside the USDC permission.
 * The chain verifies the signature when the agent registers it; here we bind the request to this mandate, its agent
 * and its stocks. A token that is already covered keeps its first signature: a repeated prompt never replaces it.
 */
export function addSellPermission(m: Mandate, input: PermissionDetails & { signature: Hex }, spender: Address, now: number): { permission: PermissionDetails; added: boolean } {
  if (m.executionMode !== 'live') throw new Error('Simulation mandates need no sell approval.');
  if (m.status !== 'active' && m.status !== 'pending') throw new Error('This mandate is no longer active. Create a new mandate.');
  if (m.batch.end <= now) throw new Error('This mandate has expired. Create a new mandate.');
  if (m.signature || m.batch.permissions.some((p) => !p.signature)) throw new Error('This mandate was approved in one step. Create a new mandate to add sell permissions.');
  if (input.spender.toLowerCase() !== spender.toLowerCase()) throw new Error('The permission must name this agent as spender.');
  const inMandate = m.universe.some((t) => t.toLowerCase() === input.token.toLowerCase());
  if (!inMandate || input.token.toLowerCase() === USDC.toLowerCase()) throw new Error('That stock is not part of this mandate.');
  if (BigInt(input.allowance) <= 0n) throw new Error('The sell allowance must be positive.');
  const existing = permissionFor(m.batch, input.token);
  if (existing) return { permission: existing, added: false };
  const permission: PermissionDetails = { spender: input.spender, token: input.token, allowance: input.allowance, salt: input.salt, extraData: input.extraData, signature: input.signature };
  m.batch.permissions.push(permission);
  return { permission, added: true };
}
