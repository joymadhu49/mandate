import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { verifyMessage } from 'viem';
import { buildBatch } from '../../lib/spendPermission.js';
import { STOCKS } from '../../lib/stocks.js';

test('unsigned mandates require authenticated ownership and confirmed exact onchain permissions', async t => {
  const dir=mkdtempSync(join(tmpdir(),'mandate-onchain-test-'));
  process.env.DB_PATH=join(dir,'db.json');process.env.NODE_ENV='test';process.env.AGENT_PRIVATE_KEY=generatePrivateKey();process.env.OPENROUTER_API_KEY='';
  const {app}=await import('./app.js'); const {config}=await import('./config.js'); const {publicClient,spenderFor}=await import('./chain.js');
  const {db}=await import('./db.js');config.dryRun=false;
  t.after(()=>{config.dryRun=true;rmSync(dir,{recursive:true,force:true});});
  t.mock.method(publicClient,'verifyMessage',async(args:Parameters<typeof publicClient.verifyMessage>[0])=>verifyMessage(args));
  const owner=privateKeyToAccount(generatePrivateKey());
  const request=(path:string,body?:object,token?:string)=>app.request(path,{method:body?'POST':'GET',headers:{'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})},body:body?JSON.stringify(body):undefined});
  const challenge=await(await request('/auth/challenge',{account:owner.address})).json();
  const session=await(await request('/auth/verify',{nonce:challenge.nonce,signature:await owner.signMessage({message:challenge.message})})).json();
  const b=buildBatch({account:owner.address,spender:spenderFor(owner.address).address,budgetUsdc:25,period:'weekly',universe:[STOCKS[0].token],durationDays:30});
  const body={account:owner.address,control:'chat',budgetUsdc:25,period:'weekly',universe:[STOCKS[0].token],strategy:'chat',risk:'balanced',maxPositionPct:40,takeProfitPct:10,stopLossPct:7,batch:b,approvalTx:`0x${'33'.repeat(32)}`};
  let receipt='success', permissions=false, revoked=false, reads=0;
  t.mock.method(publicClient,'getTransactionReceipt',async()=>{reads++;if(receipt==='missing')throw new Error('not found');return{status:receipt};});
  t.mock.method(publicClient,'readContract',async(args:{functionName:string;args:unknown[]})=>{
    assert.ok(['isApproved','isRevoked'].includes(args.functionName));
    const p=args.args[0] as {account:string;spender:string};
    assert.equal(p.account,owner.address);assert.equal(p.spender,spenderFor(owner.address).address);
    return args.functionName === 'isRevoked' ? revoked : permissions;
  });
  assert.equal((await request('/mandates',body)).status,401);assert.equal(reads,0);
  assert.equal((await request('/mandates',{...body,account:`0x${'44'.repeat(20)}`},session.token)).status,403);assert.equal(reads,0);
  assert.equal((await request('/mandates',{...body,approvalTx:undefined},session.token)).status,400);
  assert.equal((await request('/mandates',body,session.token)).status,409,'success receipt alone is insufficient');
  permissions=true;receipt='reverted';
  assert.equal((await request('/mandates',body,session.token)).status,409);
  receipt='missing';assert.equal((await request('/mandates',body,session.token)).status,409);
  receipt='success';revoked=true;
  assert.equal((await request('/mandates',body,session.token)).status,409,'revoked permissions cannot be accepted');
  revoked=false;
  // Avoid running a trade/evaluation in this route test. Only assert scheduling.
  const timer=t.mock.method(globalThis,'setTimeout',()=>0 as unknown as NodeJS.Timeout);
  const result=await request('/mandates',body,session.token);
  assert.equal(result.status,201);const saved=await result.json();
  assert.equal(saved.approvalTx,body.approvalTx);assert.equal(saved.signature,undefined);
  assert.equal(db.mandates.length,1);assert.equal(timer.mock.callCount(),1);
});
