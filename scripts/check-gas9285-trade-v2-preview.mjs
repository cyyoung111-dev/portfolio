// Execute the REAL GAS candidate functions under a mocked sheet/lock.
// This does not test or authorize production deployment or private Sheets.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {composeGas9285TradeV2Preview} from './compose-gas9285-trade-v2-preview.mjs';
const {base,candidate,manifest}=composeGas9285TradeV2Preview();
assert.equal(manifest.baseSourceGitBlob,'b5b1c7fd5a27454419ddd6d12ecb20751c207c63');
assert.equal(manifest.columns,14);
assert.equal(manifest.legacy13ColumnWriterExcluded,true);
assert.equal(manifest.finalWriterRequiresIdCas,true);
const tradeWriter=candidate.slice(candidate.indexOf('function handleSyncTrades('),candidate.indexOf('\n}',candidate.indexOf('function handleSyncTrades('))+2);
assert.doesNotMatch(tradeWriter,/previousFxGroups|oldOrdinaryCounts|TRADE_FX_GROUP_/);
assert.match(tradeWriter,/_tradeV2ValidateMutation_/);
assert.equal(manifest.productionDeploymentApproved,false);
assert.equal(manifest.requiresReceiptImplementation,false);
assert.equal(manifest.financeWrites,0);
assert.notEqual(candidate,base);
new vm.Script(candidate,{filename:'unpublished-gas-9285-v2.gs'});
const extract=name=>{
 const i=candidate.indexOf('function '+name+'('),j=candidate.indexOf('\n}',i);
 assert.ok(i>=0&&j>i,'production GAS function missing: '+name);
 return candidate.slice(i,j+2);
};
const names=['_cleanCode','_normalizeCodeRows','_portfolioTradeFxMetadata_','_tradeV2CanonicalRow_',
 '_tradeV2RowsFromTrades_','_tradeV2RowHash_','_tradeV2Revision_',
 '_tradeV2ValidateMutation_','_tradeV2CheckpointVerified_','handleSyncTrades','handleGetTrades'];
const js='var TRADE_V2_ID_RE=/^(tr|srv)_[A-Za-z0-9_-]{6,128}$/;\n'
 +names.map(extract).join('\n');
const ctx=vm.createContext({console,JSON,Date,Number,String,Math,isFinite,isNaN,
 _issue507GateInside_:true,
 _normalizeDate:x=>String(x||'').slice(0,10),
 _portfolioSyncDigest_:txt=>createHash('sha256').update(txt).digest('hex'),
 _parseArrayParam:txt=>JSON.parse(txt),
 jsonOk:x=>({status:'ok',...x}),
 jsonError:(msg,x)=>({status:'error',message:msg,...x}),
});
vm.runInContext(js,ctx);
let stored=[],columns=14,writeCount=0,locked=false,readCount=0,rebuilds=0;
const sheet={
 getLastRow:()=>stored.length+1,getLastColumn:()=>columns,
 getParent:()=>({getSpreadsheetTimeZone:()=> 'Asia/Seoul'}),
 clearContents:()=>{writeCount++;stored=[];},
 getRange:(r,c,n,m)=>{
  const range={
   setValues:values=>{
    writeCount++;
    if(r===1)columns=values[0].length;
    if(r===2)stored=values.map(x=>[...x]);
    return range;
   },
   getValues:()=>{
    readCount++;
    return (r===1?[Array.from({length:columns},()=> '')]:stored)
      .slice(0,n).map(x=>x.slice(c-1,c-1+m));
   },
   setBackground:()=>range,setFontColor:()=>range,setFontWeight:()=>range,
   setNumberFormat:()=>range
  };
  return range;
 }
};
const workbook={getSheetByName:()=>sheet,getId:()=> 'fixture-v2'};
Object.assign(ctx,{
 CONFIG:{SHEET_TRADES:'trades',TIMEZONE:'Asia/Seoul'},
 getss:()=>workbook,
 LockService:{getScriptLock:()=>({
  waitLock:()=>{assert.equal(locked,false);locked=true;},
  releaseLock:()=>{assert.equal(locked,true);locked=false;}
 })},
 getCodeItems:()=>[{name:'US_TEST',code:'005930',type:'주식'}],
 _portfolioLedgerMasterConflict_:()=> '',
 _tradeLedgerWriteUnverified_:()=>false,
 _readPendingTradeSnapshotRebuild:()=>null,
 _backupSheetBeforeWrite:()=>({name:'copy'}),
 _markSnapshotBackupStatus:()=>{},
 _cleanupCurrentSystemBackup:()=>({}),
 _earliestChangedTradeDate:()=> '2026-11-06',
 _latestConfirmedSnapshotDate:()=> '',
 _setPendingTradeSnapshotRebuild:()=>{},
 _markTradeLedgerWriteUnverified_:()=>{},
 _clearTradeLedgerWriteJournal_:()=>{},
 _setCodeColumnText:()=>{},
 _verifyTradeWrittenRange:(sh,row,values)=>{
  assert.deepEqual(JSON.parse(JSON.stringify(stored)),JSON.parse(JSON.stringify(values)));
 },
 _touchSnapshotIntegritySourceRevision:()=>{},
 _recordTradeLedgerFingerprint_:()=>{},
 _clearPendingTradeSnapshotRebuild:()=>{},
 SpreadsheetApp:{flush:()=>{}},
 Utilities:{formatDate:d=>String(d).slice(0,10)}
});
const fx={id:'tr_fx00001',date:'2026-11-06',tradeType:'buy',acct:'US',
 name:'US_TEST',code:'005930',qty:10,price:209925,assetType:'주식',memo:'',
 priceRaw:155.5,fxRateAtBuy:1350};
