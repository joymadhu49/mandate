import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeFunctionData, hashTypedData, type TypedData } from 'viem';
import { buildBatch, permissionFor, permissionTypedData, sellPermission, signPermissions } from '../../lib/spendPermission.js';
import { STOCKS, USDC } from '../../lib/stocks.js';
import { spmAbi } from './chain.js';
import { approvalRequests, hasCompleteSignatures } from './permissions.js';

const account = '0x0000000000000000000000000000000000000001' as const;
const spender = '0x0000000000000000000000000000000000000002' as const;
const params = { account, spender, budgetUsdc: 100, period: 'weekly' as const, universe: [STOCKS[0].token, STOCKS[1].token], durationDays: 30 };

// The mobile RPC uses decimal strings; viem's generic EIP-712 encoder supports
// that JSON representation as well as the bigint fields decoded from the ABI.
const digest = (data: { domain: ReturnType<typeof permissionTypedData>['domain']; types: TypedData; primaryType: string; message: Record<string, unknown> }) => hashTypedData(data);

test('mobile permission requests match Coinbase’s individual SpendPermission schema', () => {
  const batch = buildBatch(params);
  assert.equal(batch.permissions.length, 3);
  assert.equal(batch.permissions[0].token, USDC);
  assert.equal(batch.permissions[0].allowance, '100000000');
  for (const permission of batch.permissions) {
    const data = permissionTypedData(batch, permission);
    assert.equal(data.primaryType, 'SpendPermission');
    assert.deepEqual(data.types.SpendPermission, [
      { name: 'account', type: 'address' }, { name: 'spender', type: 'address' },
      { name: 'token', type: 'address' }, { name: 'allowance', type: 'uint160' },
      { name: 'period', type: 'uint48' }, { name: 'start', type: 'uint48' },
      { name: 'end', type: 'uint48' }, { name: 'salt', type: 'uint256' }, { name: 'extraData', type: 'bytes' },
    ]);
    assert.equal(Object.keys(data.message).length, 9);
    assert.equal(data.message.token, permission.token);
    assert.equal(data.message.period, 604800);
    assert.equal(data.message.account, account);
    assert.equal(data.message.spender, spender);
    assert.doesNotThrow(() => JSON.stringify(data));
    assert.match(digest(data), /^0x[0-9a-f]{64}$/);
  }
  assert.notEqual(batch.permissions[0].salt, buildBatch(params).permissions[0].salt);
});

test('individual signatures are paired with the same token and onchain digest', async () => {
  const batch = buildBatch(params);
  const hashes: string[] = [];
  const progress: number[] = [];
  const signed = await signPermissions(batch, async (owner, data) => {
    assert.equal(owner, account);
    hashes.push(digest(data));
    return `0x${String(hashes.length).padStart(2, '0')}`;
  }, (index, total) => { assert.equal(total, 3); progress.push(index); });
  assert.deepEqual(progress, [1, 2, 3]);
  assert.ok(batch.permissions.every((p) => !p.signature));
  assert.equal(hasCompleteSignatures({ batch: signed }), true);
  const requests = approvalRequests({ batch: signed });
  assert.equal(requests.length, 3);
  for (const [index, request] of requests.entries()) {
    const decoded = decodeFunctionData({ abi: spmAbi, data: request.data });
    assert.equal(decoded.functionName, 'approveWithSignature');
    if (decoded.functionName !== 'approveWithSignature') throw new Error('wrong approval method');
    const [permission, signature] = decoded.args;
    assert.equal(permission.token.toLowerCase(), signed.permissions[index].token.toLowerCase());
    assert.equal(signature, signed.permissions[index].signature);
    const data = permissionTypedData(signed, signed.permissions[index]);
    assert.equal(digest({ ...data, message: permission }), hashes[index]);
  }
});

test('cancellation stops subsequent wallet prompts and leaves original batch unsigned', async () => {
  const batch = buildBatch(params);
  let prompts = 0;
  await assert.rejects(signPermissions(batch, async () => {
    if (++prompts === 2) throw new Error('User rejected the request');
    return '0x01';
  }), /rejected/);
  assert.equal(prompts, 2);
  assert.ok(batch.permissions.every((p) => !p.signature));
  assert.equal(hasCompleteSignatures({ batch }), false);
});

test('partial, empty and mixed signature formats are rejected before registration', () => {
  const batch = buildBatch(params);
  assert.throws(() => approvalRequests({ batch }), /Every token/);
  const partial = { ...batch, permissions: batch.permissions.map((p, i) => ({ ...p, signature: i === 0 ? '0x01' as const : undefined })) };
  assert.equal(hasCompleteSignatures({ batch: partial }), false);
  assert.equal(hasCompleteSignatures({ batch: partial, signature: '0x02' }), false);
  assert.equal(hasCompleteSignatures({ batch: { ...batch, permissions: [] }, signature: '0x01' }), false);
});

