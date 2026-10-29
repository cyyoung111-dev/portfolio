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
const SUPPORTED_GAS_VERSION=new Set(['9.244','9.245','9.246','9.247','9.248','9.249','9.250','9.251','9.252','9.253','9.254','9.255','9.256','9.257','9.258','9.273','9.274','9.278']);
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
  if(payload?.status!=='ok'||!SUPPORTED_GAS_VERSION.has(payload.gasVersion)||
    !a||a.gasVersion!==payload.gasVersion||
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
    pendingFrom:a.pendingTradeSnapshotRebuildFrom,gasVersion:payload.gasVersion};
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
// Production GAS v9.244 returns {status:'error',errorCode,phase} when a
// STRICT READ_ONLY range diagnosis cannot complete. Never log the returned
// message, diagnostic cells, script metadata, account data or raw payload.
// A non-success response must still fail closed; distinguish it from an
// actual response-contract mismatch so the next action is diagnosable.
const GAS_ERROR_CODES=new Set(['RUNTIME_ERROR','SOURCE_DATA_ERROR',
  'SOURCE_CONTENT_CHANGED','SOURCE_REVISION_CHANGED','RANGE_TOO_LARGE']);
const GAS_ERROR_PHASES=new Set(['request_validation','sheet_read',
  'index_build','snapshot_integrity']);
