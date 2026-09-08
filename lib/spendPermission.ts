// Spend Permissions: the user's Base Account grants our agent ("spender") the right to
// pull a bounded amount of a token per period, enforced onchain by SpendPermissionManager.
// The user can revoke at any time from account.base.app. No keys ever leave the user.
// Coinbase's wallet signs one SpendPermission per token and rejects batch signatures and
// direct permission-manager transactions. Automatic mandates therefore sign USDC plus every
// stock up front. Chat mandates sign USDC only; each stock's sell allowance is added the
// first time the owner confirms a sell of that stock (see sellPermission).
import { parseUnits, toHex, type TypedData } from 'viem';
import { CHAIN_ID, SPEND_PERMISSION_MANAGER, USDC, type Address } from './stocks';

export interface PermissionDetails {
  spender: Address;
  token: Address;
  allowance: string; // uint160 as decimal string
  salt: string; // uint256 as decimal string
  extraData: `0x${string}`;
  signature?: `0x${string}`;
}

export interface SpendPermissionBatch {
  account: Address;
  period: number; // seconds
  start: number; // unix seconds
  end: number; // unix seconds
  permissions: PermissionDetails[];
}

export const PERIODS = {
  daily: 86400,
  weekly: 7 * 86400,
  monthly: 30 * 86400,
} as const;
export type PeriodKey = keyof typeof PERIODS;

const MAX_UINT160 = (1n << 160n) - 1n;

/**
 * Build one batch: a USDC budget (what the agent may spend to BUY) plus, when
 * `includeSellPermissions` is not false, an effectively-unbounded allowance for each stock in
 * the universe so the agent can SELL positions it manages. Selling is still capped by what
 * the user actually holds. Chat mandates pass false and add sell allowances on first sell.
 */
export function buildBatch(params: {
  account: Address;
  spender: Address;
  budgetUsdc: number;
  period: PeriodKey;
  universe: Address[];
  durationDays: number;
  includeSellPermissions?: boolean;
}): SpendPermissionBatch {
  const now = Math.floor(Date.now() / 1000);
  const salt = BigInt(toHex(globalThis.crypto.getRandomValues(new Uint8Array(32)))).toString();
  const sells = params.includeSellPermissions === false ? [] : params.universe;
  const permissions: PermissionDetails[] = [
    {
      spender: params.spender,
      token: USDC,
      allowance: parseUnits(params.budgetUsdc.toString(), 6).toString(),
      salt,
      extraData: '0x',
    },
    ...sells.map((token) => ({
      spender: params.spender,
      token,
      allowance: MAX_UINT160.toString(),
      salt,
      extraData: '0x' as const,
    })),
  ];
  return {
    account: params.account,
    period: PERIODS[params.period],
    start: now - 60,
    end: now + params.durationDays * 86400,
    permissions,
  };
}

/** The permission covering `token` in this batch, if the owner has signed one. */
export function permissionFor(batch: SpendPermissionBatch, token: string): PermissionDetails | undefined {
  return batch.permissions.find(p => p.token.toLowerCase() === token.toLowerCase());
}

/**
 * The sell allowance a chat mandate adds the first time a stock is sold. It reuses the reviewed
 * batch's spender, period, expiry and salt, so the backend stores it beside the USDC permission
 * and the contract hash stays unique per token.
 */
export function sellPermission(batch: SpendPermissionBatch, token: Address): PermissionDetails {
  const base = batch.permissions[0];
  if (!base) throw new Error('This mandate has no spending permission to extend.');
  if (permissionFor(batch, token)) throw new Error('This mandate already allows selling that stock.');
  return { spender: base.spender, token, allowance: MAX_UINT160.toString(), salt: base.salt, extraData: '0x' };
}

