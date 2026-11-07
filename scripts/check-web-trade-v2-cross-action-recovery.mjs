// Cross-action recovery regression for the UNDEPLOYED trade-v2 candidate.
// Executes the actual dirty retry, portfolio receipt gate and v2 receipt
// recovery functions. All network, Sheets, journal and GAS calls are mocked.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createHash,webcrypto} from 'node:crypto';
import {TextEncoder} from 'node:util';
const data=fs.readFileSync('src/web/domain/portfolio/data.js','utf8');
const sync=fs.readFileSync('src/web/features/settings/settings_sync.js','utf8');
const fn=(src,name)=>{
 const start=src.indexOf('function '+name+'('),end=src.indexOf('\n}',start);
 assert(start>=0&&end>start,'missing production browser fn: '+name);
 return src.slice(src.slice(start-6,start)==='async '?start-6:start,end+2);
};
const url='https://gas.test/identity-v2',generation=9;
const before={id:'tr_initial1',date:'2026-11-06',tradeType:'buy',
 acct:'US',name:'US_TEST',code:'005930',qty:2,price:100,assetType:'주식',memo:''};
const after={...before,qty:3};
const row=t=>[t.id,t.date,t.tradeType,t.acct,t.name,t.code,
 Number(t.qty),Number(t.price),t.assetType,t.memo||'','','','',''];
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const oldRev=digest([row(before)]),newRev=digest([row(after)]);
const baseline={targetUrl:url,generation,protocol:2,revision:oldRev,trades:[before]};
const originalId='pr_original01234567890123';
const params={tradeLedgerProtocolVersion:'2',expectedLedgerRevision:oldRev,
 data:JSON.stringify([after]),intents:JSON.stringify([{
 type:'update',id:before.id,beforeHash:digest(row(before))
 }]),explicitEmpty:'',rebuildFrom:''};
const receipt={action:'syncTradesV2',id:originalId,scope:'trade-v2:'+oldRev,
 attempted:true,completed:false,params};
const records={[url]:{syncTradesV2:receipt}};
let v2ReceiptStateOverride=null;
const dirtyMap={[url]:{target:url,epoch:1,receiptProtocol:1,
 legacyUntracked:false,receiptScope:'task_recovery_fixture',
 trades:[after],holdings:[{code:'005930',qty:3}],fundDirect:{},
 tradeV2DeleteIds:[],tradeV2Baseline:{
 targetUrl:url,protocol:2,revision:oldRev,trades:[before]}}};
const initialDirty=JSON.parse(JSON.stringify(dirtyMap[url]));
let remote=[before],holds=0,trades=0,settings=0,originalWrites=0,
 receiptQueries=0,events=[],persisted=0;
const browser={_tradeLedgerV2BaselineTargets:{[url]:baseline},
 _tradeLedgerV2RequiredTargets:{[url]:true}};
