// Execute the unpublished GAS writer + receipt + real worker IDLE branch.
// All inputs and ScriptProperties are fixture-only; finance writes = 0.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {composeGas9285TradeV2Preview} from './compose-gas9285-trade-v2-preview.mjs';
const {candidate,manifest}=composeGas9285TradeV2Preview();
assert.equal(manifest.productionDeploymentApproved,false);
const get=name=>{
 const i=candidate.indexOf('function '+name+'('),j=candidate.indexOf('\n}',i);
 assert.ok(i>=0&&j>i,'missing '+name);
 return candidate.slice(i,j+2);
};
const funcs=['_cleanCode','_normalizeCodeRows','_portfolioTradeFxMetadata_',
 '_tradeV2CanonicalRow_','_tradeV2RowsFromTrades_','_tradeV2RowHash_',
 '_tradeV2Revision_','_tradeV2ValidateMutation_','_tradeV2ReceiptInput_',
 '_tradeV2ReceiptState_','_tradeV2CheckpointVerified_',
 'handleTradeV2ReceiptReadOnly_','handleSyncTrades','handleGetTrades',
 'runPendingTradeSnapshotRebuild'];
const props={};
const ctx=vm.createContext({JSON,Date,Number,String,Math,Array,isFinite,
 console,Logger:{log:()=>{}},_issue507GateInside_:true,
 _normalizeDate:x=>String(x||'').slice(0,10),
 _portfolioSyncDigest_:x=>createHash('sha256').update(x).digest('hex'),
 _parseArrayParam:x=>JSON.parse(x),
 jsonOk:x=>({getContent:()=>JSON.stringify({status:'ok',...x})}),
 jsonError:(msg,x)=>({getContent:()=>JSON.stringify({status:'error',message:msg,...x})})
});
vm.runInContext([
 "var TRADE_V2_ID_RE=/^(tr|srv)_[A-Za-z0-9_-]{6,128}$/;",
 "var TRADE_V2_RECEIPT_PREFIX='portfolio_sync_receipt_v2_';",
 "var TRADE_LEDGER_FINGERPRINT_KEY='source_fingerprint';",
 "var TRADE_SNAPSHOT_WORKER_BUSY_KEY='worker_busy';",
 ...funcs.map(get)].join('\n'),ctx);
const before={id:'tr_account01',date:'2026-11-06',tradeType:'buy',
 acct:'US',name:'TEST',code:'005930',qty:10,price:209925,assetType:'주식',
 priceRaw:155.5,fxRateAtBuy:1350};
const after={...before,memo:'record corrected'};
const row=t=>[t.date,t.tradeType,t.acct,t.name,t.code,t.qty,t.price,
 t.assetType,t.memo||'',t.ratio||'',t.fractionalCash||'',
 t.priceRaw??'',t.fxRateAtBuy??'',t.id];
let rows=[row(before)],ncols=14,locked=false,dirty=false,pending=null,writes=0;
const sh={getLastRow:()=>rows.length+1,getLastColumn:()=>ncols,
 getParent:()=>({getSpreadsheetTimeZone:()=> 'Asia/Seoul'}),
 clearContents:()=>{rows=[];writes++},
 getRange:(a,b,count,width)=>{
  const r={getValues:()=>rows.slice(a-2,a-2+count).map(x=>x.slice(b-1,b-1+width)),
   setValues:v=>{writes++;if(a===1)ncols=v[0].length;
    else if(a===2)rows=v.map(x=>[...x]);return r},
   setBackground:()=>r,setFontColor:()=>r,
   setFontWeight:()=>r,setNumberFormat:()=>r};
  return r;
 }};
const ss={getId:()=> 'book-id',getSheetByName:()=>sh};
const ps={getProperty:k=>props[k]??null,setProperty:(k,v)=>{props[k]=String(v)},
 getProperties:()=>({...props}),deleteProperty:k=>{delete props[k]}};
