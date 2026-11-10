#!/usr/bin/env node
import assert from 'node:assert/strict';
import {inspectIssue734LiveProtocol} from './issue734-postmigration-live-readonly.mjs';

const url='https://script.google.com/macros/s/MOCK_DEPLOYMENT/exec';
const token='MOCK_PRIVATE_TOKEN_FOR_TEST';
const trades=Array.from({length:338},(_,i)=>({id:'srv_'+i.toString(16).padStart(32,'0'),
 date:'2026-11-10',code:'005930',qty:1,price:100}));
const good={getTrades:{status:'ok',tradeLedgerProtocolVersion:2,
 ledgerRevision:'b'.repeat(64),trades},
 getHoldings:{status:'ok',holdings:[{code:'005930',qty:100}]}};
async function test(payload=good){
 const requests=[];
 const output=await inspectIssue734LiveProtocol({url,token,fetchImpl:async(dest,opt)=>{
  assert.equal(dest,url);assert.equal(opt.method,'POST');
  assert.equal(opt.body.get('accessToken'),token);
  requests.push(opt.body.get('action'));
  return {ok:true,json:async()=>payload[opt.body.get('action')]};
 }});
 assert.deepEqual(requests,['getTrades','getHoldings']);
 return output;
}
const out=await test();
assert.equal(out.status,'READ_VERIFIED');
assert.equal(out.tradeRows,338);
assert.equal(out.uniqueIds,338);
assert.equal(out.holdingsRows,1);
assert.equal(out.financialWrites,0);
assert.equal(out.mobileBrowserE2EVerified,false);
assert(!JSON.stringify(out).includes(token));
assert(!JSON.stringify(out).includes('srv_'));
for(const [change,pattern] of [
 [{getTrades:{...good.getTrades,tradeLedgerProtocolVersion:1}},/TRADE_LEDGER_UNVERIFIED/],
 [{getTrades:{...good.getTrades,trades:[...trades.slice(0,-1),trades[0]]}},/TRADE_ID_INVALID/],
 [{getTrades:{...good.getTrades,ledgerRevision:'wrong'}},/TRADE_LEDGER_UNVERIFIED/],
 [{getHoldings:{status:'ok',holdings:[]}},/HOLDINGS_READ_UNVERIFIED/],
 [{getTrades:{...good.getTrades,trades:[{...trades[0],id:'FAKE'}]}},/TRADE_ID_INVALID/]
 ]){
 await assert.rejects(()=>test({...good,...change}),pattern);
}
console.log(JSON.stringify({kind:'ISSUE734_LIVE_READONLY_CONTRACT_PASS',
 uniqueIds:338,apiRequests:2,mutationPathsExcluded:true,
 browserE2EProven:false,financialWrites:0,telegramSends:0}));
