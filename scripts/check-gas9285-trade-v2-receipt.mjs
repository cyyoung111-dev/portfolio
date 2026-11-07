// Executable v2 receipt functions from the unpublished GAS source.
// Side effects are restricted to an in-memory ScriptProperties mock.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import {composeGas9285TradeV2Preview} from './compose-gas9285-trade-v2-preview.mjs';
const {candidate,manifest}=composeGas9285TradeV2Preview();
assert.equal(manifest.productionDeploymentApproved,false);
assert.equal(manifest.requiresReceiptImplementation,false);
assert.equal(manifest.requiresLegacyMigration,true);
assert.match(candidate,/params\.action === 'syncTradesV2' && params\.data\) return handleTradeSyncV2WithReceipt_/);
assert.match(candidate,/params\.kind === 'syncTradesV2'\) return handleTradeV2ReceiptReadOnly_/);
const extract=name=>{
 const i=candidate.indexOf('function '+name+'('),j=candidate.indexOf('\n}',i);
 assert(i>=0&&j>i,name+' missing in GAS output');
 return candidate.slice(i,j+2);
};
const fn=['_cleanCode','_portfolioTradeFxMetadata_','_tradeV2CanonicalRow_',
 '_tradeV2RowsFromTrades_','_tradeV2RowHash_','_tradeV2Revision_',
 '_recordPortfolioSyncSnapshotCompletion_','_portfolioSyncFollowupRecovered_',
 '_tradeV2ReceiptInput_','_tradeV2ReceiptState_',
 'handleTradeV2ReceiptReadOnly_','handleTradeSyncV2WithReceipt_'];
const ctx=vm.createContext({Date,JSON,String,Number,Math,isFinite,
 _issue507GateInside_:true,_normalizeDate:x=>String(x||''),
 _portfolioSyncDigest_:txt=>createHash('sha256').update(txt).digest('hex'),
 jsonOk:x=>({status:'ok',...x}),
 jsonError:(msg,x)=>({status:'error',message:msg,...x})
});
vm.runInContext('var TRADE_V2_RECEIPT_PREFIX="portfolio_sync_receipt_v2_";\n' +
 'var PORTFOLIO_SYNC_RECEIPT_PREFIX="portfolio_sync_receipt_v1_";\n' +
 'var PORTFOLIO_SYNC_SNAPSHOT_COMPLETION_KEY="snapshot_complete";\n' +
 'var TRADE_LEDGER_FINGERPRINT_KEY="ledger_fingerprint";\n'
 +fn.map(extract).join('\n'),ctx);
const rows=[{id:'tr_fx00001',date:'2026-11-06',tradeType:'buy',
 acct:'US',name:'US_TEST',code:'005930',qty:3,price:209925,
 assetType:'주식',memo:'',priceRaw:155.5,fxRateAtBuy:1350}];
const target=ctx._tradeV2Revision_(ctx._tradeV2RowsFromTrades_(rows));
const build=id=>({operationId:id,tradeLedgerProtocolVersion:'2',
 data:JSON.stringify(rows),intents:'[]',expectedLedgerRevision:'a'.repeat(64),
 rebuildFrom:'',explicitEmpty:''});
const params=build('receipt_abcdefghijklmnop');
const props={};
const service={
 getProperty:key=>Object.hasOwn(props,key)?props[key]:null,
 setProperty:(key,val)=>{props[key]=String(val)},
 deleteProperty:key=>{delete props[key]},
 getProperties:()=>({...props})
};
let current='a'.repeat(64),writes=0,locked=false,pending=false,deferredDates=[];
Object.assign(ctx,{
 PropertiesService:{getScriptProperties:()=>service},
 LockService:{getScriptLock:()=>({
  tryLock:()=>{if(locked)return false;locked=true;return true;},
  waitLock:()=>{assert.equal(locked,false);locked=true;},
  releaseLock:()=>{assert.equal(locked,true);locked=false;}
 })},
 getss:()=>({getId:()=> 'test-workbook'}),
 _tradeLedgerWriteUnverified_:()=>false,
 _readPendingTradeSnapshotRebuild:()=>pending?{from:'2026-11-06'}:null,
 _readTradeSnapshotDeferredState_:()=>({dates:deferredDates}),
 _tradeLedgerContentFingerprint_:()=> 'verified-source-sha',
 handleGetTrades:()=>({getContent:()=>JSON.stringify({
  status:'ok',tradeLedgerProtocolVersion:2,ledgerRevision:current,trades:rows
 })}),
 handleSyncTrades:(_payload,_from,_empty,lockHeld,receiptRows,contract)=>{
  assert.equal(lockHeld,true,'writer must reuse receipt ScriptLock');
  assert.equal(contract.tradeLedgerProtocolVersion,2);
  assert.equal(contract.expectedLedgerRevision,params.expectedLedgerRevision);
  assert.equal(receiptRows.length,1);
  writes++;current=target;
  return {getContent:()=>JSON.stringify({status:'ok',saveState:'success',
   tradeLedgerProtocolVersion:2,ledgerRevision:target,
   affectedFrom:'2026-11-06',affectedTo:'2026-11-07'})};
 }
});
const lookup=()=>ctx.handleTradeV2ReceiptReadOnly_({...params,kind:'syncTradesV2'});
assert.equal(lookup().receiptState,'NOT_FOUND');
const saved=ctx.handleTradeSyncV2WithReceipt_(params);
assert.equal(saved.status,'ok',JSON.stringify(saved));
assert.equal(saved.receiptState,'COMPLETE');
assert.equal(writes,1);
assert.equal(lookup().receiptState,'COMPLETE');
const repeated=ctx.handleTradeSyncV2WithReceipt_(params);
assert.equal(repeated.replayed,true);
assert.equal(writes,1,'ACK loss must not trigger a second writer');
assert.equal(Object.values(props).length,1);
assert.ok(!Object.values(props)[0].includes('US_TEST'),
 'durable receipt stores hashes, not transaction contents');