export function permissionTypedData(batch: SpendPermissionBatch, permission: PermissionDetails) {
  return {
    domain: {
      name: 'Spend Permission Manager',
      version: '1',
      chainId: CHAIN_ID,
      verifyingContract: SPEND_PERMISSION_MANAGER,
    },
    types: {
      EIP712Domain: [
        { name: 'name', type: 'string' },
        { name: 'version', type: 'string' },
        { name: 'chainId', type: 'uint256' },
        { name: 'verifyingContract', type: 'address' },
      ],
      SpendPermission: [
        { name: 'account', type: 'address' },
        { name: 'spender', type: 'address' },
        { name: 'token', type: 'address' },
        { name: 'allowance', type: 'uint160' },
        { name: 'period', type: 'uint48' },
        { name: 'start', type: 'uint48' },
        { name: 'end', type: 'uint48' },
        { name: 'salt', type: 'uint256' },
        { name: 'extraData', type: 'bytes' },
      ],
    },
    primaryType: 'SpendPermission' as const,
    message: {
      account: batch.account,
      spender: permission.spender,
      token: permission.token,
      allowance: permission.allowance,
      period: batch.period,
      start: batch.start,
      end: batch.end,
      salt: permission.salt,
      extraData: permission.extraData,
    },
  };
}

/** Exact schema used by SpendPermissionManager.getBatchHash on Base. */
export function batchTypedData(batch: SpendPermissionBatch) {
  return {
    domain: { name: 'Spend Permission Manager', version: '1', chainId: CHAIN_ID, verifyingContract: SPEND_PERMISSION_MANAGER },
    types: {
      EIP712Domain: [
        { name: 'name', type: 'string' }, { name: 'version', type: 'string' },
        { name: 'chainId', type: 'uint256' }, { name: 'verifyingContract', type: 'address' },
      ],
      SpendPermissionBatch: [
        { name: 'account', type: 'address' }, { name: 'period', type: 'uint48' },
        { name: 'start', type: 'uint48' }, { name: 'end', type: 'uint48' },
        { name: 'permissions', type: 'PermissionDetails[]' },
      ],
      PermissionDetails: [
        { name: 'spender', type: 'address' }, { name: 'token', type: 'address' },
        { name: 'allowance', type: 'uint160' }, { name: 'salt', type: 'uint256' },
        { name: 'extraData', type: 'bytes' },
      ],
    } as TypedData,
    primaryType: 'SpendPermissionBatch' as const,
    message: {
      account: batch.account, period: batch.period, start: batch.start, end: batch.end,
      permissions: batch.permissions.map(({ spender, token, allowance, salt, extraData }) => ({ spender, token, allowance, salt, extraData })),
    },
  };
}

export async function signBatch(
  batch: SpendPermissionBatch,
  sign: (account: Address, data: ReturnType<typeof batchTypedData>) => Promise<`0x${string}`>,
): Promise<`0x${string}`> {
  if (!batch.permissions.length || batch.permissions.some(p => p.signature !== undefined)) {
    throw new Error('Review a new mandate before requesting its combined approval.');
  }
  const signature = await sign(batch.account, batchTypedData(batch));
  if (typeof signature !== 'string' || !/^0x(?:[0-9a-fA-F]{2})+$/.test(signature)) {
    throw new Error('Coinbase did not return a valid mandate signature. Please try again.');
  }
  return signature;
}

// Keep signatures attached to the exact token request they authorize. Submit only
// after every wallet prompt succeeds; cancellation never sends a partial mandate.
export async function signPermissions(
  batch: SpendPermissionBatch,
  sign: (account: Address, data: ReturnType<typeof permissionTypedData>) => Promise<`0x${string}`>,
  onProgress?: (index: number, total: number, token: Address) => void,
  onCheckpoint?: (batch: SpendPermissionBatch) => void,
): Promise<SpendPermissionBatch> {
  const permissions = batch.permissions.map(permission => ({ ...permission }));
  for (const [index, permission] of batch.permissions.entries()) {
    if (permission.signature && /^0x(?:[0-9a-fA-F]{2})+$/.test(permission.signature)) continue;
    onProgress?.(index + 1, batch.permissions.length, permission.token);
    const signature = await sign(batch.account, permissionTypedData(batch, permission));
    if (!/^0x(?:[0-9a-fA-F]{2})+$/.test(signature)) throw new Error('The wallet did not return a valid permission signature.');
    permissions[index] = { ...permission, signature };
    onCheckpoint?.({ ...batch, permissions: permissions.map(p => ({ ...p })) });
  }
  return { ...batch, permissions };
}

export const hexChainId = toHex(CHAIN_ID);
