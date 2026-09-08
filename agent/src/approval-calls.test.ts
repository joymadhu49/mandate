import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeFunctionData } from 'viem';
import { approvalCallsRequest, callsIdFromResponse, confirmApprovalCalls, type ApprovalCallsState } from '../../lib/approval-calls.js';
import { directApprovalAbi } from '../../lib/approval-transaction.js';
import { buildBatch } from '../../lib/spendPermission.js';
import { STOCKS, SPEND_PERMISSION_MANAGER } from '../../lib/stocks.js';
const batch = () => buildBatch({ account: `0x${'11'.repeat(20)}`, spender: `0x${'22'.repeat(20)}`, budgetUsdc:25, period:'weekly', durationDays:30, universe:STOCKS.slice(0,6).map(s=>s.token) });
const tx = `0x${'33'.repeat(32)}` as const;
test('approval uses the atomic calls RPC with every exact token allowance', () => {
  const b=batch(), request=approvalCallsRequest(b), params=request.params[0];
  assert.equal(request.method,'wallet_sendCalls');assert.equal(params.atomicRequired,true);
  assert.equal(params.chainId,'0x2105');assert.equal(params.version,'2.0.0');assert.equal(params.from,b.account);
  assert.equal(params.calls.length,7);
  params.calls.forEach((call,i)=>{
    assert.equal(call.to,SPEND_PERMISSION_MANAGER);assert.equal(call.value,'0x0');
    const decoded=decodeFunctionData({abi:directApprovalAbi,data:call.data});
    assert.equal(decoded.functionName,'approve');
    const p=decoded.args![0] as {account:string;token:string;allowance:bigint};
    assert.equal(p.account.toLowerCase(),b.account.toLowerCase());
    assert.equal(p.token.toLowerCase(),b.permissions[i].token.toLowerCase());
    assert.equal(p.allowance,BigInt(b.permissions[i].allowance));
  });
});
test('wallet result formats are opaque calls IDs and never assumed transaction hashes', () => {
  for(const response of ['opaque',{id:'opaque'},{batchId:'opaque'}]) assert.equal(callsIdFromResponse(response),'opaque');
  for(const response of [null,{},'',123,{id:12}]) assert.throws(()=>callsIdFromResponse(response),/reference/);
});
test('pending batch retries poll the same permission without another wallet request', async () => {
  const state:ApprovalCallsState={};let sends=0, confirmed=false;
  const io={blockNumber:async()=>100n,send:async()=>{sends++;return{id:'opaque'};},findConfirmed:async()=>confirmed?tx:undefined,wait:async()=>{}};
  await assert.rejects(confirmApprovalCalls(batch(),state,io),/pending/);
  assert.equal(state.callsId,'opaque');assert.equal(state.approvalTx,undefined);
  confirmed=true;
  assert.equal(await confirmApprovalCalls(batch(),state,io),tx);assert.equal(sends,1);
});
test('a lost callback is recovered from the exact approval event before asking again', async () => {
  const state:ApprovalCallsState={approvalFromBlock:'100'};
  const hash=await confirmApprovalCalls(batch(),state,{blockNumber:async()=>200n,send:async()=>{throw Error('must not send');},findConfirmed:async(_b,from)=>{assert.equal(from,100n);return tx;},wait:async()=>{}});
  assert.equal(hash,tx);assert.equal(state.approvalTx,tx);
});