const ctx=vm.createContext({console,Math,Date,JSON,Array,Set,Map,
 Number,String,Uint8Array,TextEncoder,crypto:webcrypto,window:browser,
 _portfolioRemoteDirtyByTarget:dirtyMap,
 _currentGsheetSyncTarget:()=>url,
 getGsheetConnectionGeneration:()=>generation,
 isGsheetConnectionCurrent:(u,g)=>u===url&&g===generation,
 _queuePortfolioRemoteSync:async(u,cb)=>cb(),
 _hasPortfolioReceiptProtocol:()=>true,
 _isEmptyPortfolioDirtyWithoutDeleteIntent:()=>false,
 _readPortfolioRecoveryReceipts:()=>records,
 _savePortfolioRecoveryReceipts:()=>{persisted++;return true},
 _persistPortfolioRemoteDirtyMap:()=>{persisted++},
 _acknowledgePortfolioTradeV2Sync:(u,old,newData)=>{
   assert.equal(u,url);assert.equal(old.revision,oldRev);
   assert.equal(newData.revision,newRev);
   dirtyMap[url].tradeV2Baseline={targetUrl:url,protocol:2,
    revision:newRev,trades:[after]};
   return true;
 },
 requestGsheetFormJson:async(action,p)=>{
   if(action==='getPortfolioSyncReceipt'){
     receiptQueries++;
     if(p.operationId===originalId)return {status:'ok',
      kind:'syncTradesV2',operationId:originalId,
      receiptState:v2ReceiptStateOverride || (originalWrites?'COMPLETE':'NOT_FOUND')};
     return {status:'ok',kind:p.kind,operationId:p.operationId,
       receiptState:'NOT_FOUND'};
   }
   if(action==='syncTradesV2'){
     assert.equal(p.operationId,originalId,'must reuse original operationId');
     assert.equal(p.expectedLedgerRevision,oldRev);
     originalWrites++;remote=[after];events.push('v2-original-resume');
     return {status:'error',errorCode:'ACK_LOST'};
   }
   if(action==='syncHoldings'){
     holds++;events.push('holdings-write');
     return {status:'ok',receiptState:'COMPLETE',operationId:p.operationId};
   }
   throw Error('unexpected GAS action '+action);
 },
 requestGsheetActionJson:async(action)=>{
   assert.equal(action,'getTrades');
   return {status:'ok',tradeLedgerProtocolVersion:2,
    ledgerRevision:originalWrites?newRev:oldRev,trades:remote};
 },
 syncHoldingsToGsheet:async opts=>{
   const result=await ctx._requestPortfolioRecoveryWrite('syncHoldings',
     {data:'fixture'}, {targetUrl:opts.targetUrl,
      generation:opts.generation,recoveryScope:opts.recoveryScope});
   return result;
 },
 syncTradesToGsheet:async()=>{trades++;events.push('trades-write');return {status:'ok',saveState:'success'};},
 saveSettings:async()=>{settings++;return true},
 _clearPortfolioRemoteDirty:(epoch,target)=>{
   assert.equal(epoch,1);delete dirtyMap[target];return true},
 lsGet:()=>({}),
 PORTFOLIO_REMOTE_DIRTY_KEY:'dirty-fixture',
 isPinnedRestorePortfolioMasterComplete:()=>true
});
const fns=[
 fn(sync,'_requestPortfolioRecoveryWrite'),
 fn(sync,'_tradeV2PinnedBaseline'),
 fn(sync,'_tradeV2NormalizeCode'),
 fn(sync,'_tradeV2BrowserCanonical'),
 fn(sync,'_tradeV2BrowserSha256'),
 fn(sync,'_recoverOutstandingTradeV2Receipt'),
 fn(sync,'_preflightTradeV2Receipt'),
 fn(data,'_retryPortfolioRemoteDirtySync')
];
vm.runInContext(fns.join('\n'),ctx);
const failures=[];
const ok=await ctx._retryPortfolioRemoteDirtySync({
 targetUrl:url,allowDuringRestore:true,onFailure:c=>failures.push(c)
});
assert.equal(ok,true,'dirty recovery must finish: '+failures.join(','));
assert.equal(originalWrites,1,'retry saved original v2 op once');
assert.equal(holds,1,'holdings must follow v2 preflight');
assert.equal(trades,1);
assert.equal(settings,1);
assert.ok(events.indexOf('v2-original-resume')<events.indexOf('holdings-write'),
 'old v2 receipt must recover BEFORE unrelated holdings write');
assert.equal(receipt.readbackConfirmedRevision,newRev);
assert.equal(browser._tradeLedgerV2BaselineTargets[url].revision,newRev);
assert.equal(Object.keys(dirtyMap).length,0,'fully confirmed dirty cleared');
// Fail-closed: PARTIAL/UNKNOWN cannot trigger a holdings write and cannot
// replay the already-attempted trading operation.
Object.assign(records[url],{syncTradesV2:receipt});
Object.assign(dirtyMap,{[url]:JSON.parse(JSON.stringify(initialDirty))});
receipt.attempted=true;receipt.completed=false;
delete receipt.readbackConfirmedRevision;
browser._tradeLedgerV2BaselineTargets[url]=baseline;
remote=[before];originalWrites=0;v2ReceiptStateOverride='PARTIAL';
const countBefore={holds,trades,settings};
const refused=[];
const refusal=await ctx._retryPortfolioRemoteDirtySync({
 targetUrl:url,allowDuringRestore:true,onFailure:c=>refused.push(c)
});
assert.equal(refusal,false);
assert.equal(refused[0],'TRADE_V2_RECEIPT_PARTIAL');
assert.deepEqual({holds,trades,settings},countBefore,
 'uncertain trading receipt must block all unrelated writes');
assert.equal(originalWrites,0);
// Missing exact-target provenance: never manufacture or silently infer the
// original revision from a different device's Bootstrap.
delete browser._tradeLedgerV2BaselineTargets[url];
const missing=[];
const missingResult=await ctx._retryPortfolioRemoteDirtySync({
 targetUrl:url,allowDuringRestore:true,onFailure:c=>missing.push(c)
});
assert.equal(missingResult,false);
assert.equal(missing[0],'TRADE_V2_BASELINE_REQUIRED');
assert.deepEqual({holds,trades,settings},countBefore);
assert.equal(originalWrites,0);
console.log('TRADE_V2_CROSS_ACTION_PREFLIGHT_PASS '+JSON.stringify({
 originalOperationReplayed:1,holdingsAfterRecovery:true,
 crossActionFailures:0,privateSheetWrites:0,productionDeployment:false,
 receiptQueries,events
}));