Object.assign(ctx,{
 CONFIG:{SHEET_TRADES:'trades',TIMEZONE:'Asia/Seoul'},
 PropertiesService:{getScriptProperties:()=>ps},
 LockService:{getScriptLock:()=>({tryLock:()=>{locked=true;return true},
 waitLock:()=>{locked=true},releaseLock:()=>{locked=false}})},
 getss:()=>ss,getCodeItems:()=>[],
 _portfolioLedgerMasterConflict_:()=>'',_tradeLedgerWriteUnverified_:()=>dirty,
 _readPendingTradeSnapshotRebuild:()=>pending,
 _readTradeSnapshotDeferredState_:()=>({dates:[],cursor:''}),
 _backupSheetBeforeWrite:()=>({name:'backup'}),
 _markSnapshotBackupStatus:()=>{},_cleanupCurrentSystemBackup:()=>null,
 _earliestChangedTradeDate:()=> '2026-11-06',
 _latestConfirmedSnapshotDate:()=>'',_setPendingTradeSnapshotRebuild:d=>{pending={from:d}},
 _clearPendingTradeSnapshotRebuild:()=>{pending=null},
 _markTradeLedgerWriteUnverified_:()=>{dirty=true},
 _clearTradeLedgerWriteJournal_:()=>{dirty=false},
 _setCodeColumnText:()=>{},
 _verifyTradeWrittenRange:(sheet,first,values)=>assert.deepEqual(
  JSON.parse(JSON.stringify(rows)),JSON.parse(JSON.stringify(values))),
 _touchSnapshotIntegritySourceRevision:()=>{},
 _tradeLedgerContentFingerprint_:()=>createHash('sha256')
  .update(JSON.stringify(rows.map(r=>r.slice(0,11)))).digest('hex'),
 _recordTradeLedgerFingerprint_:()=>{props['source_fingerprint']=ctx._tradeLedgerContentFingerprint_(ss)},
 _detectExternalTradeLedgerChanges_:()=>({state:'UNCHANGED'}),
 _markTradeSnapshotWorkerResult_:x=>x,
 SpreadsheetApp:{flush:()=>{}},
 Utilities:{formatDate:x=>String(x).slice(0,10)}
});
const params={kind:'syncTradesV2',operationId:'receipt_abcdefghijklmnop',
 tradeLedgerProtocolVersion:'2',
 expectedLedgerRevision:ctx._tradeV2Revision_(rows),
 data:JSON.stringify([after]),intents:JSON.stringify([{
  type:'update',id:before.id,beforeHash:ctx._tradeV2RowHash_(row(before))
 }]),rebuildFrom:'',explicitEmpty:''};
const input=ctx._tradeV2ReceiptInput_(params);
props[input.key]=JSON.stringify({sourceId:ss.getId(),kind:input.kind,id:input.id,
 requestHash:input.requestHash,targetRevision:input.targetRevision,
 state:'STARTED',at:'2026-11-07T00:00:00.000Z'});
// The full writer returns, but process terminates before outer receipt ACK.
const saved=JSON.parse(ctx.handleSyncTrades(params.data,'',false,true,input.rows,input.contract).getContent());
assert.equal(saved.status,'ok',JSON.stringify(saved));
assert.equal(pending,null);
assert.equal(dirty,false);
assert.equal(JSON.parse(props[input.key]).state,'SOURCE_VERIFIED');
assert.equal(saved.ledgerRevision,ctx._tradeV2Revision_(rows));
const read=()=>JSON.parse(ctx.handleTradeV2ReceiptReadOnly_(params).getContent());
assert.equal(read().receiptState,'COMPLETE');
const worker=ctx.runPendingTradeSnapshotRebuild();
assert.equal(worker.status,'IDLE');
assert.equal(read().receiptState,'COMPLETE');
const count=writes;
rows[0][8]='post-write tamper';
assert.equal(read().receiptState,'CHANGED');
assert.equal(writes,count,'read only');
assert.equal(locked,false);
console.log('GAS9285_V2_REAL_WRITER_IDLE_CRASH_PASS'+JSON.stringify({
 deployed:false,privateSheetWrites:0,realWriter:true,realWorkerIdle:true}));
