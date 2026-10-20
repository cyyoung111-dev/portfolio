#!/usr/bin/env node
// #507: diagnose ALL currently deferred Snapshot dates without mutating queues,
// price/NAV/FX originals or Snapshot. Authenticated GAS v9.244+ inventory only.
// Never print holdings, individual codes, quantities, amounts or raw source errors.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {validateWebAppUrl} from './diagnose-krx-operational.mjs';

const DATE=/^\d{4}-\d{2}-\d{2}$/;
const STATUS=new Set(['VALID','PARTIAL','MISMATCH','CONFLICT',
  'SOURCE_INCOMPLETE','NO_SNAPSHOT','PRICE_SUSPICIOUS']);
const CHUNK_SIZE=6;
const MAX_AUDIT_DATES=60;
function day(s){
  if(typeof s!=='string'||!DATE.test(s))return false;
  const d=Date.parse(s+'T00:00:00Z');
  return Number.isFinite(d)&&new Date(d).toISOString().slice(0,10)===s;
}
function num(n){
  if(!Number.isSafeInteger(n)||n<0||n>1000000)throw Error('ISSUE507_DEFERRED_COUNT_SCHEMA');
  return n;
}
export function validateInventory(payload){
  const a=payload?.automation;
  if(payload?.status!=='ok'||payload.gasVersion!=='9.244'||
    !a||a.gasVersion!=='9.244'||
    !Array.isArray(a.tradeSnapshotDeferredDates) ||
    a.tradeSnapshotDeferredDates.length>600||
    a.tradeSnapshotDeferredCount!==a.tradeSnapshotDeferredDates.length ||
    typeof a.tradeSnapshotDeferredOldestDate!=='string' ||
    typeof a.tradeSnapshotDeferredCursor!=='string' ||
    typeof a.pendingTradeSnapshotRebuildFrom!=='string')
    throw Error('ISSUE507_DEFERRED_INVENTORY_SCHEMA');
  const dates=a.tradeSnapshotDeferredDates;
  if(dates.some(x=>!day(x))||
    dates.slice().sort().filter((x,i,all)=>i===0||x!==all[i-1]).join('|')!==dates.join('|') ||
    a.tradeSnapshotDeferredOldestDate!==(dates[0]||'')||
    (a.tradeSnapshotDeferredCursor&&!day(a.tradeSnapshotDeferredCursor))||
    (a.pendingTradeSnapshotRebuildFrom&&!day(a.pendingTradeSnapshotRebuildFrom)))
    throw Error('ISSUE507_DEFERRED_INVENTORY_DATES');
  return {dates,cursor:a.tradeSnapshotDeferredCursor,
    pendingFrom:a.pendingTradeSnapshotRebuildFrom};
}
function sourceKinds(errors){
  if(!Array.isArray(errors)||errors.length>200)throw Error('ISSUE507_DEFERRED_SOURCE_SCHEMA');
  const result=new Set();
  for(const v of errors){
    if(typeof v!=='string')throw Error('ISSUE507_DEFERRED_SOURCE_SCHEMA');
    // Classification is derived in memory; user-sensitive strings never logged.
    const e=v.toUpperCase();
    if(/환율|EXCHANGE RATE|FX[_ \-]|USD|KRW|CURRENCY/.test(e))result.add('FX');
    else if(/NAV|펀드|TDF|기준가|좌수/.test(e))result.add('FUND_NAV');
    else if(/원자료|가격|종가|KRX|PRICE|확정/.test(e))result.add('PRICE');
    else result.add('UNCLASSIFIED');
  }
  return [...result].sort();
}
export function summarizeBatch(payload,dates){
  if(payload?.status!=='ok'||!Array.isArray(payload.checkedDates)||
    !Array.isArray(payload.diagnostics)||payload.checkedDates.length!==dates.length||
    payload.diagnostics.length!==dates.length||
    typeof payload.integritySourceRevision!=='string' ||
    payload.checkedDates.slice().sort().join('|')!==dates.slice().sort().join('|'))
    throw Error('ISSUE507_DEFERRED_DIAGNOSTIC_SCHEMA');
  const seen=new Set(),records=[];
  for(const d of payload.diagnostics){
    if(!d||!dates.includes(d.date)||seen.has(d.date)||!STATUS.has(d.status)||
      !Array.isArray(d.missingCodes)||!Array.isArray(d.sourceDataErrors)||
      !Array.isArray(d.duplicateKeys))
      throw Error('ISSUE507_DEFERRED_DIAGNOSTIC_RECORD');
    seen.add(d.date);
    const dup=d.duplicateSummary;
    const nsource=num(d.sourceDataErrors.length),missing=num(d.missingCodes.length),
      conflicts=num(dup?.unresolvedConflict),duplicates=num(d.duplicateKeys.length);
    const kinds=sourceKinds(d.sourceDataErrors);
    const resolution=d.status==='VALID'&&!nsource&&!conflicts&&!duplicates
      ? 'REVERIFY_WORKER_ELIGIBILITY'
      : nsource?'SOURCE_GAP'
      : conflicts||d.status==='CONFLICT'?'UNRESOLVED_CONFLICT'
      : d.status==='PRICE_SUSPICIOUS'?'PRICE_REVIEW_REQUIRED'
      :'OTHER_DIAGNOSTIC';
    records.push({date:d.date,status:d.status,resolution,sourceKinds:kinds,
      sourceErrors:nsource,missingCodes:missing,unresolvedConflicts:conflicts,
      duplicateKeys:duplicates,expectedRows:num(d.expectedRowCount),
      storedRows:num(d.storedRowCount)});
  }
  return {revision:payload.integritySourceRevision,
    records:records.sort((a,b)=>a.date.localeCompare(b.date))};
}
function inventorySame(a,b){
  return JSON.stringify(a)===JSON.stringify(b);
}
export function buildAudit(before,after,batches){
  if(!inventorySame(before,after))throw Error('ISSUE507_DEFERRED_QUEUE_MOVED');
  const dates=before.dates;
  if(dates.length>MAX_AUDIT_DATES)throw Error('ISSUE507_DEFERRED_AUDIT_PAGINATION_REQUIRED');
  const records=batches.flatMap(x=>x.records);
  if(records.length!==dates.length||
    records.some((x,i)=>x.date!==dates[i])||
    batches.some(x=>x.revision!==batches[0]?.revision))
    throw Error('ISSUE507_DEFERRED_DIAGNOSTICS_DRIFT');
  const grouped={};
  for(const r of records){
    grouped[r.resolution]=(grouped[r.resolution]||0)+1;
  }
  return {mode:'READ_ONLY',gasVersion:'9.244',totalDeferredDates:dates.length,
    pendingFrom:before.pendingFrom||'-',queueStable:true,
    sourceRevisionStable:true,records,grouped,
    originalDataWritten:false,deferredQueueChanged:false,
    sourceGapsAutomaticallyResolved:false,
    next:'Only exact-date confirmed KRX/NAV/FX under a separately approved backed-up writer may resolve genuine source gaps; conflict/manual dates remain protected.'};
}
async function request(url,token,action,args,fetchImpl){
  let response;
  try{response=await fetchImpl(url,{method:'POST',redirect:'follow',
    headers:{'content-type':'application/x-www-form-urlencoded;charset=UTF-8'},
    body:new URLSearchParams({action,...args,accessToken:token}),
    signal:AbortSignal.timeout(240000)});}
  catch{throw Error('ISSUE507_DEFERRED_NETWORK');}
  if(!response?.ok)throw Error('ISSUE507_DEFERRED_HTTP');
  try{return await response.json();}
  catch{throw Error('ISSUE507_DEFERRED_JSON');}
}
export async function runReadonly({url,token,fetchImpl=fetch}){
  const endpoint=validateWebAppUrl(url);
  if(typeof token!=='string'||!token.trim())throw Error('ISSUE507_DEFERRED_AUTH_MISSING');
  const bad=token==='ISSUE507_DEFERRED_BAD_AUTH'?'ISSUE507_DEFERRED_BAD_AUTH_ALT':'ISSUE507_DEFERRED_BAD_AUTH';
  const rejected=await request(endpoint,bad,'getAutomationStatus',{},fetchImpl);
  if(rejected?.status!=='error'||rejected.message!=='인증 실패')
    throw Error('ISSUE507_DEFERRED_AUTH_GUARD');
  const before=validateInventory(await request(endpoint,token,'getAutomationStatus',{},fetchImpl));
  if(before.dates.length>MAX_AUDIT_DATES)
    throw Error('ISSUE507_DEFERRED_AUDIT_PAGINATION_REQUIRED');
  const batches=[];
  for(let i=0;i<before.dates.length;i+=CHUNK_SIZE){
    const chunk=before.dates.slice(i,i+CHUNK_SIZE);
    batches.push(summarizeBatch(await request(endpoint,token,
      'diagnoseSnapshotIntegrityRange',{dates:chunk.join(',')},fetchImpl),chunk));
  }
  const after=validateInventory(await request(endpoint,token,'getAutomationStatus',{},fetchImpl));
  return buildAudit(before,after,batches);
}
export async function selfTest(){
  const dates=['2025-12-31','2026-01-01','2026-01-02',
    '2026-01-05','2026-01-06','2026-01-07','2026-01-08'];
  const snapshot=()=>({status:'ok',gasVersion:'9.244',automation:{
    gasVersion:'9.244',tradeSnapshotDeferredDates:dates.slice(),
    tradeSnapshotDeferredCount:dates.length,
    tradeSnapshotDeferredOldestDate:dates[0],tradeSnapshotDeferredCursor:'2026-01-01',
    pendingTradeSnapshotRebuildFrom:'2026-01-09'}});
  const diag=arr=>({status:'ok',checkedDates:arr,integritySourceRevision:'541',
    diagnostics:arr.map((date,i)=>({date,status:i===0?'SOURCE_INCOMPLETE':'VALID',
      expectedRowCount:3,storedRowCount:3,missingCodes:[],duplicateKeys:[],
      sourceDataErrors:i===0?['KRX 가격 원자료 없음 - SECRET_CODE SECRET_COST']:[],
      duplicateSummary:{unresolvedConflict:0}}))});
  const calls=[],fixture=async(_url,opts)=>{
    const action=opts.body.get('action'),auth=opts.body.get('accessToken'),ds=opts.body.get('dates');
    calls.push(action);
    const payload=auth!=='SYNTHETIC_TOKEN'?{status:'error',message:'인증 실패'}
      :action==='getAutomationStatus'?snapshot()
      :diag(ds.split(','));
    return {ok:true,json:async()=>payload};
  };
  const audit=await runReadonly({url:'https://script.google.com/macros/s/TEST/exec',
    token:'SYNTHETIC_TOKEN',fetchImpl:fixture});
  assert.equal(audit.totalDeferredDates,7);
  assert.equal(audit.grouped.SOURCE_GAP,2);
  assert.equal(audit.grouped.REVERIFY_WORKER_ELIGIBILITY,5);
  assert.equal(audit.queueStable,true);
  assert.equal(audit.originalDataWritten,false);
  assert.deepEqual(calls,['getAutomationStatus','getAutomationStatus',
    'diagnoseSnapshotIntegrityRange','diagnoseSnapshotIntegrityRange','getAutomationStatus']);
  assert.ok(!JSON.stringify(audit).includes('SECRET_CODE'));
  assert.ok(!JSON.stringify(audit).includes('SECRET_COST'));
  assert.ok(!JSON.stringify(audit).includes('SYNTHETIC_TOKEN'));
  const changed=snapshot();changed.automation.tradeSnapshotDeferredDates.pop();
  assert.throws(()=>validateInventory(changed),/INVENTORY_SCHEMA/);
  assert.throws(()=>validateInventory({...snapshot(),gasVersion:'9.243'}),/INVENTORY_SCHEMA/);
  const a=validateInventory(snapshot());
  assert.throws(()=>buildAudit(a,{...a,pendingFrom:'2026-01-10'},[]),/QUEUE_MOVED/);
  const one=summarizeBatch(diag(dates.slice(0,6)),dates.slice(0,6));
  assert.throws(()=>buildAudit(a,a,[one]),/DRIFT/);
  const weird=diag([dates[0]]);weird.diagnostics[0].status='INVALID';
  assert.throws(()=>summarizeBatch(weird,[dates[0]]),/RECORD/);
  // Execute both ACTUAL v9.244 GAS production functions against inert
  // ScriptProperties to prove complete deferred dates/cursor are surfaced
  // without any setProperty/deleteProperty calls.
  const source=fs.readFileSync(new URL('../src/gas/apps_script.gs',import.meta.url),'utf8');
  const extract=(start,end)=>{
    const a=source.indexOf('function '+start+'(');
    const b=source.indexOf('function '+end+'(',a);
    assert.ok(a>0&&b>a,'GAS production function boundaries');
    return source.slice(a,b);
  };
  const fakeProps={getProperty:k=>k==='trade_snapshot_rebuild_deferred_v1'
    ?JSON.stringify({dates:dates.slice(),cursor:'2026-01-01'}):'',
    setProperty:()=>{throw Error('ISSUE507_DEFERRED_FORBIDDEN_PROPERTY_WRITE');},
    deleteProperty:()=>{throw Error('ISSUE507_DEFERRED_FORBIDDEN_PROPERTY_WRITE');}};
  const ctx={
    PropertiesService:{getScriptProperties:()=>fakeProps},
    TRADE_SNAPSHOT_DEFERRED_DATES_KEY:'trade_snapshot_rebuild_deferred_v1',
    CONFIG:{SHEET_SNAPSHOT:'SNAP',SHEET_PH:'PH'},
    _normalizeDate:x=>x,
    getss:()=>({getSheetByName:()=>null}),
    _ensureDailyTriggers:()=>({}),_getLatestLifecycleValidSnapshotDate:()=>'-',
    _getLatestDateInColumn:()=>'-',_getOfficialKrxPriceHistoryLastDate:()=>'-',
    _portfolioCloseRunState:()=>({state:'NEVER_RUN'}),
    _fundAttemptDiagnosticState_:()=>null,
    _expectedConfirmedSnapshotDate:()=>'-',
    _expectedPortfolioCloseRunDate:()=>'-',_isPortfolioCloseRunStale:()=>false,
    _readPendingKrxCloseDates_:()=>[],
    TRADE_SNAPSHOT_REBUILD_PENDING_KEY:'trade_snapshot_pending',
    TRADE_SNAPSHOT_WORKER_LAST_KEY:'trade_snapshot_worker_last',
    TRADE_SNAPSHOT_WORKER_BUSY_KEY:'trade_snapshot_worker_busy',
    _tradeLedgerWriteUnverified_:()=>false,
    _getTradeSnapshotWorkerTriggerAudit_:()=>({}),
    Utilities:{formatDate:()=> '2026-10-20 11:00:00'},
  };
  vm.createContext(ctx);
  vm.runInContext(extract('_readTradeSnapshotDeferredState_','_writeTradeSnapshotDeferredState_')
    +'\n'+extract('_getAutomationStatusData','handleGetAutomationStatus'),ctx);
  const production=vm.runInContext('_getAutomationStatusData()',ctx);
  assert.equal(production.gasVersion,'9.244');
  assert.equal(JSON.stringify(production.tradeSnapshotDeferredDates),JSON.stringify(dates));
  assert.equal(production.tradeSnapshotDeferredCursor,'2026-01-01');
  assert.equal(production.tradeSnapshotDeferredCount,dates.length);
  console.log('Issue #507 deferred-date all-inventory source audit synthetic/production VM: PASS');
}
if(process.argv.includes('--self-test')){
  try{await selfTest();}
  catch(e){console.error(String(e?.message||'ISSUE507_DEFERRED_SELFTEST_FAILED'));process.exitCode=1;}
}else{
  try{console.log(JSON.stringify(await runReadonly({
    url:process.env.GAS_WEB_APP_URL,token:process.env.GAS_ACCESS_TOKEN})));
  }catch(e){
    const message=String(e?.message||'');
    console.error(/^ISSUE507_DEFERRED_[A-Z_]+$/.test(message)?message:'ISSUE507_DEFERRED_UNKNOWN');
    process.exitCode=1;
  }
}