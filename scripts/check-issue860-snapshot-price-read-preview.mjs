#!/usr/bin/env node
// Exercise actual three production reader functions under a real Node VM.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {composeFundSnapshot9287SourcePreview} from './compose-fund-snapshot-9287-source-preview.mjs';
import {composeGas9288TradeV2From9287Preview} from './compose-gas9288-trade-v2-from-9287-preview.mjs';
import {composeIssue860SnapshotPriceReadPreview} from './compose-issue860-snapshot-price-read-preview.mjs';
import {composeIssue860CloseStageTimingPreview} from './compose-issue860-close-stage-timing-preview.mjs';
import {assertGasReleaseReady,gasSourceBlobSha} from './deploy-gas.mjs';

const fn=(s,name)=>{
 const a=s.indexOf('function '+name+'('),b=s.indexOf('\n}',a);
 assert(a>=0&&b>a,'missing '+name);return s.slice(a,b+2);
};
const names=['getPriceHistoryRow','_getPriceSourceByDate',
 '_buildSnapshotRowsFromTradeAndPriceHistory'];
function evaluate(source,{manual=false,fail=false,unrelatedDate=false}={}){
 let reads=0,sheetsRead=0;
 const date='2026-11-09';
 const rows=[['2026-11-08','005930','TEST',180,'','NH'],
  [date,'005930','TEST',200,'','NH']];
 if(manual)rows.push([date,'005930','TEST',210,'2026-11-09 19:10:00','MANUAL']);
 const prices={
  getLastRow:()=>rows.length+1,getLastColumn:()=>6,
  getRange:(_row,_col,_count,width)=>({getValues:()=>{
   reads++;
   if(fail)throw Error('SIMULATED_SPREADSHEET_READ_TIMEOUT');
   return rows.map(r=>r.slice(0,width));
  }})
 };
 const trades={
  getLastRow:()=>2,getLastColumn:()=>11,
  getRange:()=>({getValues:()=>[[date,'매수','ISA','TEST','005930',2,75,'주식','','','']]})
 };
 const ss={getSheetByName:name=>{
  sheetsRead++;
  return name==='가격이력'?prices:name==='거래이력'?trades:null;
 }};
 const codeItems=[{code:'005930',name:'TEST',currency:'KRW'}];
 const context=vm.createContext({
  CONFIG:{SHEET_PH:'가격이력',SHEET_TRADES:'거래이력'},
  JSON,Array,Number,String,Date,Math,Object,isFinite,console,
  _issue507GateInside_:true,
  _normalizeDate:x=>String(x??'').slice(0,10),
  _normalizeDatetime:x=>String(x||''),
  _cleanCode:x=>String(x||'').trim(),
  _legacyDigitsCode:x=>String(x||''),
  _isFundCode:code=>/^F\d{5}$/.test(String(code)),
  _calcCodeHoldingsAtDate:()=>({'005930':{code:'005930',name:'TEST',
    qty:2,costAmt:150}}),
  _applyFundUnitLifecycleToSnapshotHoldings:()=>{},
  _readFundUnits:()=>[],
  getCodeItems:()=>codeItems,
  _getHistoricalExchangeRates:()=>({}),
  _dedupeSnapshotRows:rows=>rows,
  _getFundEvaluationAtDate:()=>null,
  getLatestPriceHistoryEntries:()=>({}),
  Logger:{log:()=>{}}
 });
 vm.runInContext(names.map(name=>fn(source,name)).join('\n'),context);
 let output;
 if(unrelatedDate){
  output=context._getPriceSourceByDate(ss,date,true);
 } else {
  output=context._buildSnapshotRowsFromTradeAndPriceHistory(ss,date,true);
 }
 return {output:JSON.parse(JSON.stringify(output)),reads,sheetsRead};
}
for(const original of [
 composeFundSnapshot9287SourcePreview().candidate,
 composeGas9288TradeV2From9287Preview().candidate
]){
 const version=original.includes("var ISSUE507_GATE_API_VERSION='9.288'")?'9.288':'9.287';
 const preview=composeIssue860SnapshotPriceReadPreview(original);
 assert.equal(assertGasReleaseReady(original),version);
 assert.notEqual(gasSourceBlobSha(original),gasSourceBlobSha(preview.source));
 assert.throws(()=>assertGasReleaseReady(preview.source),
  /GAS_RELEASE_SOURCE_NOT_APPROVED/);
 new vm.Script(preview.source,{filename:'issue860-unapproved-'+version+'.gs'});
 const before=new Map([...original.matchAll(/^function ([A-Za-z_$][\w$]*)\s*\(/gm)]
  .map(m=>[m[1],fn(original,m[1])]));
 const after=new Map([...preview.source.matchAll(/^function ([A-Za-z_$][\w$]*)\s*\(/gm)]
  .map(m=>[m[1],fn(preview.source,m[1])]));
 assert.equal(before.size,after.size);
 assert.deepEqual([...before.keys()],[...after.keys()]);
 const changed=[...before.keys()].filter(n=>before.get(n)!==after.get(n)).sort();
 assert.deepEqual(changed,names.slice().sort());
 for(const n of ['_refreshFundValuations','_backupSheetBeforeWrite','writeSnapshotRows',
   '_writeSnapshotDateScoped_','diagnoseSnapshotIntegrity',
   'runDailyPortfolioClose1900','runDailyFundValuations','_issue507GateEnter_',
   'runTradeV2MigrationApply','runTradeV2MigrationRestore']){
  if(before.has(n))assert.equal(before.get(n),after.get(n),'protected '+n);
 }
 for(const manual of [false,true]){
  const base=evaluate(original,{manual}),fast=evaluate(preview.source,{manual});
  assert.deepEqual(fast.output,base.output,'All finance columns must match');
  assert.equal(base.reads,2,'Original does two price-history full reads');
  assert.equal(fast.reads,1,'Scoped optimization does exactly one');
  assert.equal(fast.output.length,1);
  assert.equal(fast.output[0].length,12);
  assert.equal(fast.output[0][7],manual?420:400);
  assert.equal(fast.output[0][10],manual?'MANUAL':'NH');
  assert.equal(fast.output[0][11],manual?'2026-11-09 19:10:00':'');
 }
 // Legacy independent API users still do their own fresh sheet read.
 for(const source of [original,preview.source]){
  const legacy=evaluate(source,{unrelatedDate:true});
  assert.equal(legacy.reads,1);
 }
 for(const source of [original,preview.source])
  assert.throws(()=>evaluate(source,{fail:true}),/SIMULATED_SPREADSHEET_READ_TIMEOUT/);
 // Compatible with timing-only transform without approving any combined source.
 const combined=composeIssue860CloseStageTimingPreview(preview.source);
 new vm.Script(combined.source,{filename:'issue860-unapproved-combined-'+version+'.gs'});
 assert.throws(()=>assertGasReleaseReady(combined.source),/GAS_RELEASE_SOURCE_NOT_APPROVED/);
 console.log(JSON.stringify({kind:'ISSUE860_PRICE_HISTORY_ONE_READ_PREVIEW_PASS',
  version,scenarios:7,unmodifiedFunctions:before.size-3,
  originalFullReads:2,optimizedFullReads:1,
  manualOverridesPreserved:true,spreadsheetErrorPreserved:true,
  rollbackWritersUnchanged:true,deployApproved:false,financeWrites:0}));
}