// The running GAS v9.244 handler places both ScriptLock acquisition and its
// strict, non-mutating revision-state check in "request_validation".
// Only map known server error signatures to CONSTANT categories; never print
// GAS response.message, holding codes, balances, or other untrusted details.
// Lock-timeout is a reported hint, not a proven exception stack trace.
export function safeRequestValidationCause(payload,code,phase){
  if(code!=='RUNTIME_ERROR'||phase!=='REQUEST_VALIDATION')return '';
  const message=payload?.message;
  if(message==='ISSUE507_REVISION_UNVERIFIED')
    return '_REVISION_UNVERIFIED';
  if(typeof message==='string'&&message.length<=180 &&
    /^(?:Exception: )?Lock timeout(?::|$)/.test(message))
    return '_LOCK_TIMEOUT_REPORTED';
  return '';
}
export function assertDiagnosticEnvelope(payload,dates){
  if(payload?.status==='error'){
    const code=GAS_ERROR_CODES.has(payload.errorCode)?payload.errorCode:'UNKNOWN';
    const phase=GAS_ERROR_PHASES.has(payload.phase)
      ?payload.phase.toUpperCase():'UNKNOWN';
    throw Error('ISSUE507_DEFERRED_GAS_'+code+'_'+phase+
      safeRequestValidationCause(payload,code,phase));
  }
  if(payload?.status!=='ok')throw Error('ISSUE507_DEFERRED_RESPONSE_STATUS_SCHEMA');
  if(!Array.isArray(payload.checkedDates)||!Array.isArray(payload.diagnostics))
    throw Error('ISSUE507_DEFERRED_RESPONSE_ARRAY_SCHEMA');
  if(payload.checkedDates.length!==dates.length||
    payload.diagnostics.length!==dates.length)
    throw Error('ISSUE507_DEFERRED_RESPONSE_LENGTH_SCHEMA');
  if(typeof payload.integritySourceRevision!=='string' ||
    !payload.integritySourceRevision)
    throw Error('ISSUE507_DEFERRED_REVISION_SCHEMA');
  if(typeof payload.strictSourceDigest!=='string' ||
    !/^[a-f0-9]{64}$/.test(payload.strictSourceDigest))
    throw Error('ISSUE507_DEFERRED_DIGEST_SCHEMA');
  if(payload.checkedDates.slice().sort().join('|')!==dates.slice().sort().join('|'))
    throw Error('ISSUE507_DEFERRED_DATES_SCHEMA');
}
export function summarizeBatch(payload,dates){
  assertDiagnosticEnvelope(payload,dates);
  const seen=new Set(),records=[];
  for(const d of payload.diagnostics){
    if(!d||!dates.includes(d.date)||seen.has(d.date)||!STATUS.has(d.status)||
      !Array.isArray(d.missingCodes)||!Array.isArray(d.sourceDataErrors)||
      !Array.isArray(d.duplicateKeys))
      throw Error('ISSUE507_DEFERRED_DIAGNOSTIC_RECORD');
    seen.add(d.date);
    const dup=d.duplicateSummary;
    const nsource=num(d.sourceDataErrors.length),missing=num(d.missingCodes.length),
      conflicts=num(dup?.unresolvedConflict??0),duplicates=num(d.duplicateKeys.length),
      manualProtected=num(dup?.manualProtected??0),sourceBlockedDuplicates=num(dup?.sourceIncomplete??0),
      autoExactDuplicates=num(dup?.exactDuplicate??0),autoExpectedMatch=num(dup?.singleExpectedMatch??0);
    const kinds=sourceKinds(d.sourceDataErrors);
    // MissingCodes are expected holdings absent from the STORED Snapshot.
    // They do NOT prove an absent KRX price, foreign FX rate or fund NAV.
    const hasUnderlyingSourceError=nsource>0||d.status==='SOURCE_INCOMPLETE';
    const hasRawDuplicate=duplicates>0||conflicts>0||manualProtected>0||
      sourceBlockedDuplicates>0||autoExactDuplicates>0||autoExpectedMatch>0;
    const hasProtectedConflict=conflicts>0||manualProtected>0||d.status==='CONFLICT';
    const resolution=hasUnderlyingSourceError
      ?(hasRawDuplicate?'SOURCE_ERROR_WITH_SNAPSHOT_DUPLICATES':'SOURCE_GAP')
      :hasProtectedConflict
      ?(missing>0?'SNAPSHOT_CONFLICT_WITH_MISSING_ROWS':'SNAPSHOT_CONFLICT')
      :hasRawDuplicate
      ?(missing>0?'SNAPSHOT_DUPLICATES_WITH_MISSING_ROWS':'SNAPSHOT_DUPLICATES_REVIEW')
      :d.status==='PRICE_SUSPICIOUS'?'PRICE_REVIEW_REQUIRED'
      :missing>0?'SNAPSHOT_MISSING_ROWS'
      :d.status==='VALID'?'REVERIFY_WORKER_ELIGIBILITY'
      :'OTHER_DIAGNOSTIC';
    records.push({date:d.date,status:d.status,resolution,sourceKinds:kinds,
      sourceErrors:nsource,missingCodes:missing,unresolvedConflicts:conflicts,
      duplicateKeys:duplicates,manualProtectedGroups:manualProtected,
      sourceBlockedDuplicateGroups:sourceBlockedDuplicates,
      exactDuplicateGroups:autoExactDuplicates,expectedMatchDuplicateGroups:autoExpectedMatch,
      expectedRows:num(d.expectedRowCount),storedRows:num(d.storedRowCount)});
  }
  return {revision:payload.integritySourceRevision,
    // Internal-only: never emit source digest in user-visible audit output.
    sourceDigest:payload.strictSourceDigest,
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
    batches.some(x=>x.revision!==batches[0]?.revision ||
      x.sourceDigest!==batches[0]?.sourceDigest))
    throw Error('ISSUE507_DEFERRED_DIAGNOSTICS_DRIFT');
  const grouped={};
  for(const r of records){
    grouped[r.resolution]=(grouped[r.resolution]||0)+1;
  }
  return {mode:'READ_ONLY',gasVersion:before.gasVersion,totalDeferredDates:dates.length,
    pendingFrom:before.pendingFrom||'-',queueStable:true,
    sourceRevisionStable:true,records,grouped,
    originalDataWritten:false,deferredQueueChanged:false,
    sourceGapsAutomaticallyResolved:false,
    next:'MissingCodes count means STORED Snapshot rows missing, not missing source prices. Repair verified exact-date KRX/NAV/FX gaps first; protect RAW duplicate/MANUAL groups and use a separate approval-gated backed-up Snapshot reconciliation for conflicts.'};
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
      'diagnoseSnapshotIntegrityRange',{dates:chunk.join(','),strictReadonly:'1'},fetchImpl),chunk));
  }
  const after=validateInventory(await request(endpoint,token,'getAutomationStatus',{},fetchImpl));
  return buildAudit(before,after,batches);
}
export async function selfTest(){
  // Manual workflow_dispatch can select a non-main branch. Its runtime uses a
  // real GAS token, so contract-only PR checks must never reach live GAS.
  const workflow=fs.readFileSync(new URL(
    '../.github/workflows/issue-507-deferred-source-audit-readonly.yml',
    import.meta.url),'utf8');
  assert.match(workflow,/operational-readonly:\s*\n\s*if: github\.ref == 'refs\/heads\/main' && github\.event_name == 'workflow_dispatch'/,
    'live audit must run only from approved main via explicit dispatch');
  const dates=['2025-12-31','2026-01-01','2026-01-02',
    '2026-01-05','2026-01-06','2026-01-07','2026-01-08'];
  const snapshot=()=>({status:'ok',gasVersion:'9.244',automation:{
    gasVersion:'9.244',tradeSnapshotDeferredDates:dates.slice(),
    tradeSnapshotDeferredCount:dates.length,
    tradeSnapshotDeferredOldestDate:dates[0],tradeSnapshotDeferredCursor:'2026-01-01',
    pendingTradeSnapshotRebuildFrom:'2026-01-09'}});
  const diag=arr=>({status:'ok',checkedDates:arr,integritySourceRevision:'541',
    strictSourceDigest:'a'.repeat(64),
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
  // Error buckets must distinguish GAS's server-side fail-closed result
  // from a response schema mismatch, while never printing untrusted messages.
  for(const [code,phase] of [
    ['SOURCE_DATA_ERROR','sheet_read'],['RUNTIME_ERROR','snapshot_integrity'],
    ['SOURCE_CONTENT_CHANGED','snapshot_integrity'],
    ['SOURCE_REVISION_CHANGED','snapshot_integrity'],
    ['RANGE_TOO_LARGE','request_validation']
  ]){
    const payload={status:'error',errorCode:code,phase,
      message:'SECRET_HOLDING_AND_PRICE',failedDate:dates[0]};
    const expected='ISSUE507_DEFERRED_GAS_'+code+'_'+phase.toUpperCase();
    assert.throws(()=>summarizeBatch(payload,dates),e=>
      e.message===expected&&!e.message.includes('SECRET_'));
  }
  // Production revision-state corruption/missing metadata and Apps Script
  // lock contention share REQUEST_VALIDATION until a known safe signature is
  // recognized. Unknown/sensitive text must remain invisible and fail closed.
  assert.throws(()=>summarizeBatch({status:'error',errorCode:'RUNTIME_ERROR',
    phase:'request_validation',message:'ISSUE507_REVISION_UNVERIFIED'},dates),
    e=>e.message==='ISSUE507_DEFERRED_GAS_RUNTIME_ERROR_REQUEST_VALIDATION_REVISION_UNVERIFIED');
  assert.throws(()=>summarizeBatch({status:'error',errorCode:'RUNTIME_ERROR',
    phase:'request_validation',
    message:'Exception: Lock timeout: another process was holding the lock for too long.'},dates),
    e=>e.message==='ISSUE507_DEFERRED_GAS_RUNTIME_ERROR_REQUEST_VALIDATION_LOCK_TIMEOUT_REPORTED');
  assert.throws(()=>summarizeBatch({status:'error',errorCode:'RUNTIME_ERROR',
    phase:'request_validation',message:'ISSUE507_REVISION_UNVERIFIED SECRET_TOKEN'},dates),
    e=>e.message==='ISSUE507_DEFERRED_GAS_RUNTIME_ERROR_REQUEST_VALIDATION');
  assert.throws(()=>summarizeBatch({status:'error',errorCode:'RUNTIME_ERROR',
    phase:'request_validation',message:'Lock timeout: ACCOUNT=SECRET_HOLDINGS'},dates),
    e=>e.message==='ISSUE507_DEFERRED_GAS_RUNTIME_ERROR_REQUEST_VALIDATION_LOCK_TIMEOUT_REPORTED'
      &&!e.message.includes('SECRET_'));
  assert.throws(()=>summarizeBatch({status:'error',errorCode:'SOURCE_DATA_ERROR',
    phase:'sheet_read',message:'ISSUE507_REVISION_UNVERIFIED'},dates),
    e=>e.message==='ISSUE507_DEFERRED_GAS_SOURCE_DATA_ERROR_SHEET_READ');
  assert.throws(()=>summarizeBatch({status:'error',errorCode:'SECRET_ACCOUNT',
    phase:'SECRET_PHASE',message:'SECRET_HOLDING'},dates),
    e=>e.message==='ISSUE507_DEFERRED_GAS_UNKNOWN_UNKNOWN');
  assert.throws(()=>summarizeBatch({status:'unexpected'},dates),
    /ISSUE507_DEFERRED_RESPONSE_STATUS_SCHEMA/);
  assert.throws(()=>summarizeBatch({status:'ok'},dates),
    /ISSUE507_DEFERRED_RESPONSE_ARRAY_SCHEMA/);
  assert.throws(()=>summarizeBatch({...diag(dates),diagnostics:[]},dates),
    /ISSUE507_DEFERRED_RESPONSE_LENGTH_SCHEMA/);
  assert.throws(()=>summarizeBatch({...diag(dates),integritySourceRevision:null},dates),
    /ISSUE507_DEFERRED_REVISION_SCHEMA/);
  assert.throws(()=>summarizeBatch({...diag(dates),strictSourceDigest:undefined},dates),
    /ISSUE507_DEFERRED_DIGEST_SCHEMA/);
  assert.throws(()=>summarizeBatch({...diag(dates),checkedDates:dates.map((d,i)=>
    i===0?'2026-01-09':d)},dates),
    /ISSUE507_DEFERRED_DATES_SCHEMA/);
  const changed=snapshot();changed.automation.tradeSnapshotDeferredDates.pop();
  assert.throws(()=>validateInventory(changed),/INVENTORY_SCHEMA/);
  assert.throws(()=>validateInventory({...snapshot(),gasVersion:'9.243'}),/INVENTORY_SCHEMA/);
  const prior=snapshot();
  prior.gasVersion='9.252';prior.automation.gasVersion='9.252';
  assert.doesNotThrow(()=>validateInventory(prior),
    'read-only inventory must remain compatible with earlier approved GAS v9.252');
  const a=validateInventory(snapshot());
  assert.throws(()=>buildAudit(a,{...a,pendingFrom:'2026-01-10'},[]),/QUEUE_MOVED/);
  const one=summarizeBatch(diag(dates.slice(0,6)),dates.slice(0,6));
  assert.throws(()=>buildAudit(a,a,[one]),/DRIFT/);
  const other=summarizeBatch({...diag(dates.slice(6)),strictSourceDigest:'b'.repeat(64)},dates.slice(6));
  assert.throws(()=>buildAudit(a,a,[one,other]),/DRIFT/);
  const mixed=diag([dates[0]]);
  mixed.diagnostics[0].status='SOURCE_INCOMPLETE';
  mixed.diagnostics[0].duplicateSummary.unresolvedConflict=1;
  mixed.diagnostics[0].duplicateKeys=['HIDDEN_DUPLICATE_CODE'];
  assert.equal(summarizeBatch(mixed,[dates[0]]).records[0].resolution,
    'SOURCE_ERROR_WITH_SNAPSHOT_DUPLICATES');
  const codeOnly=diag([dates[0]]);
  codeOnly.diagnostics[0].sourceDataErrors=[];
  codeOnly.diagnostics[0].status='PARTIAL';
  codeOnly.diagnostics[0].missingCodes=['HIDDEN_CODE'];
  assert.equal(summarizeBatch(codeOnly,[dates[0]]).records[0].resolution,'SNAPSHOT_MISSING_ROWS');
  const conflict=diag([dates[0]]);
  conflict.diagnostics[0].status='CONFLICT';
  conflict.diagnostics[0].sourceDataErrors=[];
  conflict.diagnostics[0].missingCodes=['HIDDEN_MISSING_CODE'];
  conflict.diagnostics[0].duplicateKeys=['HIDDEN_DUPLICATE_CODE'];
  conflict.diagnostics[0].duplicateSummary={unresolvedConflict:1,manualProtected:1,
    exactDuplicate:0,singleExpectedMatch:0,sourceIncomplete:0};
  const conflictResult=summarizeBatch(conflict,[dates[0]]).records[0];
  assert.equal(conflictResult.resolution,'SNAPSHOT_CONFLICT_WITH_MISSING_ROWS');
  assert.equal(conflictResult.sourceErrors,0);
  assert.equal(conflictResult.manualProtectedGroups,1);
  assert.equal(conflictResult.missingCodes,1);
  assert.ok(!JSON.stringify(conflictResult).includes('HIDDEN_'));
  const pendingDup=diag([dates[0]]);
  pendingDup.diagnostics[0].duplicateKeys=['HIDDEN_DUPLICATE_CODE'];
  pendingDup.diagnostics[0].duplicateSummary={unresolvedConflict:0,
    sourceIncomplete:1,exactDuplicate:0,singleExpectedMatch:0,manualProtected:0};
  assert.equal(summarizeBatch(pendingDup,[dates[0]]).records[0].resolution,
    'SOURCE_ERROR_WITH_SNAPSHOT_DUPLICATES');
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
  let revisionRaw=JSON.stringify({revision:541,all:541,dates:{},ranges:[]});
  let propertyWrites=0;
  const fakeProps={getProperty:k=>k==='trade_snapshot_rebuild_deferred_v1'
    ?JSON.stringify({dates:dates.slice(),cursor:'2026-01-01'})
    :k==='snapshot_integrity_source_revision_v1'?revisionRaw:'',
    setProperty:()=>{propertyWrites++;throw Error('ISSUE507_DEFERRED_FORBIDDEN_PROPERTY_WRITE');},
    deleteProperty:()=>{propertyWrites++;throw Error('ISSUE507_DEFERRED_FORBIDDEN_PROPERTY_WRITE');}};
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
    Utilities:{formatDate:()=> '2026-10-20 11:00:00',
      DigestAlgorithm:{SHA_256:'SHA_256'},
      computeDigest:(_algorithm,payload)=>Array(32).fill(String(payload).includes('[[2]]')?11:10)},
    LockService:{getScriptLock:()=>({hasLock:()=>false,waitLock:()=>{},
      releaseLock:()=>{}})},
  };
  vm.createContext(ctx);
  vm.runInContext(extract('_readTradeSnapshotDeferredState_','_writeTradeSnapshotDeferredState_')
    +'\n'+extract('_krxClosePublicationState_','_getAutomationStatusData')
    +'\n'+extract('_getAutomationStatusData','handleGetAutomationStatus'),ctx);
  const production=vm.runInContext('_getAutomationStatusData()',ctx);
  assert.equal(production.gasVersion,'9.278');
  assert.equal(JSON.stringify(production.tradeSnapshotDeferredDates),JSON.stringify(dates));
  assert.equal(production.tradeSnapshotDeferredCursor,'2026-01-01');
  assert.equal(production.tradeSnapshotDeferredCount,dates.length);
  // Actually execute production range diagnosis and the production STRICT
  // revision accessor with a write-trap. Pre-migration/legacy/damaged state
  // must fail closed; it must NEVER self-heal ScriptProperties in READ ONLY.
  ctx.SNAPSHOT_INTEGRITY_SOURCE_REVISION_KEY='snapshot_integrity_source_revision_v1';
  ctx.SNAPSHOT_INTEGRITY_STATE_MAX_CHARS=7000;
  ctx._buildSnapshotRangeReadContext=()=>({ss:{},readMs:0,
    metrics:{sheetReads:0,priceHistoryRows:0,snapshotRows:0,tradeRows:0,
      fundNavRows:0,fxRows:0}});
  ctx._buildSnapshotRangeIndexes=()=>({priceIntegrityByDate:{},
    indexBuildMs:0,metrics:{holdingsBuildCount:0,priceSeriesBuildCount:0,
      priceIntegrityBuildCount:0,snapshotDateLookupCount:0,fundNavLookupCount:0,
      fxLookupCount:0}});
  ctx.diagnoseSnapshotIntegrity=(_ss,date)=>({date,status:'SOURCE_INCOMPLETE',
    sourceDataErrors:['PRIVATE_CODE_DO_NOT_PRINT'],missingCodes:[],
    duplicateKeys:[],duplicateSummary:{unresolvedConflict:0}});
  ctx.jsonOk=x=>({status:'ok',...x});
  ctx._getSnapshotIntegritySourceRevision=()=>{
    throw Error('ISSUE507_DEFERRED_MUTATING_REVISION_READER_CALLED');};
  vm.runInContext(extract('_isSnapshotIntegrityRevision','_getSnapshotIntegrityRevisionState')
    +'\n'+extract('_peekSnapshotIntegritySourceRevisionReadonly_','_isSnapshotIntegrityRevision')
    +'\n'+extract('_issue507StrictReadSourceDigest_','handleDiagnoseSnapshotIntegrityRange')
    +'\n'+extract('handleDiagnoseSnapshotIntegrityRange','_oct08FundSourceOnlyProof_'),ctx);
  const invoke=()=>vm.runInContext(
    'handleDiagnoseSnapshotIntegrityRange("", "", "", "2025-12-31", "1")',ctx);
  const fresh=invoke();
  assert.equal(fresh.status,'ok');
  assert.equal(fresh.integritySourceRevision,'541');
  assert.equal(fresh.strictSourceDigest,'0a'.repeat(32));
  assert.equal(propertyWrites,0);
  for(const invalid of ['', '540', '{bad JSON', 'X'.repeat(7001),
    JSON.stringify({revision:541,all:541,dates:[],ranges:[]})]){
    revisionRaw=invalid;
    const blocked=invoke();
    assert.equal(blocked.status,'error');
    assert.equal(blocked.errorCode,'RUNTIME_ERROR');
    assert.equal(propertyWrites,0);
  }
  revisionRaw=JSON.stringify({revision:541,all:541,dates:{},ranges:[]});
  const originalRangeRead=ctx._buildSnapshotRangeReadContext;
  ctx._buildSnapshotRangeReadContext=()=>{
    // Producer changes revision after the pre-read checkpoint, while the
    // original data would otherwise look consistent.
    revisionRaw=JSON.stringify({revision:542,all:542,dates:{},ranges:[]});
    return originalRangeRead();
  };
  const changedMidRead=invoke();
  assert.equal(changedMidRead.status,'error');
  assert.equal(changedMidRead.errorCode,'SOURCE_REVISION_CHANGED');
  assert.equal(propertyWrites,0);
  ctx._buildSnapshotRangeReadContext=originalRangeRead;
  // Revision can stay unchanged while a concurrent writer has already set
  // source cells. Strict second full-sheet scan must detect this gap.
  let rawReadCount=0;
  ctx._buildSnapshotRangeReadContext=()=>{
    rawReadCount++;
    return {...originalRangeRead(),valuesByName:{TEST:rawReadCount>1?[[2]]:[[1]]}};
  };
  revisionRaw=JSON.stringify({revision:541,all:541,dates:{},ranges:[]});
  const changedBeforeRevision=invoke();
  assert.equal(changedBeforeRevision.status,'error');
  assert.equal(changedBeforeRevision.errorCode,'SOURCE_CONTENT_CHANGED');
  assert.equal(propertyWrites,0);
  ctx._buildSnapshotRangeReadContext=originalRangeRead;
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
