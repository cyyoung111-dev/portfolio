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
    ||automation.gasVersion!=='9.237'
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
  // No GAS public status field for the hourly worker's last invocation or
  // source fingerprint. Never extrapolate a trigger firing from pending alone.
  return {
    mode:'READ_ONLY',gasVersion:automation.gasVersion,
    triggerReady:automation.triggerReady,
    missingTriggerCount:automation.triggerMissing.length,
    overallStatus:automation.overallStatus,
    pendingTradeSnapshotRebuildFrom:pending,
    tradeLedgerWriteUnverified:automation.tradeLedgerWriteUnverified,
    workerLastExecution:'NOT_EXPOSED',
    workerFirstRunVerified:false,
    fingerprintBaselineVerified:false,
    workerBlockedDate:'NOT_EXPOSED',
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
export function selfTest(){
  const sample=(date,status='VALID',countRows=33)=>({
    date,status,expectedRowCount:countRows,storedRowCount:countRows,
    duplicateSummary:{groups:0,unresolvedConflict:0},sourceDataErrors:[]
  });
  const early=EARLY.map((date,i)=>sample(date,i<4?'SOURCE_INCOMPLETE':'VALID'));
  const regress=REGRESSION.map((date,i)=>sample(date,i===0?'CONFLICT':'VALID',i===0?37:39));
  const a={mode:'READ_ONLY',gasVersion:'9.237',triggerReady:true,
    triggerMissing:[],overallStatus:'INCOMPLETE',
    pendingTradeSnapshotRebuildFrom:'-',tradeLedgerWriteUnverified:false};
  const earlyEvidence=summarizeDiagnostics({status:'ok',checkedDates:EARLY,
    diagnostics:early},EARLY);
  const regressionEvidence=summarizeDiagnostics({status:'ok',checkedDates:REGRESSION,
    diagnostics:regress},REGRESSION);
  assert.equal(earlyEvidence.length,5);
  const evidence=earlyEvidence.concat(regressionEvidence);
  const out=summarizeEvidence(a,evidence);
  assert.equal(out.workerFirstRunVerified,false);
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
  return{mode:'LOCAL_CONTRACT_TEST',result:'PASS',cases:9};
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
  try{
    const data=process.argv.includes('--self-test')
      ?selfTest()
      :await runReadonly({url:process.env.GAS_WEB_APP_URL,
        token:process.env.GAS_ACCESS_TOKEN});
    console.log(JSON.stringify(data));
  }catch(error){
    const x=String(error?.message||'');
    // Local-only contract failures may expose assertion details; live errors never do.
    if(process.argv.includes('--self-test')) console.error(String(error?.stack||error));
    else console.error(/^ISSUE507_[A-Z_]+$/.test(x)?x:'ISSUE507_UNKNOWN_FAILURE');
    process.exitCode=1;
  }
}