const plain={id:'tr_plain001',date:'2026-11-05',tradeType:'buy',acct:'US',
 name:'US_TEST',code:'005930',qty:2,price:100,assetType:'주식',memo:''};
const toRow=t=>[
 t.date,t.tradeType,t.acct,t.name,t.code,t.qty,t.price,t.assetType,t.memo||'',
 t.ratio||'',t.fractionalCash||'',t.priceRaw??'',t.fxRateAtBuy??'',t.id
];
const initial=[toRow(plain),toRow(fx)];
stored=initial.map(r=>[...r]);
const revision=ctx._tradeV2Revision_(stored);
const meta=(intents=[],rev=revision)=>({
 tradeLedgerProtocolVersion:2,expectedLedgerRevision:rev,intents
});
const edit=(row)=>({type:'update',id:row.id,
 beforeHash:ctx._tradeV2RowHash_(toRow(row))});
const deletion=row=>({type:'delete',id:row.id,
 beforeHash:ctx._tradeV2RowHash_(toRow(row))});
const run=(rows,contract,explicitEmpty=false)=>ctx.handleSyncTrades(JSON.stringify(rows),'',explicitEmpty,false,null,contract);
const failed=(code,rows,contract)=>{
 const beforeWrites=writeCount,prior=JSON.stringify(stored);
 const got=run(rows,contract);
 assert.equal(got.errorCode,code,code+' result '+JSON.stringify(got));
 assert.equal(writeCount,beforeWrites,code+' must fail before writing');
 assert.equal(JSON.stringify(stored),prior,code+' must keep original rows');
 assert.equal(locked,false);
};
failed('TRADE_LEDGER_V2_REQUIRED',[plain,fx],null);
failed('TRADE_LEDGER_REVISION_CONFLICT',[plain,fx],meta([],revision.slice(2)));
failed('TRADE_FX_METADATA_LOSS_RISK',[plain,
 {...fx,acct:'ISA',priceRaw:undefined,fxRateAtBuy:undefined}],
 meta([edit(fx)]));
failed('TRADE_FX_METADATA_LOSS_RISK',[plain,
 {...fx,code:'005931',priceRaw:undefined,fxRateAtBuy:undefined}],
 meta([edit(fx)]));
failed('TRADE_DELETE_INTENT_REQUIRED',[plain],meta());
failed('TRADE_PREIMAGE_MISMATCH',[plain,{...fx,memo:'updated'}],
 meta([{type:'update',id:fx.id,beforeHash:'wrong'}]));
