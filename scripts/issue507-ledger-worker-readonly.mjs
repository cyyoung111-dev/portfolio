#!/usr/bin/env node
// Issue #507: authenticated READ-ONLY evidence after GAS trigger installation.
// A healthy trigger does not prove its first hourly invocation. This script
// intentionally NEVER invokes the worker, reconciles a queue or writes prices,
// ledger, Snapshot, NAV, ScriptProperties or backup data.
import assert from 'node:assert/strict';
import {validateWebAppUrl} from './diagnose-krx-operational.mjs';
import {runBackfillStatus} from './diagnose-backfill-status.mjs';

export const EARLY=['2025-12-31','2026-01-01','2026-01-02','2026-01-05','2026-01-06'];
export const REGRESSION=['2026-06-05','2026-09-15','2026-09-16'];
const STATES=new Set(['VALID','PARTIAL','MISMATCH','CONFLICT',
  'SOURCE_INCOMPLETE','NO_SNAPSHOT','PRICE_SUSPICIOUS']);
const DATE=/^\d{4}-\d{2}-\d{2}$/;
// Only exact, source-defined error codes may leave the process. Never emit
// dependency messages or accept arbitrary strings merely sharing a prefix.
const SAFE_FAILURE_CODES=new Set([
  'AUTOMATION_DIAG_AUTH_DISABLED',
  'AUTOMATION_DIAG_BAD_CHECKPOINT',
  'AUTOMATION_DIAG_BAD_DATE',
  'AUTOMATION_DIAG_BAD_DEFERRED_COUNT',
  'AUTOMATION_DIAG_BAD_DEFERRED_DATE',
  'AUTOMATION_DIAG_BAD_HISTORICAL_CHECKPOINT',
  'AUTOMATION_DIAG_BAD_LEDGER_PENDING',
  'AUTOMATION_DIAG_BAD_LEDGER_WORKER_BUSY',
  'AUTOMATION_DIAG_BAD_LEDGER_WORKER_CHECKPOINT',
  'AUTOMATION_DIAG_BAD_LEDGER_WRITE',
  'AUTOMATION_DIAG_BAD_OBSERVATION_TIME',
  'AUTOMATION_DIAG_BAD_QUEUE',
  'AUTOMATION_DIAG_BAD_RESPONSE',
  'AUTOMATION_DIAG_BAD_TRIGGER',
  'AUTOMATION_DIAG_BAD_WORKER_TRIGGER_AUDIT',
  'AUTOMATION_DIAG_HTTP_FAILED',
  'AUTOMATION_DIAG_NETWORK_FAILED',
  'AUTOMATION_DIAG_NON_JSON',
  'AUTOMATION_DIAG_TOKEN_MISSING',
  'ISSUE507_AUTOMATION_SCHEMA',
  'ISSUE507_BAD_EXPECTED_ROWS',
  'ISSUE507_BAD_STORED_ROWS',
  'ISSUE507_BAD_DUPLICATE_GROUPS',
  'ISSUE507_BAD_UNRESOLVED_CONFLICTS',
  'ISSUE507_DIAGNOSTIC_DATE_OR_STATUS',
  'ISSUE507_DIAGNOSTIC_INVALID',
  'ISSUE507_DIAGNOSTIC_MISSING',
  'ISSUE507_DIAGNOSTIC_SOURCE_SCHEMA',
  'ISSUE507_HTTP_ERROR',
  'ISSUE507_JSON_ERROR',
  'ISSUE507_MISSING_DATE',
  'ISSUE507_NETWORK_ERROR',
  'ISSUE507_PENDING_DATE_INVALID',
  'ISSUE507_TOKEN_MISSING',
  'KRX_DIAG_INVALID_WEB_APP_URL',
]);
export function safeReadonlyFailureCode(error) {
  const code=typeof error?.message==='string'?error.message:'';
  return SAFE_FAILURE_CODES.has(code)?code:'ISSUE507_UNKNOWN_FAILURE';
}

