#!/usr/bin/env node
// Issue #507 - supervised recovery decision inventory. READ ONLY.
// No commands to mutate GAS, Apps Script properties, Sheets, or backlog exist.
// Do not output source rows, codes, names, accounts, amounts, or tokens.
import assert from 'node:assert/strict';
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
function qtyCost(row){
  return JSON.stringify([n(row[3]),n(row[5])]);
}
export function assessDay(d){
  guard(d&&iso(d.date)&&STATUS.has(d.status)
    &&Array.isArray(d.storedRows)&&Array.isArray(d.expectedRows)
    &&Array.isArray(d.sourceDataErrors)&&Array.isArray(d.duplicateKeys)
    &&Array.isArray(d.missingCodes)&&d.duplicateSummary
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
  guard(inferredMissing.length===d.missingCodes.length,'MISSING_SUMMARY_DRIFT');
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
  return {
    date:d.date,reportedStatus:d.status,storedRows:count(d.storedRows.length),
    expectedRows:count(d.expectedRows.length),
    duplicateGroups:count(duplicates.length),
    sourceErrors:count(d.sourceDataErrors.length),
    missingExpectedRows:count(inferredMissing.length),
    expectedRowsWithStoredSignature:count(matchedFull),
    expectedRowsWithoutStoredSignature:count(expected.size-matchedFull),
    duplicateReasons:causes,
    readyToWrite:false,
    planStage:d.sourceDataErrors.length||d.status==='SOURCE_INCOMPLETE'
      ?'SOURCE_REPAIR_REQUIRED'
      :duplicates.length?'PROTECTED_DUPLICATES_REQUIRE_RECONCILIATION'
      :inferredMissing.length?'SNAPSHOT_MISSING_ROWS'
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
    missingExpectedRows:count(days.reduce((sum,d)=>sum+d.missingExpectedRows,0))
  };
  return {mode:'STRICT_READ_ONLY_RECOVERY_DRYRUN',gasVersion:'9.244',
    sourceRevisionStable:true,sourceDigestStable:true,deferredQueueStable:true,
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
    sourceDataErrors:[],duplicateKeys:[date+'|000001'],missingCodes:[],
    duplicateSummary:{groups:1,exactDuplicate:0,singleExpectedMatch:0,
      manualProtected:0,unresolvedConflict:1,sourceIncomplete:0}};
}
export async function selfTest(){
  const invalidInventory={status:'ok',gasVersion:'9.244',automation:{
    gasVersion:'9.244',tradeSnapshotDeferredDates:['2026-01-08','2026-01-07'],
    tradeSnapshotDeferredCount:2,tradeSnapshotDeferredOldestDate:'2026-01-08',
    tradeSnapshotDeferredCursor:'',pendingTradeSnapshotRebuildFrom:''}};
  assert.throws(()=>validateInventory(invalidInventory),/INVENTORY_DATES/);
  const x=fixtureDay(),a=assessDay(x);
  assert.equal(a.duplicateGroups,1);
  assert.equal(a.duplicateReasons.VALUATION_OR_SOURCE_DRIFT,1);
  assert.equal(a.readyToWrite,false);
  const manual=structuredClone(x);manual.storedRows[1][10]='MANUAL';
  assert.equal(assessDay(manual).duplicateReasons.MANUAL_PROTECTED,1);
  const one=structuredClone(x);one.storedRows[1]=structuredClone(one.expectedRows[0]);
  assert.equal(assessDay(one).duplicateReasons.UNIQUE_EXPECTED_SIGNATURE,1);
  const absent=structuredClone(x);absent.expectedRows=[];absent.missingCodes=[];
  assert.equal(assessDay(absent).duplicateReasons.NO_LEDGER_EXPECTED_ROW,1);
  const source=structuredClone(x);source.status='SOURCE_INCOMPLETE';source.sourceDataErrors=['INTERNAL'];
  assert.equal(assessDay(source).duplicateReasons.SOURCE_UNVERIFIED,1);
  const ledger=structuredClone(x);ledger.storedRows[0][3]=2;
  ledger.storedRows[1][3]=2;
  assert.equal(assessDay(ledger).duplicateReasons.LEDGER_QTY_COST_DRIFT,1);
  const bad=structuredClone(x);bad.duplicateKeys=[];
  assert.throws(()=>assessDay(bad),/DRIFT/);
  const d='a'.repeat(64);
  const before={dates:[x.date],cursor:x.date,pendingFrom:'2026-01-08'};
  const batch={days:[a],digest:d,revision:'100'};
  assert.equal(summarize(before,before,[batch]).writeAllowed,false);
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
