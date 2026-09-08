import assert from 'node:assert/strict';
import { test } from 'node:test';
import { publicClient, findConfirmedApproval } from '../../lib/chain.js';
import { buildBatch } from '../../lib/spendPermission.js';
import { STOCKS } from '../../lib/stocks.js';
// The imported native chain module also contains unrelated preview helpers.
declare global { var __DEV__: boolean; }

test('approval confirmation binds the event to the exact permission and rejects revocation or missing tokens', async t => {
  const b=buildBatch({account:`0x${'11'.repeat(20)}`,spender:`0x${'22'.repeat(20)}`,budgetUsdc:25,period:'weekly',durationDays:30,universe:[STOCKS[0].token]});
  const permissionHash=`0x${'33'.repeat(32)}`, tx=`0x${'44'.repeat(32)}`;
  let event=true,revoked=false,missing=false,receipt='success';
  t.mock.method(publicClient,'readContract',async(args:{functionName:string;args:unknown[]})=>{
    const p=args.args[0] as {account:string;token:string;allowance:bigint;salt:bigint};
    assert.equal(p.account,b.account);
    if(args.functionName==='getHash'){
      assert.equal(p.allowance,BigInt(b.permissions[0].allowance));
      assert.equal(p.salt,BigInt(b.permissions[0].salt));return permissionHash;
    }
    if(args.functionName==='isRevoked')return revoked;
    assert.equal(args.functionName,'isApproved');return !(missing && p.token===b.permissions[1].token);
  });
  t.mock.method(publicClient,'getContractEvents',async(args:{eventName:string;args:{hash:string};fromBlock:bigint})=>{
    assert.equal(args.eventName,'SpendPermissionApproved');assert.equal(args.args.hash,permissionHash);assert.equal(args.fromBlock,100n);
    return event?[{transactionHash:tx}]:[];
  });
  t.mock.method(publicClient,'getTransactionReceipt',async()=>({status:receipt}));
  assert.equal(await findConfirmedApproval(b,100n),tx);
  revoked=true;assert.equal(await findConfirmedApproval(b,100n),undefined);
  revoked=false;missing=true;assert.equal(await findConfirmedApproval(b,100n),undefined);
  missing=false;receipt='reverted';assert.equal(await findConfirmedApproval(b,100n),undefined);
  receipt='success';event=false;assert.equal(await findConfirmedApproval(b,100n),undefined);
});