const changed={...params,intents:JSON.stringify([{type:'delete',id:rows[0].id}])};
const conflicting=ctx.handleTradeSyncV2WithReceipt_(changed);
assert.equal(conflicting.errorCode,'SYNC_RECEIPT_CONFLICT');
assert.equal(writes,1);
pending=true;
assert.equal(lookup().receiptState,'PARTIAL');
pending=false;
// Worker may clear the primary pending marker while a failed Snapshot date
// survives in the deferred queue; COMPLETE must still be forbidden.
deferredDates=['2026-11-06'];
assert.equal(lookup().receiptState,'PARTIAL');
assert.equal(ctx.handleTradeSyncV2WithReceipt_(params).errorCode,'SYNC_RECEIPT_PARTIAL');
assert.equal(writes,1,'deferred queue must never trigger an automatic rewrite');
deferredDates=['2026-11-01'];
assert.equal(lookup().receiptState,'COMPLETE',
 'a deferred date outside this receipt range must not block completion');
deferredDates=[];
const receiptInput=ctx._tradeV2ReceiptInput_(params);
const complete=JSON.parse(props[receiptInput.key]);
props[receiptInput.key]=JSON.stringify({...complete,state:'PARTIAL',
 at:'2026-11-06T00:00:00.000Z'});
assert.equal(lookup().receiptState,'PARTIAL',
 'matching ledger SHA without worker completion proof is insufficient');
props['ledger_fingerprint']='verified-source-sha';
assert.equal(ctx._recordPortfolioSyncSnapshotCompletion_(ctx.getss()),true,
 'real Snapshot worker must recognize a v2 PARTIAL receipt');
assert.equal(lookup().receiptState,'COMPLETE',
 'newer verified Snapshot proof may promote a recovered PARTIAL request');
const interrupted=build('receipt_abcdefghijklmnop2');
const in2=ctx._tradeV2ReceiptInput_(interrupted);
props[in2.key]=JSON.stringify({
 sourceId:'test-workbook',kind:in2.kind,id:in2.id,
 requestHash:in2.requestHash,targetRevision:in2.targetRevision,
 state:'STARTED',at:'2026-11-06T00:00:00.000Z'
});
delete props['snapshot_complete'];
const beforeWorker=ctx.handleTradeV2ReceiptReadOnly_({...interrupted,kind:'syncTradesV2'});
assert.equal(beforeWorker.receiptState,'PARTIAL','STARTED without proof is not complete');
assert.equal(ctx._recordPortfolioSyncSnapshotCompletion_(ctx.getss()),true,
 'worker must also recognize a v2 STARTED receipt');
const recovered=ctx.handleTradeV2ReceiptReadOnly_({...interrupted,kind:'syncTradesV2'});
assert.equal(recovered.receiptState,'COMPLETE',
 'crash after verified ledger requires a newer worker proof for read-only recovery');
assert.equal(writes,1);
assert.equal(locked,false);
console.log('GAS9285_TRADE_V2_RECEIPT_PASS '+JSON.stringify({
 exactSourceFunctions:true,duplicateWrites:0,readOnlyRecovery:true,
 deploymentWrites:0,financeWrites:0,productionGasDeployed:false
}));
