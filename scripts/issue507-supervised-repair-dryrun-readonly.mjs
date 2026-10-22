#!/usr/bin/env node
// Issue #507 - supervised recovery decision inventory. READ ONLY.
// No commands to mutate GAS, Apps Script properties, Sheets, or backlog exist.
// Do not output source rows, codes, names, accounts, amounts, or tokens.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {validateWebAppUrl} from './diagnose-krx-operational.mjs';


const STATUS=new Set(['VALID','PARTIAL','MISMATCH','CONFLICT',
  'SOURCE_INCOMPLETE','NO_SNAPSHOT','PRICE_SUSPICIOUS']);
const DIGEST=/^[0-9a-f]{64}$/;
const CHUNK=6,MAX_DATES=60;
function guard(ok,code){if(!ok)throw Error('ISSUE507_REPAIR_DRYRUN_'+code);}
function count(n){guard(Number.isSafeInteger(n)&&n>=0&&n<=1000000,'COUNT');return n;}
function iso(s){
  return typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)
    &&Number.isFinite(Date.parse(s+'T00:00:00Z'))
    &&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
}
// Deliberately local/pure: issue507-deferred-source-audit-readonly.mjs executes
// its CLI unconditionally when imported (including authenticated GAS reads).
// Importing that script here would double-run an operational audit.
export function validateInventory(payload){
  const a=payload?.automation;
  guard(payload?.status==='ok'&&payload.gasVersion==='9.244'&&
    a?.gasVersion==='9.244'&&
    Array.isArray(a.tradeSnapshotDeferredDates)&&
    a.tradeSnapshotDeferredDates.length<=600&&
    a.tradeSnapshotDeferredCount===a.tradeSnapshotDeferredDates.length&&
    typeof a.tradeSnapshotDeferredOldestDate==='string'&&
    typeof a.tradeSnapshotDeferredCursor==='string'&&
    typeof a.pendingTradeSnapshotRebuildFrom==='string',
    'INVENTORY_SCHEMA');
  const dates=a.tradeSnapshotDeferredDates;
  guard(dates.every(iso)&&
    dates.every((value,index)=>index===0||value>dates[index-1])&&
    a.tradeSnapshotDeferredOldestDate===(dates[0]||'')&&
    (!a.tradeSnapshotDeferredCursor||iso(a.tradeSnapshotDeferredCursor))&&
    (!a.pendingTradeSnapshotRebuildFrom||iso(a.pendingTradeSnapshotRebuildFrom)),
    'INVENTORY_DATES');
  return {dates,cursor:a.tradeSnapshotDeferredCursor,
    pendingFrom:a.pendingTradeSnapshotRebuildFrom};
}

