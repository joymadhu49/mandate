import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeFunctionData } from 'viem';
import { buildBatch } from '../../lib/spendPermission.js';
import { STOCKS, SPEND_PERMISSION_MANAGER } from '../../lib/stocks.js';
import { buildApprovalTransaction, confirmApprovalTransaction, walletBatchAbi, directApprovalAbi } from '../../lib/approval-transaction.js';
const account = `0x${'11'.repeat(20)}` as const;
const batch = () => buildBatch({ account, spender: `0x${'22'.repeat(20)}`, budgetUsdc:25, period:'weekly', durationDays:30, universe:STOCKS.slice(0,6).map(s=>s.token) });
const hash = `0x${'33'.repeat(32)}` as const;
test('one wallet transaction contains exactly the seven reviewed permission approvals', () => {
  const b=batch(), tx=buildApprovalTransaction(b);
  assert.equal(tx.to, account); assert.equal(tx.value,'0x0');
  const decoded=decodeFunctionData({abi:walletBatchAbi,data:tx.data});
  assert.equal(decoded.functionName,'executeBatch');
  assert.equal(decoded.args[0].length,7);
  for(const [i,call] of decoded.args[0].entries()) {
    assert.equal(call.target.toLowerCase(),SPEND_PERMISSION_MANAGER.toLowerCase());assert.equal(call.value,0n);
    const permission=decodeFunctionData({abi:directApprovalAbi,data:call.data});
    assert.equal(permission.functionName,'approve');
    assert.equal(permission.args[0].account.toLowerCase(),account.toLowerCase());
    assert.equal(permission.args[0].token.toLowerCase(),b.permissions[i].token.toLowerCase());
    assert.equal(permission.args[0].allowance,BigInt(b.permissions[i].allowance));
    assert.equal(permission.args[0].period,b.period);
  }
});
test('receipt timeout preserves the hash and retry checks confirmation without sending again', async () => {
  const state:{approvalTx?:typeof hash}={};let sends=0,waits=0;
  const io={send:async()=>{sends++;return hash;},wait:async()=>{if(++waits===1)throw new Error('timeout');return {status:'success' as const};},isApproved:async()=>true};
  await assert.rejects(confirmApprovalTransaction(batch(),state,io),/confirmation/);
  assert.equal(state.approvalTx,hash);
  assert.equal(await confirmApprovalTransaction(batch(),state,io),hash);
  assert.equal(sends,1);
});
test('outer receipt success with missing permissions is not treated as successful approval', async () => {
  const state={approvalTx:hash};
  await assert.rejects(confirmApprovalTransaction(batch(),state,{send:async()=>hash,wait:async()=>({status:'success'}),isApproved:async()=>false}),/permissions/);
  assert.equal(state.approvalTx,undefined);
});
