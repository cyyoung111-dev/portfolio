#!/usr/bin/env node
// Issue #507: three-day code-lineage triage, STRICT READ ONLY.
// All identifiers, raw ledger rows, quantities, prices and GAS tokens remain
// inside the ephemeral GitHub runner. Only date-level counts leave this process.
import assert from 'node:assert/strict';
import {validateWebAppUrl} from './diagnose-krx-operational.mjs';
import {validateInventory,assessBatch} from './issue507-supervised-repair-dryrun-readonly.mjs';

export const TARGET_DATES=Object.freeze(['2026-01-08','2026-01-09','2026-01-17']);
const DIGEST=/^[0-9a-f]{64}$/;
const fail=reason=>{throw Error('ISSUE507_THREE_DAY_'+reason);};
function guard(ok,reason){if(!ok)fail(reason);}
function normCode(raw){
  const x=String(raw??'').trim().toUpperCase();
  if(/^\d+$/.test(x))return x.padStart(6,'0');
  return /^[A-Z0-9]+(?:[.-][A-Z0-9]+)*$/.test(x)&&x.length<=30&&/[A-Z]/.test(x)?x:'';
}
function id(row){return normCode(row?.[1])||String(row?.[2]??'').trim();}
const bounded=v=>{guard(Number.isSafeInteger(v)&&v>=0&&v<=1000000,'COUNT');return v;};
function pctNumber(v,digits){
  const p=10**digits;
  return Math.round((Number(v)||0)*p)/p;
}
function qtyCost(row){return JSON.stringify([pctNumber(row[3],8),pctNumber(row[5],0)]);}
function intersectCount(sets){
  return bounded([...sets[0]].filter(k=>sets.slice(1).every(s=>s.has(k))).length);
}
function classSource(row){
  const s=String(row?.[10]??'').toUpperCase().trim();
  if(s==='MANUAL')return 'MANUAL';
  if(s.startsWith('FUND_NAV'))return 'FUND_NAV';
  if(s.includes('CARRY'))return 'CARRY_UNCONFIRMED';
  if(s.includes('KRX')||s.includes('TOSS')||s.includes('CONFIRMED'))return 'CONFIRMED_CLAIM_UNVERIFIED';
  if(s==='PRICE_HISTORY')return 'PRICE_HISTORY_UNVERIFIED';
  return 'OTHER_UNVERIFIED';
}
function sourceCounts(rows){
  const counts={};
  for(const row of rows){
    const family=classSource(row);
    counts[family]=bounded((counts[family]||0)+1);
  }
  return counts;
}
export function summarizeThreeDays(payload){
  guard(payload?.status==='ok'&&Array.isArray(payload.checkedDates)
    &&payload.checkedDates.join('|')===TARGET_DATES.join('|')
    &&Array.isArray(payload.diagnostics)
    &&payload.diagnostics.length===TARGET_DATES.length
    &&DIGEST.test(payload.strictSourceDigest||'')
    &&typeof payload.integritySourceRevision==='string'
    &&payload.integritySourceRevision.length>0,'SCHEMA');
  // Reuse the already validated, production-compatible qty/cost, source-error
  // and duplicate classification oracle. Never print its private input.
  const batch=assessBatch(payload,TARGET_DATES);
  const missingSets=[],duplicateSets=[],mismatchSets=[],out=[];
  payload.diagnostics.forEach((day,index)=>{
    const date=TARGET_DATES[index],assessed=batch.days[index];
    guard(day.date===date&&day.sourceDataErrors.length===0,'SOURCE_INCOMPLETE');
    const expected=new Map(day.expectedRows.map(r=>[id(r),r]));
    const stored=new Map();
    day.storedRows.forEach(r=>{
      const k=id(r);guard(k,'MISSING_ID');
      if(!stored.has(k))stored.set(k,[]);
      stored.get(k).push(r);
    });
    const missing=new Set([...expected.keys()].filter(k=>!stored.has(k)));
    const duplicate=new Set([...stored].filter(([,rows])=>rows.length>1).map(([k])=>k));
    const mismatches=new Set([...expected].filter(([k,row])=>
      stored.has(k)&&!stored.get(k).some(sr=>qtyCost(sr)===qtyCost(row))).map(([k])=>k));
    const onlyEvaluation=new Set([...expected].filter(([k,row])=>
      stored.has(k)&&stored.get(k).some(sr=>qtyCost(sr)===qtyCost(row))
      &&!stored.get(k).some(sr=>JSON.stringify(sr.slice(0,11))===JSON.stringify(row.slice(0,11)))).map(([k])=>k));
    guard(missing.size===assessed.missingExpectedRows
      &&duplicate.size===assessed.duplicateGroups
      &&assessed.expectedRowsWithAnyStoredQtyCostCandidate+
          mismatches.size+missing.size===assessed.expectedRows,'DRIFT');
    missingSets.push(missing);duplicateSets.push(duplicate);mismatchSets.push(mismatches);
    out.push({date,
      expectedRows:bounded(assessed.expectedRows),
      storedRows:bounded(assessed.storedRows),
      missingCodes:bounded(missing.size),
      duplicateGroups:bounded(duplicate.size),
      existingWithNoQtyCostCandidate:bounded(mismatches.size),
      existingWithQtyCostCandidate:bounded(assessed.expectedRowsWithAnyStoredQtyCostCandidate),
      valuationOrSourceOnlyCodes:bounded(onlyEvaluation.size),
      duplicateReasons:assessed.duplicateReasons,
      expectedSourceClaims:sourceCounts(day.expectedRows),
      storedSourceClaims:sourceCounts(day.storedRows),
      writeAllowed:false});
  });
  return {mode:'ISSUE507_THREE_DAY_CODE_LINEAGE_READ_ONLY',gasVersionChecked:'9.244',
    targetDates:TARGET_DATES,days:out,
    sameMissingCodeAllThree:intersectCount(missingSets),
    sameDuplicateCodeAllThree:intersectCount(duplicateSets),
    sameNoQtyCostCandidateAllThree:intersectCount(mismatchSets),
    allSourcePriceClaimsIndependentlyVerified:false,
    sourceAtCopyVerified:false,allowedToRestore:false,allowedToDelete:false,
    writesPerformed:0,note:'Code joins and row amounts are private to the runner; aggregate source family names are only existing labels, not verified historical prices.'};
}
async function request(url,token,action,args,fetchImpl){
  let res;
  try{
    res=await fetchImpl(url,{method:'POST',redirect:'follow',
      headers:{'content-type':'application/x-www-form-urlencoded;charset=UTF-8'},
      body:new URLSearchParams({action,...args,accessToken:token}),
      signal:AbortSignal.timeout(240000)});
  }catch{fail('NETWORK');}
  guard(res?.ok===true,'HTTP');
  try{return await res.json();}catch{fail('JSON');}
}
export async function runReadonly({url,token,fetchImpl=fetch}){
  const endpoint=validateWebAppUrl(url);
  guard(typeof token==='string'&&token.trim().length>0,'TOKEN');
  const bad=token==='ISSUE507_INVALID_ONE'?'ISSUE507_INVALID_TWO':'ISSUE507_INVALID_ONE';
  const denied=await request(endpoint,bad,'getAutomationStatus',{},fetchImpl);
  guard(denied?.status==='error'&&denied.message==='인증 실패','AUTH');
  const before=validateInventory(await request(endpoint,token,'getAutomationStatus',{},fetchImpl));
  guard(TARGET_DATES.every(d=>before.dates.includes(d)),'NOT_DEFERRED');
  const args={dates:TARGET_DATES.join(','),strictReadonly:'1'};
  const first=await request(endpoint,token,'diagnoseSnapshotIntegrityRange',args,fetchImpl);
  const summary=summarizeThreeDays(first);
  const second=await request(endpoint,token,'diagnoseSnapshotIntegrityRange',args,fetchImpl);
  // Validate both actual responses; do not echo raw source digests.
  summarizeThreeDays(second);
  guard(first.strictSourceDigest===second.strictSourceDigest
    &&first.integritySourceRevision===second.integritySourceRevision,'SOURCE_CHANGED');
  const after=validateInventory(await request(endpoint,token,'getAutomationStatus',{},fetchImpl));
  guard(before.dates.join('|')===after.dates.join('|')
    &&before.cursor===after.cursor&&before.pendingFrom===after.pendingFrom,'QUEUE_CHANGED');
  return {...summary,sourceStableWithinThisRead:true,queueStableWithinThisRead:true,
    crossRunSourceStabilityCertified:false};
}
function fixtureDay(date){
  const row=(c,qty,evalAmount,source='KRX')=>
    [date,c,'SYNTH',qty,10,qty*10,evalAmount,evalAmount,evalAmount-qty*10,0,source,''];
  const a=row('000001',1,21), b=row('000001',1,22);
  const c=row('000003',3,50), missing=row('000002',2,35);
  return {date,status:'CONFLICT',expectedRows:[a,missing,c],
    storedRows:[a,b,c],sourceDataErrors:[],
    duplicateKeys:[date+'|000001'],missingCodes:['000002'],unexpectedCodes:[],
    duplicateSummary:{groups:1,exactDuplicate:0,singleExpectedMatch:0,
      manualProtected:0,unresolvedConflict:1,sourceIncomplete:0}};
}
export async function selfTest(){
  const d='a'.repeat(64),dates=TARGET_DATES;
  const data={status:'ok',checkedDates:dates,diagnostics:dates.map(fixtureDay),
    strictSourceDigest:d,integritySourceRevision:'1'};
  const result=summarizeThreeDays(data);
  assert.equal(result.sameMissingCodeAllThree,1);
  assert.equal(result.sameDuplicateCodeAllThree,1);
  assert.equal(result.days[0].expectedRows,3);
  assert.equal(result.days[0].missingCodes,1);
  assert.equal(result.days[0].duplicateGroups,1);
  assert.equal(result.days[0].existingWithNoQtyCostCandidate,0);
  assert.equal(result.days[0].existingWithQtyCostCandidate,2);
  assert.equal(result.allowedToRestore,false);
  assert.ok(!JSON.stringify(result).includes('000001'));
  assert.ok(!JSON.stringify(result).includes('SYNTH'));
  const drift=structuredClone(data);drift.diagnostics[1].missingCodes=[];
  assert.throws(()=>summarizeThreeDays(drift),/DRIFT/);
  const status={status:'ok',gasVersion:'9.244',automation:{
    gasVersion:'9.244',tradeSnapshotDeferredDates:dates,
    tradeSnapshotDeferredCount:3,tradeSnapshotDeferredOldestDate:dates[0],
    tradeSnapshotDeferredCursor:'',pendingTradeSnapshotRebuildFrom:''}};
  const calls=[];
  const stub=async(_url,options)=>{
    const action=options.body.get('action'),t=options.body.get('accessToken');
    calls.push(action);
    return {ok:true,json:async()=>t!=='TEST_TOKEN'
      ?{status:'error',message:'인증 실패'}
      :action==='getAutomationStatus'?status:data};
  };
  const live=await runReadonly({url:'https://script.google.com/macros/s/TEST/exec',
    token:'TEST_TOKEN',fetchImpl:stub});
  assert.equal(live.sourceStableWithinThisRead,true);
  assert.equal(live.queueStableWithinThisRead,true);
  assert.deepEqual(calls,['getAutomationStatus','getAutomationStatus',
    'diagnoseSnapshotIntegrityRange','diagnoseSnapshotIntegrityRange','getAutomationStatus']);
  const mutated=structuredClone(data);mutated.strictSourceDigest='b'.repeat(64);
  let countCalls=0;
  const changed=async(_url,options)=>{
    const action=options.body.get('action'),token=options.body.get('accessToken');
    const response=token!=='TEST_TOKEN'?{status:'error',message:'인증 실패'}
      :action==='getAutomationStatus'?status:++countCalls===1?data:mutated;
    return {ok:true,json:async()=>response};
  };
  await assert.rejects(runReadonly({url:'https://script.google.com/macros/s/TEST/exec',
    token:'TEST_TOKEN',fetchImpl:changed}),/SOURCE_CHANGED/);
  console.log('ISSUE507_THREE_DAY_CODE_LINEAGE_CONTRACT_PASS');
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
  try{
    if(process.argv.includes('--self-test'))await selfTest();
    else console.log(JSON.stringify(await runReadonly({
      url:process.env.GAS_WEB_APP_URL,token:process.env.GAS_ACCESS_TOKEN})));
  }catch(e){
    if(process.argv.includes('--self-test'))console.error(String(e?.stack||e).slice(0,1200));
    else console.error(/^ISSUE507_THREE_DAY_[A-Z_]+$/.test(String(e?.message||''))
      ?String(e.message):'ISSUE507_THREE_DAY_UNKNOWN');
    process.exitCode=1;
  }
}