test('existing legacy batch signatures retain their original registration method', () => {
  const batch = buildBatch(params);
  const requests = approvalRequests({ batch, signature: '0x01' });
  assert.equal(requests.length, 1);
  assert.equal(decodeFunctionData({ abi: spmAbi, data: requests[0].data }).functionName, 'approveBatchWithSignature');
});

test('an interrupted setup resumes at the next token with identical signed digests', async () => {
  const original = buildBatch(params);
  let checkpoint = original;
  const approvedDigest = digest(permissionTypedData(original, original.permissions[0]));
  let prompts = 0;
  await assert.rejects(signPermissions(original, async () => {
    if (++prompts === 2) throw new Error('Wallet closed');
    return '0x01';
  }, undefined, next => { checkpoint = next; }), /closed/);
  assert.equal(checkpoint.permissions[0].signature, '0x01');
  assert.equal(checkpoint.permissions[1].signature, undefined);
  assert.ok(original.permissions.every(p => !p.signature));
  const remaining: string[] = [];
  const signed = await signPermissions(checkpoint, async (_account, data) => {
    remaining.push(data.message.token);
    return '0x02';
  });
  assert.deepEqual(remaining, params.universe);
  assert.equal(digest(permissionTypedData(signed, signed.permissions[0])), approvedDigest);
  assert.equal(hasCompleteSignatures({ batch: signed }), true);
  assert.equal(checkpoint.permissions[1].signature, undefined, 'older checkpoint is immutable');
  assert.equal(await signPermissions(signed, async () => { throw new Error('must not prompt again'); }).then(b => hasCompleteSignatures({ batch: b })), true);
});

test('invalid signature never enters a resumable checkpoint', async () => {
  let checkpoints = 0;
  await assert.rejects(signPermissions(buildBatch(params), async () => '0x', undefined, () => checkpoints++), /valid permission/);
  assert.equal(checkpoints, 0);
});

test('six-stock setup resumes its seven individual permissions and save retry never signs again', async () => {
  let draft = buildBatch({ ...params, universe: STOCKS.slice(0, 6).map(s => s.token) });
  const original = draft;
  let calls = 0;
  const progress: number[] = [];
  await assert.rejects(signPermissions(draft, async (_address, data) => {
    assert.equal(data.primaryType, 'SpendPermission');
    assert.equal(data.message.salt, original.permissions[0].salt);
    if (++calls === 4) throw new Error('Cancelled in Coinbase');
    return '0x01';
  }, (index, total) => { assert.equal(total, 7); progress.push(index); }, checkpoint => { draft = checkpoint; }), /Cancelled/);
  assert.equal(draft.permissions.filter(p => p.signature).length, 3);
  const remaining: string[] = [];
  draft = await signPermissions(draft, async (_address, data) => {
    remaining.push(data.message.token);
    return '0x02';
  }, (index, total) => { assert.equal(total, 7); progress.push(index); }, checkpoint => { draft = checkpoint; });
  assert.deepEqual(remaining, original.permissions.slice(3).map(p => p.token));
  assert.deepEqual(progress, [1, 2, 3, 4, 4, 5, 6, 7]);
  assert.equal(hasCompleteSignatures({ batch: draft }), true);
  await signPermissions(draft, async () => { throw new Error('save retry must not sign'); });
});

test('chat mandates sign USDC alone and add each stock’s sell permission on its first sell', () => {
  const batch = buildBatch({ ...params, includeSellPermissions: false });
  assert.equal(batch.permissions.length, 1);
  assert.equal(batch.permissions[0].token, USDC);
  assert.equal(permissionFor(batch, STOCKS[0].token), undefined);
  const sell = sellPermission(batch, STOCKS[0].token);
  assert.equal(sell.spender, spender);
  assert.equal(sell.salt, batch.permissions[0].salt);
  assert.equal(sell.allowance, ((1n << 160n) - 1n).toString());
  const data = permissionTypedData(batch, sell);
  assert.equal(data.primaryType, 'SpendPermission');
  assert.equal(data.message.token, STOCKS[0].token);
  assert.equal(data.message.start, batch.start);
  assert.equal(data.message.end, batch.end);
  assert.notEqual(digest(data), digest(permissionTypedData(batch, batch.permissions[0])));
  const extended = { ...batch, permissions: [...batch.permissions, { ...sell, signature: '0xab' as const }] };
  assert.ok(permissionFor(extended, STOCKS[0].token.toLowerCase()));
  assert.throws(() => sellPermission(extended, STOCKS[0].token), /already/);
  assert.equal(hasCompleteSignatures({ batch: { ...extended, permissions: extended.permissions.map(p => ({ ...p, signature: '0xab' as const })) } }), true);
  assert.equal(approvalRequests({ batch: { ...extended, permissions: [extended.permissions[1]] } }).length, 1);
});
