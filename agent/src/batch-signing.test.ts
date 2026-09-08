import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeFunctionData, hashTypedData, recoverTypedDataAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { buildBatch, batchTypedData, signBatch } from '../../lib/spendPermission.js';
import { STOCKS } from '../../lib/stocks.js';
import { approvalRequests, hasCompleteSignatures } from './permissions.js';
import { spmAbi } from './chain.js';
const owner = privateKeyToAccount(`0x${'11'.repeat(32)}`); // Synthetic test identity only.
const batch = () => buildBatch({ account: owner.address, spender: `0x${'22'.repeat(20)}`, budgetUsdc: 25, period: 'weekly', universe: STOCKS.slice(0,6).map(s=>s.token), durationDays: 30 });

test('seven token permissions use exactly one signature and one batch registration call', async () => {
  const b = batch(); let prompts = 0;
  const signature = await signBatch(b, async (account, data) => {
    prompts++;
    assert.equal(account, owner.address);
    return owner.signTypedData(data);
  });
  assert.equal(prompts, 1);
  assert.equal(b.permissions.length, 7);
  assert.ok(b.permissions.every(p=>!p.signature));
  assert.equal(hasCompleteSignatures({ batch: b, signature }), true);
  const requests = approvalRequests({ batch: b, signature });
  assert.equal(requests.length, 1);
  const decoded = decodeFunctionData({ abi: spmAbi, data: requests[0].data });
  assert.equal(decoded.functionName, 'approveBatchWithSignature');
  if (decoded.functionName !== 'approveBatchWithSignature') throw new Error('Wrong registration');
  const data = batchTypedData(b);
  assert.equal(hashTypedData({ ...data, message: decoded.args[0] }), hashTypedData(data));
  assert.equal(await recoverTypedDataAddress({ ...data, signature }), owner.address);
  assert.notEqual(hashTypedData(batchTypedData({ ...b, end: b.end + 1 })), hashTypedData(data));
  const changed = { ...b, permissions: b.permissions.map((p,i)=>i===0?{...p,allowance:'50000000'}:p) };
  assert.notEqual(hashTypedData(batchTypedData(changed)), hashTypedData(data));
});

test('batch cancellation or invalid signature cannot produce a signed mandate', async () => {
  for (const sign of [async () => { throw new Error('cancelled'); }, async () => '0x' as const]) {
    await assert.rejects(signBatch(batch(), sign));
  }
  await assert.rejects(signBatch({ ...batch(), permissions: [] }, async () => '0x01'));
});
