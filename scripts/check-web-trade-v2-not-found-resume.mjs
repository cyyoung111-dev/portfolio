// Run actual web v2 recovery against a strict, in-memory GAS receipt stub.
// Proves NOT_FOUND can safely resume with the SAME operationId and CAS.
// No network calls, Google Sheets, Apps Script deployment, or finance writes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto,createHash} from 'node:crypto';
import {TextEncoder} from 'node:util';
const source=fs.readFileSync('src/web/features/settings/settings_sync.js','utf8');
const extract=name=>{
 const at=source.indexOf('function '+name+'('),end=source.indexOf('\n}',at);
 assert(at>=0&&end>at,'missing real web function: '+name);
 return source.slice(source.slice(at-6,at)==='async '?at-6:at,end+2);
};
const url='https://gas.test/unpublished',generation=9;
const row={id:'tr_initial1',date:'2026-11-06',tradeType:'buy',acct:'US',
 name:'TEST',code:'005930',qty:2,price:100,assetType:'주식',memo:''};
const changed={...row,qty:3};
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const canonical=t=>[t.id,t.date,t.tradeType,t.acct,t.name,t.code,
 t.qty,t.price,t.assetType,t.memo||'','','','',''];
const oldRev=hash([canonical(row)]),newRev=hash([canonical(changed)]);
const baseline={targetUrl:url,generation,protocol:2,revision:oldRev,trades:[row]};
const opId='pr_original0123456789';
const request={tradeLedgerProtocolVersion:'2',expectedLedgerRevision:oldRev,
 data:JSON.stringify([changed]),intents:JSON.stringify([{
 type:'update',id:row.id,beforeHash:hash(canonical(row))
 }]),explicitEmpty:'',rebuildFrom:''};
const receipt={action:'syncTradesV2',attempted:true,completed:false,id:opId,
 params:request};
let state='NOT_FOUND',writes=0,queryCount=0,acknowledgments=0,
 advanceOnWrite=true,lastRequest=null,remote=[row],saveCount=0;
const stores={[url]:{syncTradesV2:receipt}};
const browser={_tradeLedgerV2BaselineTargets:{[url]:baseline}};
const ctx=vm.createContext({JSON,Map,Set,Array,Math,Date,String,Number,
 Uint8Array,TextEncoder,crypto:webcrypto,window:browser,
 _readPortfolioRecoveryReceipts:()=>stores,
 _savePortfolioRecoveryReceipts:()=>{saveCount++;return true},
 isGsheetConnectionCurrent:(target,g)=>target===url&&g===generation,
 _acknowledgePortfolioTradeV2Sync:()=>{
   acknowledgments++;return true;
 },
 requestGsheetFormJson:async(action,params)=>{
   if(action==='getPortfolioSyncReceipt'){
     queryCount++;
     assert.equal(params.operationId,opId);
     return {status:'ok',kind:'syncTradesV2',operationId:opId,
       receiptState:state};
   }
   if(action!=='syncTradesV2')throw Error('unexpected action '+action);
   assert.equal(params.operationId,opId,'must not mint another operationId');
   assert.deepEqual(JSON.parse(JSON.stringify(Object.fromEntries(
     Object.entries(params).filter(([key])=>key!=='operationId')))),request);
   lastRequest=params;writes++;
   if(advanceOnWrite){remote=[changed];state='COMPLETE';}
   // Simulates a lost response; the client must query the receipt again.
   return {status:'error',errorCode:'NETWORK_TIMEOUT'};
 },
 requestGsheetActionJson:async action=>{
   assert.equal(action,'getTrades');
   return {status:'ok',tradeLedgerProtocolVersion:2,
    ledgerRevision:remote[0].qty===2?oldRev:newRev,
    trades:remote};
 }
});
const real=['_tradeV2NormalizeCode','_tradeV2BrowserCanonical',
 '_tradeV2BrowserSha256','_recoverOutstandingTradeV2Receipt'];
vm.runInContext(real.map(extract).join('\n'),ctx);
const got=await ctx._recoverOutstandingTradeV2Receipt(
 url,generation,baseline);
assert.equal(got.ok,true,JSON.stringify(got));
assert.equal(writes,1);
assert.equal(queryCount,2);
assert.equal(lastRequest.operationId,opId);
assert.equal(acknowledgments,1);
assert.equal(got.baseline.revision,newRev);
assert.equal(receipt.completed,true);
assert.equal(receipt.readbackConfirmedRevision,newRev);
assert.equal(browser._tradeLedgerV2BaselineTargets[url].revision,newRev);
assert.equal(saveCount,1);
// All uncertainties must fail closed. No additional write can occur.
for(const status of ['UNKNOWN','BUSY','PARTIAL','FAILED']){
 delete receipt.readbackConfirmedRevision;receipt.completed=false;
 browser._tradeLedgerV2BaselineTargets[url]=baseline;
 state=status;const before=writes;
 const blocked=await ctx._recoverOutstandingTradeV2Receipt(url,generation,baseline);
 assert.equal(blocked.ok,false);
 assert.equal(writes,before,'must not retry '+status);
}
// A changed server preimage is not a safe NOT_FOUND replay.
state='NOT_FOUND';
const changedBaseline={...baseline,revision:'c'.repeat(64)};
const blocked=await ctx._recoverOutstandingTradeV2Receipt(
 url,generation,changedBaseline);
assert.equal(blocked.errorCode,'TRADE_V2_RECOVERY_BASELINE_CONFLICT');
assert.equal(writes,1);
// A NOT_FOUND with changed expected revision must not issue a write
// even if the currently pinned revision equals the intended result.
const ambiguous={...baseline,revision:newRev,trades:[changed]};
const ambiguousResult=await ctx._recoverOutstandingTradeV2Receipt(
 url,generation,ambiguous);
assert.equal(ambiguousResult.errorCode,'TRADE_V2_NOT_FOUND_BASELINE_CHANGED');
assert.equal(writes,1);
console.log('WEB_TRADE_V2_NOT_FOUND_RETRY_PASS '+JSON.stringify({
 sameOperationId:true,notFoundReplayWrites:1,
 unsafeStatusRetries:0,actualWebSource:true,productionWrites:0}));