failed('TRADE_ID_DUPLICATE',[plain,{...fx,id:plain.id}],meta());
const changedPlain={...plain,memo:'ordinary note'};
const good=run([changedPlain,fx],meta([edit(plain)]));
assert.equal(good.status,'ok','ordinary edit + unchanged FX must persist: '+JSON.stringify(good));
assert.equal(columns,14);
assert.equal(stored.length,2);
assert.equal(stored[1][11],155.5);
assert.equal(stored[1][12],1350);
assert.equal(stored[1][13],fx.id);
assert.equal(good.tradeLedgerProtocolVersion,2);
assert.equal(good.ledgerRevision,ctx._tradeV2Revision_(stored));
const read=ctx.handleGetTrades();
assert.equal(read.status,'ok');
assert.equal(read.tradeLedgerProtocolVersion,2);
assert.equal(read.ledgerRevision,good.ledgerRevision);
assert.equal(read.trades[1].id,fx.id);
assert.equal(read.trades[1].priceRaw,155.5);
assert.equal(read.trades[1].fxRateAtBuy,1350);
const changedRevision=read.ledgerRevision;
const deleteFx=run([changedPlain],meta([deletion(fx)],changedRevision));
assert.equal(deleteFx.status,'ok');
assert.equal(stored.length,1);
assert.equal(stored[0][13],plain.id);
// Code normalization must match the *production* writer. Request code
// '5930' is written as '005930', yet its ACK and GET revision must match.
const shortCode={...changedPlain,code:'5930'};
const normalizedAck=run([shortCode],meta([edit(changedPlain)],deleteFx.ledgerRevision));
assert.equal(normalizedAck.status,'ok',JSON.stringify(normalizedAck));
assert.equal(stored[0][4],'005930','production _normalizeCodeRows pads the code');
assert.equal(normalizedAck.ledgerRevision,ctx.handleGetTrades().ledgerRevision,
 'write ACK must hash the persisted normalized code, not the raw input');
assert.equal(ctx._tradeV2Revision_([toRow(shortCode)]),normalizedAck.ledgerRevision,
 'v2 CAS uses the same effective normalized code');
// Deleting the final trade keeps a legitimate empty, 14-column v2 ledger.
const finalDelete=run([],meta([deletion(changedPlain)],normalizedAck.ledgerRevision),true);
assert.equal(finalDelete.status,'ok',JSON.stringify(finalDelete));
assert.equal(stored.length,0);
const emptyRead=ctx.handleGetTrades();
assert.equal(emptyRead.status,'ok');
assert.equal(emptyRead.tradeLedgerProtocolVersion,2);
assert.equal(emptyRead.ledgerRevision,ctx._tradeV2Revision_([]));
assert.equal(finalDelete.ledgerRevision,emptyRead.ledgerRevision,
 'last deletion must remain COMPLETE-checkable from the empty ledger');
const fresh={...plain,id:'tr_fresh001',memo:'new after empty'};
const created=run([fresh],meta([{type:'create',id:fresh.id}],emptyRead.ledgerRevision));
assert.equal(created.status,'ok','after last deletion a new create must work');
assert.equal(stored.length,1);
assert.equal(stored[0][13],fresh.id);
assert.equal(created.ledgerRevision,ctx.handleGetTrades().ledgerRevision);
// Legacy 11-column input cannot be promoted implicitly to ID-bearing source.
stored=initial.map(r=>r.slice(0,11));columns=11;
failed('TRADE_LEDGER_IDENTITY_MIGRATION_REQUIRED',[plain,fx],meta());
assert.equal(locked,false);
assert.ok(writeCount>0,'positive write tests must execute the real production writer');
const srcFund=candidate.slice(candidate.indexOf('function _refreshFundValuations('));
const noopAt=srcFund.indexOf('if (values.length === 0)');
const lockAt=srcFund.indexOf('var writeLock = LockService.getScriptLock();');
assert.ok(noopAt>0 && lockAt>noopAt,'fund noop must preempt writer lock');
console.log('GAS9285_TRADE_V2_PREVIEW_PASS '+JSON.stringify({
 productionSourceExecuted:true,columns:14,previewOnly:true,
 receiptImplemented:true,legacyMigrationImplemented:false,
 financeWrites:0,gasProjectWrites:0,rebuilds,readCount
}));