function count(x,name){
  if(!Number.isSafeInteger(x)||x<0)throw new Error('ISSUE507_BAD_'+name);
  return x;
}
export function summarizeDiagnostics(payload,dates) {
  if(payload?.status!=='ok'||!Array.isArray(payload.checkedDates)
    ||!Array.isArray(payload.diagnostics)||payload.checkedDates.length!==dates.length
    ||payload.diagnostics.length!==dates.length)
    throw new Error('ISSUE507_DIAGNOSTIC_INVALID');
  const found=new Set(),out=[];
  for(const entry of payload.diagnostics) {
    if(!entry||typeof entry.date!=='string'||!DATE.test(entry.date)
      ||!dates.includes(entry.date)||found.has(entry.date)||!STATES.has(entry.status))
      throw new Error('ISSUE507_DIAGNOSTIC_DATE_OR_STATUS');
    found.add(entry.date);
    const expectedRows=count(entry.expectedRowCount,'EXPECTED_ROWS');
    const storedRows=count(entry.storedRowCount,'STORED_ROWS');
    const duplicateGroups=count(entry.duplicateSummary?.groups,'DUPLICATE_GROUPS');
    const unresolvedConflicts=count(entry.duplicateSummary?.unresolvedConflict,'UNRESOLVED_CONFLICTS');
    const sourceErrors=Array.isArray(entry.sourceDataErrors)?entry.sourceDataErrors.length:null;
    if(sourceErrors===null)throw new Error('ISSUE507_DIAGNOSTIC_SOURCE_SCHEMA');
    out.push({date:entry.date,status:entry.status,expectedRows,storedRows,
      duplicateGroups,unresolvedConflicts,sourceErrorCount:sourceErrors});
  }
  if(payload.checkedDates.some(d=>!found.has(d))
    ||new Set(payload.checkedDates).size!==dates.length
    ||dates.some(d=>!found.has(d)))
    throw new Error('ISSUE507_DIAGNOSTIC_MISSING');
  return out.sort((a,b)=>a.date.localeCompare(b.date));
}
export function summarizeEvidence(automation,diagnostics){
  if(!automation||automation.mode!=='READ_ONLY'
    ||!['9.237','9.238','9.239','9.240','9.241','9.242','9.243','9.244',
      '9.255','9.256','9.257','9.258','9.273','9.274'].includes(automation.gasVersion)
    ||typeof automation.triggerReady!=='boolean'
    ||!Array.isArray(automation.triggerMissing)
    ||!Array.isArray(diagnostics)||diagnostics.length!==8)
    throw new Error('ISSUE507_AUTOMATION_SCHEMA');
  const byDate=Object.fromEntries(diagnostics.map(x=>[x.date,x]));
  if(EARLY.concat(REGRESSION).some(date=>!byDate[date]))
    throw new Error('ISSUE507_MISSING_DATE');
  const earlyIncomplete=EARLY.filter(date=>byDate[date].status!=='VALID');
  const septemberSafe=['2026-09-15','2026-09-16'].every(date=>
    byDate[date].status==='VALID'&&byDate[date].expectedRows===39
    &&byDate[date].storedRows===39);
  const june5=byDate['2026-06-05'];
  const pending=automation.pendingTradeSnapshotRebuildFrom;
  if(typeof pending!=='string'||!(pending==='-'||DATE.test(pending)))
    throw new Error('ISSUE507_PENDING_DATE_INVALID');
  // v9.238 explicitly exposes a sanitized timestamped worker heartbeat and
  // unresolved-day count. The trigger being installed is never execution proof.
  const worker=automation.tradeSnapshotWorkerLastResult;
  const workerVerified=!!(worker && worker.at);
  const deferredCount=automation.tradeSnapshotDeferredCount;
  const deferredOldest=automation.tradeSnapshotDeferredOldestDate || '-';
  const busy=automation.tradeSnapshotWorkerLastBusy;
  const staleRunning=workerVerified && worker.status==='RUNNING' &&
    Date.now()-Date.parse(worker.at)>7*60*1000;
  return {
    mode:'READ_ONLY',gasVersion:automation.gasVersion,
    triggerReady:automation.triggerReady,
    missingTriggerCount:automation.triggerMissing.length,
    overallStatus:automation.overallStatus,
    pendingTradeSnapshotRebuildFrom:pending,
    tradeLedgerWriteUnverified:automation.tradeLedgerWriteUnverified,
    workerLastExecution:workerVerified?worker.at:'NOT_OBSERVED',
    workerLastStatus:workerVerified?worker.status:'NOT_OBSERVED',
    workerLastPhase:workerVerified?(worker.phase||''):'NOT_OBSERVED',
    workerOriginalStartedAt:workerVerified?(worker.runStartedAt||worker.at):'NOT_OBSERVED',
    workerCompletedVerified:workerVerified && worker.status!=='RUNNING',
    workerStaleRunningSuspected:!!staleRunning,
    workerLastLockBusyAt:busy?busy.at:'NOT_OBSERVED',
    workerLastProcessed:workerVerified?worker.processed:null,
    workerLastDeferred:workerVerified?worker.deferred:null,
    workerFirstRunVerified:workerVerified,
    fingerprintBaselineVerified:false,
    workerBlockedDate:workerVerified?worker.blockedDate:'NOT_OBSERVED',
    deferredDateCount:deferredCount,
    deferredOldestDate:deferredOldest,
    earlyDateStatus:EARLY.map(date=>byDate[date]),
    earlyUnresolvedDateCount:earlyIncomplete.length,
    june5Status:june5.status,
    june5Expected:june5.expectedRows,
    june5Stored:june5.storedRows,
    june5UnresolvedConflicts:june5.unresolvedConflicts,
    septemberRegressionReady:septemberSafe,
    operationallyComplete:false
  };
}
async function request(url,token,dates,fetchImpl) {
  let response;
  try{response=await fetchImpl(url,{
    method:'POST',
    headers:{'content-type':'application/x-www-form-urlencoded;charset=UTF-8'},
    body:new URLSearchParams({
      action:'diagnoseSnapshotIntegrityRange',dates:dates.join(','),accessToken:token
    }),
    redirect:'follow',signal:AbortSignal.timeout(240000)});
  }catch{throw new Error('ISSUE507_NETWORK_ERROR');}
  if(!response?.ok)throw new Error('ISSUE507_HTTP_ERROR');
  try{return await response.json();}
  catch{throw new Error('ISSUE507_JSON_ERROR');}
}
export async function runReadonly({url,token,fetchImpl=fetch}){
  const endpoint=validateWebAppUrl(url);
  if(typeof token!=='string'||!token.trim())throw new Error('ISSUE507_TOKEN_MISSING');
  // runBackfillStatus independently enforces unauthorized-token rejection.
  const automation=await runBackfillStatus({url:endpoint,token,fetchImpl});
  const payloads=[];
  for(const dates of [EARLY,REGRESSION]){
    const response=await request(endpoint,token,dates,fetchImpl);
    payloads.push(summarizeDiagnostics(response,dates));
  }
  return summarizeEvidence(automation,payloads.flat());
}
export async function selfTest(){
  const sample=(date,status='VALID',countRows=33)=>({
    date,status,expectedRowCount:countRows,storedRowCount:countRows,
    duplicateSummary:{groups:0,unresolvedConflict:0},sourceDataErrors:[]
  });
  const early=EARLY.map((date,i)=>sample(date,i<4?'SOURCE_INCOMPLETE':'VALID'));
  const regress=REGRESSION.map((date,i)=>sample(date,i===0?'CONFLICT':'VALID',i===0?37:39));
  const a={mode:'READ_ONLY',gasVersion:'9.238',triggerReady:true,
    triggerMissing:[],overallStatus:'INCOMPLETE',
    pendingTradeSnapshotRebuildFrom:'-',tradeLedgerWriteUnverified:false,
    tradeSnapshotDeferredCount:0,tradeSnapshotDeferredOldestDate:'-',
    tradeSnapshotWorkerLastResult:null,tradeSnapshotWorkerLastBusy:null};
  const earlyEvidence=summarizeDiagnostics({status:'ok',checkedDates:EARLY,
    diagnostics:early},EARLY);
  const regressionEvidence=summarizeDiagnostics({status:'ok',checkedDates:REGRESSION,
    diagnostics:regress},REGRESSION);
  assert.equal(earlyEvidence.length,5);
  const evidence=earlyEvidence.concat(regressionEvidence);
  const out=summarizeEvidence(a,evidence);
  assert.equal(out.workerFirstRunVerified,false);
  assert.equal(out.workerLastExecution,'NOT_OBSERVED');
  assert.equal(out.workerCompletedVerified,false);
  assert.equal(out.workerLastLockBusyAt,'NOT_OBSERVED');
  assert.equal(out.deferredDateCount,0);
  const verified=summarizeEvidence({...a,
    pendingTradeSnapshotRebuildFrom:'2026-01-01',
    tradeSnapshotDeferredCount:1,
    tradeSnapshotDeferredOldestDate:'2025-12-31',
    tradeSnapshotWorkerLastResult:{
      status:'PENDING',at:'2026-10-19T09:01:02.000Z',
      processed:1,deferred:1,blockedDate:'',sourceCheck:'UNCHANGED'
    }},evidence);
  assert.equal(verified.workerFirstRunVerified,true);
  assert.equal(verified.workerCompletedVerified,true);
  assert.equal(verified.workerLastStatus,'PENDING');
  assert.equal(verified.workerLastProcessed,1);
  assert.equal(verified.workerLastDeferred,1);
  assert.equal(verified.deferredDateCount,1);
  assert.equal(verified.deferredOldestDate,'2025-12-31');
  assert.equal(verified.pendingTradeSnapshotRebuildFrom,'2026-01-01');
  const executing=summarizeEvidence({...a,gasVersion:'9.239',
    tradeSnapshotWorkerLastResult:{status:'RUNNING',at:'2026-10-19T08:01:00.000Z',
      processed:0,deferred:0,blockedDate:'',sourceCheck:''},
    tradeSnapshotWorkerLastBusy:{status:'BUSY',at:'2026-10-19T08:03:00.000Z'}},evidence);
  assert.equal(executing.workerFirstRunVerified,true);
  assert.equal(executing.workerCompletedVerified,false);
  assert.equal(executing.workerLastStatus,'RUNNING');
  const phased=summarizeEvidence({...a,gasVersion:'9.242',
    tradeSnapshotWorkerLastResult:{status:'RUNNING',
      at:'2026-10-19T11:07:00.000Z',runStartedAt:'2026-10-19T11:02:23.565Z',
      phase:'DATE_DIAGNOSTIC',processed:0,deferred:0,
      blockedDate:'2025-12-31',sourceCheck:''}},evidence);
  assert.equal(phased.workerLastPhase,'DATE_DIAGNOSTIC');
  for(const gasVersion of ['9.255','9.256','9.257','9.258','9.273','9.274']) {
    const current=summarizeEvidence({...a,gasVersion,
      tradeSnapshotWorkerLastResult:{status:'RUNNING',
        at:'2026-10-19T11:07:00.000Z',runStartedAt:'2026-10-19T11:02:23.565Z',
        phase:'DATE_REBUILD',processed:0,deferred:0,blockedDate:'2026-03-02'}},evidence);
    assert.equal(current.gasVersion,gasVersion);
    assert.equal(current.workerLastPhase,'DATE_REBUILD');
    assert.equal(current.workerCompletedVerified,false);
    assert.equal(current.operationallyComplete,false);
  }
  for(const gasVersion of ['9.245','9.999','10.0'])
    assert.throws(()=>summarizeEvidence({...a,gasVersion},evidence),
      /ISSUE507_AUTOMATION_SCHEMA/);
  assert.equal(phased.workerOriginalStartedAt,'2026-10-19T11:02:23.565Z');
  assert.ok(!JSON.stringify(phased).includes('SECRET'));
  assert.equal(executing.workerLastLockBusyAt,'2026-10-19T08:03:00.000Z');
  assert.equal(out.earlyUnresolvedDateCount,4);
  assert.equal(out.septemberRegressionReady,true);
  assert.equal(out.june5Status,'CONFLICT');
  assert.equal(out.operationallyComplete,false);
  assert.throws(()=>summarizeDiagnostics({status:'ok',checkedDates:EARLY,
    diagnostics:early.slice(0,4)},EARLY),/ISSUE507_DIAGNOSTIC_INVALID/);
  assert.throws(()=>summarizeDiagnostics({status:'ok',checkedDates:EARLY,
    diagnostics:[early[0],early[0],...early.slice(2)]},EARLY),
    /ISSUE507_DIAGNOSTIC_DATE_OR_STATUS/);
  assert.throws(()=>summarizeEvidence({...a,gasVersion:'9.236'},evidence),
    /ISSUE507_AUTOMATION_SCHEMA/);
  assert.throws(()=>summarizeEvidence({...a,pendingTradeSnapshotRebuildFrom:'not-a-date'},
    evidence),/ISSUE507_PENDING_DATE_INVALID/);
  const mismatched=evidence.slice();
  mismatched[6]={...mismatched[6],expectedRows:39,storedRows:38};
  assert.equal(summarizeEvidence(a,mismatched).septemberRegressionReady,false);
  for(const [response,expected] of [
    [async()=>{throw Error('PRIVATE_TOKEN_AND_ACCOUNT');},'AUTOMATION_DIAG_NETWORK_FAILED'],
    [async()=>({ok:false}),'AUTOMATION_DIAG_HTTP_FAILED'],
    [async()=>({ok:true,json:async()=>{throw Error('PRIVATE_JSON');}}),'AUTOMATION_DIAG_NON_JSON'],
    [async()=>({ok:true,json:async()=>({status:'ok'})}),'AUTOMATION_DIAG_AUTH_DISABLED']
  ]) {
    let caught;
    try {await runReadonly({url:'https://script.google.com/macros/s/Fixture/exec',
      token:'PRIVATE_TEST_TOKEN',fetchImpl:response});} catch(error){caught=error;}
    assert.ok(caught,'failed dependency must fail the real read-only entry point');
    assert.equal(safeReadonlyFailureCode(caught),expected);
  }
  for(const message of ['AUTOMATION_DIAG_PRIVATE_SECRET','ISSUE507_PRIVATE_SECRET',
    'AUTOMATION_DIAG_NON_JSON PRIVATE_ACCOUNT','private account 123'])
    assert.equal(safeReadonlyFailureCode(new Error(message)),'ISSUE507_UNKNOWN_FAILURE');
  for(const [field,code] of [
    ['expectedRowCount','ISSUE507_BAD_EXPECTED_ROWS'],
    ['storedRowCount','ISSUE507_BAD_STORED_ROWS'],
    ['groups','ISSUE507_BAD_DUPLICATE_GROUPS'],
    ['unresolvedConflict','ISSUE507_BAD_UNRESOLVED_CONFLICTS']
  ]) {
    const rows=early.map(x=>({...x,duplicateSummary:{...x.duplicateSummary}}));
    if(field in rows[0])rows[0][field]=null;
    else rows[0].duplicateSummary[field]=null;
    assert.throws(()=>summarizeDiagnostics({status:'ok',checkedDates:EARLY,
      diagnostics:rows},EARLY),error=>safeReadonlyFailureCode(error)===code,
      'actual dynamically constructed schema errors must remain classifiable');
  }
  return{mode:'LOCAL_CONTRACT_TEST',result:'PASS',cases:34};
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
  try{
    const data=process.argv.includes('--self-test')
      ?await selfTest()
      :await runReadonly({url:process.env.GAS_WEB_APP_URL,
        token:process.env.GAS_ACCESS_TOKEN});
    console.log(JSON.stringify(data));
  }catch(error){
    // Local-only contract failures may expose assertion details; live errors never do.
    if(process.argv.includes('--self-test')) console.error(String(error?.stack||error));
    else console.error(safeReadonlyFailureCode(error));
    process.exitCode=1;
  }
}