function code(raw){
  const s=String(raw??'').trim().toUpperCase();
  if(/^\d+$/.test(s))return s.padStart(6,'0');
  return /^[A-Z0-9]+(?:[.-][A-Z0-9]+)*$/.test(s)&&s.length<=30&&/[A-Z]/.test(s)?s:'';
}
function key(row){return code(row?.[1])||String(row?.[2]??'').trim();}
function n(v){return Number(v)||0;}
// Match the 11-column production GAS _snapshotComparableSignature().
// savedAt column 12 is intentionally ignored by production, never by backup.
function signature(row){
  const d=String(row?.[0]??'').slice(0,10), k=key(row);
  guard(iso(d)&&k&&Array.isArray(row)&&row.length>=11,'RAW_ROW');
  return JSON.stringify([d,k,String(row[2]??'').trim(),n(row[3]),n(row[4]),
    n(row[5]),n(row[6]),n(row[7]),n(row[8]),n(row[9]),
    String(row[10]??'').trim().toUpperCase()]);
}
// Exact GAS diagnoseSnapshotIntegrity() comparison precision.
function storedNumber(value,decimals){
  const factor=Math.pow(10,Number(decimals)||0);
  return Math.round((Number(value)||0)*factor)/factor;
}
function qtyCost(row){
  return JSON.stringify([storedNumber(row[3],8),storedNumber(row[5],0)]);
}
export function assessDay(d){
  guard(d&&iso(d.date)&&STATUS.has(d.status)
    &&Array.isArray(d.storedRows)&&Array.isArray(d.expectedRows)
    &&Array.isArray(d.sourceDataErrors)&&Array.isArray(d.duplicateKeys)
    &&Array.isArray(d.missingCodes)&&Array.isArray(d.unexpectedCodes)&&d.duplicateSummary
    &&d.storedRows.length<=100000&&d.expectedRows.length<=100000,
  'DIAGNOSTIC_SCHEMA');
  const expected=new Map(),groups=new Map();
  for(const r of d.expectedRows){
    guard(Array.isArray(r)&&String(r[0]).slice(0,10)===d.date,'EXPECTED_DATE');
    const k=key(r);guard(k&&!expected.has(k),'EXPECTED_DUPLICATE');
    signature(r);expected.set(k,r);
  }
  for(const r of d.storedRows){
    guard(Array.isArray(r)&&String(r[0]).slice(0,10)===d.date,'STORED_DATE');
    const k=key(r);guard(k,'STORED_KEY');signature(r);
    if(!groups.has(k))groups.set(k,[]);
    groups.get(k).push(r);
  }
  const duplicates=[...groups].filter(([,rows])=>rows.length>1);
  guard(duplicates.length===count(d.duplicateSummary.groups)
    &&duplicates.length===d.duplicateKeys.length,'DUPLICATE_SUMMARY_DRIFT');
  const expectedKeys=new Set(expected.keys());
  const inferredMissing=[...expectedKeys].filter(k=>!groups.has(k));
  const inferredUnexpected=[...groups.keys()].filter(k=>!expectedKeys.has(k));
  // Validate actual code identities in memory, but never emit them in reports.
  const equalCodes=(actual,reported)=>actual.slice().sort().join('|')===reported.slice().sort().join('|');
  guard(equalCodes(inferredMissing,d.missingCodes),'MISSING_SUMMARY_DRIFT');
  guard(equalCodes(inferredUnexpected,d.unexpectedCodes),'UNEXPECTED_SUMMARY_DRIFT');
  const unexpectedStoredRows=inferredUnexpected.reduce((sum,k)=>sum+groups.get(k).length,0);
  // On SOURCE_INCOMPLETE, production has no reliable expected ledger rows.
  // Those stored rows are UNVERIFIED, not proven orphan rows.
  const sourceUsable=d.sourceDataErrors.length===0&&d.status!=='SOURCE_INCOMPLETE';
  const causes={};
  for(const [k,rows] of duplicates){
    const unique=[...new Set(rows.map(signature))],er=expected.get(k);
    const full=er?unique.filter(sig=>sig===signature(er)).length:0;
    const qc=er?rows.filter(r=>qtyCost(r)===qtyCost(er)).length:0;
    const hasManual=rows.some(r=>String(r[10]??'').trim().toUpperCase()==='MANUAL');
    let reason;
    if(d.sourceDataErrors.length || d.status==='SOURCE_INCOMPLETE') reason='SOURCE_UNVERIFIED';
    else if(hasManual)reason='MANUAL_PROTECTED';
    else if(!er)reason='NO_LEDGER_EXPECTED_ROW';
    else if(unique.length===1)reason=full===1?'EXACT_DUPLICATE_EXPECTED_MATCH':'EXACT_DUPLICATE_EXPECTED_DRIFT';
    else if(full===1)reason='UNIQUE_EXPECTED_SIGNATURE';
    else if(qc===rows.length)reason='VALUATION_OR_SOURCE_DRIFT';
    else reason='LEDGER_QTY_COST_DRIFT';
    causes[reason]=count((causes[reason]||0)+1);
  }
  const matchedFull=[...expected].filter(([k,r])=>
    (groups.get(k)||[]).some(sr=>signature(sr)===signature(r))).length;
  // Production diagnoseSnapshotIntegrity uses the FIRST stored row per code
  // for qtyMismatches and costAmtMismatches. Preserve that representative.
  const matchedQtyCost=[...expected].filter(([k,r])=>{
    const rows=groups.get(k)||[];
    return rows.length>0&&qtyCost(rows[0])===qtyCost(r);
  }).length;
  // A later duplicate can still be a candidate; never conflate it with
  // the production representative's reconciled status.
  const matchedAnyQtyCost=[...expected].filter(([k,r])=>
    (groups.get(k)||[]).some(sr=>qtyCost(sr)===qtyCost(r))).length;
  return {
    date:d.date,reportedStatus:d.status,storedRows:count(d.storedRows.length),
    expectedRows:count(d.expectedRows.length),
    duplicateGroups:count(duplicates.length),
    sourceErrors:count(d.sourceDataErrors.length),
    missingExpectedRows:count(inferredMissing.length),
    unexpectedStoredCodes:count(sourceUsable?inferredUnexpected.length:0),
    unexpectedStoredRows:count(sourceUsable?unexpectedStoredRows:0),
    sourceUnverifiedStoredCodes:count(sourceUsable?0:groups.size),
    sourceUnverifiedStoredRows:count(sourceUsable?0:d.storedRows.length),
    expectedRowsWithStoredSignature:count(matchedFull),
    expectedRowsWithoutStoredSignature:count(expected.size-matchedFull),
    expectedRowsWithStoredQtyCost:count(matchedQtyCost),
    expectedRowsWithoutStoredQtyCost:count(expected.size-matchedQtyCost),
    expectedRowsWithAnyStoredQtyCostCandidate:count(matchedAnyQtyCost),
    duplicateReasons:causes,
    readyToWrite:false,
    planStage:d.sourceDataErrors.length||d.status==='SOURCE_INCOMPLETE'
      ?'SOURCE_REPAIR_REQUIRED'
      :duplicates.length?'PROTECTED_DUPLICATES_REQUIRE_RECONCILIATION'
      :inferredMissing.length&&inferredUnexpected.length?'SNAPSHOT_KEYSET_DRIFT'
      :inferredMissing.length?'SNAPSHOT_MISSING_ROWS'
      :inferredUnexpected.length?'SNAPSHOT_ORPHAN_ROWS'
      :'VERIFY_OTHER_MISMATCHES'
  };
}
export function assessBatch(response,requested){
  guard(response?.status==='ok'&&Array.isArray(response.checkedDates)
    &&Array.isArray(response.diagnostics)
    &&response.checkedDates.length===requested.length
    &&response.diagnostics.length===requested.length
    &&DIGEST.test(response.strictSourceDigest||'')
    &&typeof response.integritySourceRevision==='string'
    &&response.integritySourceRevision.length>0,
    'STRICT_REQUIRED');
  guard(response.checkedDates.join('|')===requested.join('|'),'DATE_SEQUENCE');
  const days=response.diagnostics.map(assessDay);
  guard(days.map(x=>x.date).join('|')===requested.join('|'),'DIAGNOSTIC_ORDER');
  return {days,revision:response.integritySourceRevision,
    digest:response.strictSourceDigest};
}
export function summarize(before,after,batches){
  guard(before?.dates&&after?.dates
    &&before.dates.join('|')===after.dates.join('|')
    &&before.cursor===after.cursor&&before.pendingFrom===after.pendingFrom,
    'QUEUE_CHANGED');
  const days=batches.flatMap(b=>b.days);
  guard(days.length===before.dates.length
    &&days.map(x=>x.date).join('|')===before.dates.join('|'),
    'INCOMPLETE_SCAN');
  const anchor=batches[0];
  guard(anchor&&DIGEST.test(anchor.digest),'STRICT_ANCHOR_MISSING');
  for(const b of batches)guard(b.revision===anchor.revision&&b.digest===anchor.digest,
    'SOURCE_CHANGED');
  const reasons={},stages={};
  for(const d of days){
    stages[d.planStage]=count((stages[d.planStage]||0)+1);
    for(const [k,v] of Object.entries(d.duplicateReasons))reasons[k]=count((reasons[k]||0)+v);
  }
  const totals={
    deferredDates:count(days.length),
    duplicateGroups:count(days.reduce((sum,d)=>sum+d.duplicateGroups,0)),
    sourceErrorDates:count(days.filter(d=>d.sourceErrors>0).length),
    sourceErrorRecords:count(days.reduce((sum,d)=>sum+d.sourceErrors,0)),
    missingExpectedRows:count(days.reduce((sum,d)=>sum+d.missingExpectedRows,0)),
    expectedRowsWithStoredSignature:count(days.reduce((sum,d)=>sum+d.expectedRowsWithStoredSignature,0)),
    expectedRowsWithoutStoredSignature:count(days.reduce((sum,d)=>sum+d.expectedRowsWithoutStoredSignature,0)),
    expectedRowsWithStoredQtyCost:count(days.reduce((sum,d)=>sum+d.expectedRowsWithStoredQtyCost,0)),
    expectedRowsWithoutStoredQtyCost:count(days.reduce((sum,d)=>sum+d.expectedRowsWithoutStoredQtyCost,0)),
    expectedRowsWithAnyStoredQtyCostCandidate:count(days.reduce((sum,d)=>sum+d.expectedRowsWithAnyStoredQtyCostCandidate,0)),
    keysetDriftDates:count(days.filter(d=>d.planStage==='SNAPSHOT_KEYSET_DRIFT').length),
    unexpectedStoredCodes:count(days.reduce((sum,d)=>sum+d.unexpectedStoredCodes,0)),
    unexpectedStoredRows:count(days.reduce((sum,d)=>sum+d.unexpectedStoredRows,0)),
    sourceUnverifiedStoredCodes:count(days.reduce((sum,d)=>sum+d.sourceUnverifiedStoredCodes,0)),
    sourceUnverifiedStoredRows:count(days.reduce((sum,d)=>sum+d.sourceUnverifiedStoredRows,0))
  };
  return {mode:'STRICT_READ_ONLY_RECOVERY_DRYRUN',gasVersion:'9.244',
    sourceRevisionStable:true,sourceDigestStable:true,deferredQueueStable:true,
    // Within this invocation only: prior executions can have different source rows.
    crossRunSourceStabilityCertified:false,backupRegistrySignatureVerified:false,
    ...totals,reasons,stages,days,
    rawPriceHistoryFullScanCertified:false,
    confirmedKrxNumericValuesCertified:false,
    fundCorporateActionsCertified:false,
    backupVerifiedForMutation:false,
    scriptLockWriterInstalled:false,
    changesToSourceData:0,changesToDeferredQueue:0,
    automaticDuplicateDeletionAllowed:false,writeAllowed:false,
    note:'This report classifies blockers, NOT rows to delete. A separately approved writer must re-read originals under ScriptLock and verify backups, full RAW source, historical ledger, KRX/NAV/FX, and post-write invariants.'};
}
async function request(url,token,action,args,fetchImpl){
  let res;
  try {res=await fetchImpl(url,{method:'POST',redirect:'follow',
    headers:{'content-type':'application/x-www-form-urlencoded;charset=UTF-8'},
    body:new URLSearchParams({action,...args,accessToken:token}),
    signal:AbortSignal.timeout(240000)});}
  catch {throw Error('ISSUE507_REPAIR_DRYRUN_NETWORK');}
  guard(res?.ok,'HTTP');try{return await res.json();}
  catch {throw Error('ISSUE507_REPAIR_DRYRUN_JSON');}
}
export async function runReadonly({url,token,fetchImpl=fetch}){
  const endpoint=validateWebAppUrl(url);
  guard(typeof token==='string'&&token.trim(),'TOKEN_MISSING');
  const bogus=token==='ISSUE507_REPAIR_DRYRUN_INVALID_TOKEN'
    ?'ISSUE507_REPAIR_DRYRUN_INVALID_TOKEN_2':'ISSUE507_REPAIR_DRYRUN_INVALID_TOKEN';
  const denied=await request(endpoint,bogus,'getAutomationStatus',{},fetchImpl);
  guard(denied?.status==='error'&&denied.message==='인증 실패','AUTH_GUARD');
  const status=await request(endpoint,token,'getAutomationStatus',{},fetchImpl);
  const before=validateInventory(status);
  guard(before.dates.length>0&&before.dates.length<=MAX_DATES,'DATE_LIMIT');
  const batches=[];
  for(let i=0;i<before.dates.length;i+=CHUNK){
    const wanted=before.dates.slice(i,i+CHUNK);
    const response=await request(endpoint,token,'diagnoseSnapshotIntegrityRange',
      {dates:wanted.join(','),strictReadonly:'1'},fetchImpl);
    batches.push(assessBatch(response,wanted));
  }
  // An independent complete digest re-read, not merely a cached version token.
  const verify=await request(endpoint,token,'diagnoseSnapshotIntegrityRange',
    {dates:before.dates.slice(0,1).join(','),strictReadonly:'1'},fetchImpl);
  const afterProof=assessBatch(verify,before.dates.slice(0,1));
  batches.push({...afterProof,days:[]});
  const finalStatus=await request(endpoint,token,'getAutomationStatus',{},fetchImpl);
  const after=validateInventory(finalStatus);
  return summarize(before,after,batches);
}
function fixtureDay(date='2026-01-07'){
  const a=[date,'000001','INTERNAL',1,100,100,110,110,10,10,'KRX',''];
  const b=[date,'000001','INTERNAL',1,100,100,120,120,20,20,'KRX',''];
  const er=[date,'000001','INTERNAL',1,100,100,130,130,30,30,'KRX',''];
  return {date,status:'CONFLICT',storedRows:[a,b],expectedRows:[er],
    sourceDataErrors:[],duplicateKeys:[date+'|000001'],missingCodes:[],unexpectedCodes:[],
    duplicateSummary:{groups:1,exactDuplicate:0,singleExpectedMatch:0,
      manualProtected:0,unresolvedConflict:1,sourceIncomplete:0}};
}
export async function selfTest(){
  // The operational job has GAS credentials: feature-branch dispatch must not run it.
  const workflow=fs.readFileSync(new URL(
    '../.github/workflows/issue-507-supervised-repair-dryrun-readonly.yml',
    import.meta.url),'utf8');
  const runtimeIf=text=>text.match(/^  operational-readonly:\r?\n    if: ([^\r\n]+)\r?$/m)?.[1];
  const expectedIf="github.ref == 'refs/heads/main' && github.event_name == 'workflow_dispatch'";
  assert.equal(runtimeIf(workflow),expectedIf,'supervised live audit must be main-only and manual');
  const branchUnsafe=workflow.replace(expectedIf,"github.event_name == 'workflow_dispatch'");
  assert.notEqual(runtimeIf(branchUnsafe),expectedIf,'feature branch live audit must be blocked');
  const invalidInventory={status:'ok',gasVersion:'9.244',automation:{
    gasVersion:'9.244',tradeSnapshotDeferredDates:['2026-01-08','2026-01-07'],
    tradeSnapshotDeferredCount:2,tradeSnapshotDeferredOldestDate:'2026-01-08',
    tradeSnapshotDeferredCursor:'',pendingTradeSnapshotRebuildFrom:''}};
  assert.throws(()=>validateInventory(invalidInventory),/INVENTORY_DATES/);
  const x=fixtureDay(),a=assessDay(x);
  assert.equal(a.duplicateGroups,1);
  assert.equal(a.duplicateReasons.VALUATION_OR_SOURCE_DRIFT,1);
  assert.equal(a.expectedRowsWithStoredQtyCost,1);
  assert.equal(a.expectedRowsWithStoredSignature,0);
  assert.equal(a.readyToWrite,false);
  const near=structuredClone(x);
  near.expectedRows[0][3]=1;
  near.expectedRows[0][5]=100;
  near.storedRows[0][3]=1.000000001;
  near.storedRows[0][5]=100.4;
  near.storedRows[1][3]=1.000000001;
  near.storedRows[1][5]=100.4;
  const withinPrecision=assessDay(near);
  assert.equal(withinPrecision.expectedRowsWithStoredQtyCost,1);
  assert.equal(withinPrecision.expectedRowsWithoutStoredQtyCost,0);
  // Both rows agree at GAS qty/cost precision, but have distinct evaluations.
  assert.equal(withinPrecision.duplicateReasons.VALUATION_OR_SOURCE_DRIFT,1);
  assert.equal(withinPrecision.expectedRowsWithAnyStoredQtyCostCandidate,1);
  // Diagnostic representative is row 1, even if row 2 exactly matches ledger.
  const firstWrongLaterCorrect=structuredClone(x);
  firstWrongLaterCorrect.storedRows[0][3]=2;
  firstWrongLaterCorrect.storedRows[0][5]=200;
  firstWrongLaterCorrect.storedRows[1][3]=1;
  firstWrongLaterCorrect.storedRows[1][5]=100;
  const representative=assessDay(firstWrongLaterCorrect);
  assert.equal(representative.duplicateReasons.LEDGER_QTY_COST_DRIFT,1);
  assert.equal(representative.expectedRowsWithStoredQtyCost,0);
  assert.equal(representative.expectedRowsWithoutStoredQtyCost,1);
  assert.equal(representative.expectedRowsWithAnyStoredQtyCostCandidate,1);
  const firstCorrectLaterWrong=structuredClone(firstWrongLaterCorrect);
  firstCorrectLaterWrong.storedRows.reverse();
  const firstCorrectResult=assessDay(firstCorrectLaterWrong);
  assert.equal(firstCorrectResult.expectedRowsWithStoredQtyCost,1);
  assert.equal(firstCorrectResult.expectedRowsWithAnyStoredQtyCostCandidate,1);
  const distinctQty=structuredClone(near);
  distinctQty.storedRows[0][3]=1.000000011;
  distinctQty.storedRows[1][3]=1.000000011;
  assert.equal(assessDay(distinctQty).expectedRowsWithStoredQtyCost,0);
  const distinctCost=structuredClone(near);
  distinctCost.storedRows[0][5]=100.51;
  distinctCost.storedRows[1][5]=100.51;
  assert.equal(assessDay(distinctCost).expectedRowsWithStoredQtyCost,0);
  const manual=structuredClone(x);manual.storedRows[1][10]='MANUAL';
  assert.equal(assessDay(manual).duplicateReasons.MANUAL_PROTECTED,1);
  const one=structuredClone(x);one.storedRows[1]=structuredClone(one.expectedRows[0]);
  assert.equal(assessDay(one).duplicateReasons.UNIQUE_EXPECTED_SIGNATURE,1);
  const absent=structuredClone(x);absent.expectedRows=[];absent.missingCodes=[];
  absent.unexpectedCodes=['000001'];
  const orphan=assessDay(absent);
  assert.equal(orphan.duplicateReasons.NO_LEDGER_EXPECTED_ROW,1);
  assert.equal(orphan.unexpectedStoredCodes,1);
  assert.equal(orphan.unexpectedStoredRows,2);
  const wrongOrphan=structuredClone(absent);wrongOrphan.unexpectedCodes=[];
  assert.throws(()=>assessDay(wrongOrphan),/UNEXPECTED_SUMMARY_DRIFT/);
  const isolated=structuredClone(x);
  isolated.storedRows.push([x.date,'000002','INTERNAL',1,10,10,9,9,-1,-10,'KRX','']);
  isolated.unexpectedCodes=['000002'];
  assert.equal(assessDay(isolated).unexpectedStoredCodes,1);
  assert.equal(assessDay(isolated).unexpectedStoredRows,1);
  const wrongSameCount=structuredClone(isolated);wrongSameCount.unexpectedCodes=['000003'];
  assert.throws(()=>assessDay(wrongSameCount),/UNEXPECTED_SUMMARY_DRIFT/);
  const mixed=structuredClone(x);
  mixed.status='PARTIAL';
  mixed.storedRows=[[x.date,'000002','INTERNAL',1,10,10,9,9,-1,-10,'KRX','']];
  mixed.duplicateKeys=[];mixed.duplicateSummary.groups=0;
  mixed.missingCodes=['000001'];mixed.unexpectedCodes=['000002'];
  const mixedResult=assessDay(mixed);
  assert.equal(mixedResult.planStage,'SNAPSHOT_KEYSET_DRIFT');
  assert.equal(mixedResult.missingExpectedRows,1);
  assert.equal(mixedResult.unexpectedStoredCodes,1);
  assert.equal(mixedResult.expectedRowsWithStoredQtyCost,0);
  assert.equal(mixedResult.readyToWrite,false);
  const source=structuredClone(x);source.status='SOURCE_INCOMPLETE';source.sourceDataErrors=['INTERNAL'];
  assert.equal(assessDay(source).duplicateReasons.SOURCE_UNVERIFIED,1);
  const incomplete=structuredClone(absent);incomplete.status='SOURCE_INCOMPLETE';
  incomplete.sourceDataErrors=['INTERNAL'];
  const safeIncomplete=assessDay(incomplete);
  assert.equal(safeIncomplete.unexpectedStoredCodes,0);
  assert.equal(safeIncomplete.unexpectedStoredRows,0);
  assert.equal(safeIncomplete.sourceUnverifiedStoredCodes,1);
  assert.equal(safeIncomplete.sourceUnverifiedStoredRows,2);
  const ledger=structuredClone(x);ledger.storedRows[0][3]=2;
  ledger.storedRows[1][3]=2;
  assert.equal(assessDay(ledger).duplicateReasons.LEDGER_QTY_COST_DRIFT,1);
  const bad=structuredClone(x);bad.duplicateKeys=[];
  assert.throws(()=>assessDay(bad),/DRIFT/);
  const d='a'.repeat(64);
  const before={dates:[x.date],cursor:x.date,pendingFrom:'2026-01-08'};
  const batch={days:[a],digest:d,revision:'100'};
  const baselineReport=summarize(before,before,[batch]);
  assert.equal(baselineReport.writeAllowed,false);
  assert.equal(baselineReport.expectedRowsWithStoredQtyCost,1);
  assert.equal(baselineReport.expectedRowsWithAnyStoredQtyCostCandidate,1);
  assert.equal(baselineReport.expectedRowsWithoutStoredSignature,1);
  assert.equal(baselineReport.crossRunSourceStabilityCertified,false);
  assert.equal(baselineReport.backupRegistrySignatureVerified,false);
  const mixedReport=summarize(before,before,[{...batch,days:[mixedResult]}]);
  assert.equal(mixedReport.keysetDriftDates,1);
  assert.throws(()=>summarize(before,before,[batch,{days:[],digest:'b'.repeat(64),revision:'100'}]),/SOURCE_CHANGED/);
  const baseStatus={status:'ok',gasVersion:'9.244',automation:{gasVersion:'9.244',
    tradeSnapshotDeferredDates:[x.date],tradeSnapshotDeferredCount:1,
    tradeSnapshotDeferredOldestDate:x.date,tradeSnapshotDeferredCursor:x.date,
    pendingTradeSnapshotRebuildFrom:'2026-01-08'}};
  const payload={status:'ok',checkedDates:[x.date],diagnostics:[x],
    strictSourceDigest:d,integritySourceRevision:'100'};
  const calls=[];
  const stub=async(_endpoint,opts)=>{
    calls.push(opts.body.get('action'));
    const obj=opts.body.get('accessToken')==='TEST_TOKEN'
      ?opts.body.get('action')==='getAutomationStatus'?baseStatus:payload
      :{status:'error',message:'인증 실패'};
    return {ok:true,json:async()=>obj};
  };
  const report=await runReadonly({
    url:'https://script.google.com/macros/s/TEST/exec',
    token:'TEST_TOKEN',fetchImpl:stub});
  assert.equal(report.duplicateGroups,1);
  assert.equal(report.days.length,1);
  assert.equal(report.unexpectedStoredCodes,0);
  assert.equal(report.writeAllowed,false);
  assert.ok(!JSON.stringify(report).includes('000001'));
  assert.ok(!JSON.stringify(report).includes('INTERNAL'));
  assert.deepEqual(calls,['getAutomationStatus','getAutomationStatus',
    'diagnoseSnapshotIntegrityRange','diagnoseSnapshotIntegrityRange',
    'getAutomationStatus']);
  console.log('Issue #507 recovery dry-run STRICT READ ONLY contract: PASS');
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
  try {
    if(process.argv.includes('--self-test'))await selfTest();
    else console.log(JSON.stringify(await runReadonly({
      url:process.env.GAS_WEB_APP_URL,token:process.env.GAS_ACCESS_TOKEN})));
  } catch(e) {
    const value=String(e?.message||'');
    if(process.argv.includes('--self-test'))console.error(String(e?.stack||e).slice(0,2000));
    else console.error(/^ISSUE507_REPAIR_DRYRUN_[A-Z_]+$/.test(value)
      ?value:'ISSUE507_REPAIR_DRYRUN_UNKNOWN');
    process.exitCode=1;
  }
}
