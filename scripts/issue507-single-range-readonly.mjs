#!/usr/bin/env node
// #507 — compare the ACTUAL single-day and indexed range diagnostics.
// Strict READ ONLY. Never expose GAS source errors, positions, trade rows,
// tokens, URLs, prices, quantities, personal holdings or raw responses.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {validateWebAppUrl} from './diagnose-krx-operational.mjs';
import {runBackfillStatus} from './diagnose-backfill-status.mjs';

export const DATE='2025-12-31';
const ACTIONS=new Set(['diagnoseSnapshotIntegrity','diagnoseSnapshotIntegrityRange']);
const STATUSES=new Set(['VALID','PARTIAL','MISMATCH','CONFLICT',
  'SOURCE_INCOMPLETE','PRICE_SUSPICIOUS','NO_SNAPSHOT']);
const ARRAY_FIELDS=['missingCodes','unexpectedCodes','qtyMismatches',
  'costAmtMismatches','evalUnitMismatches','evalAmtMismatches',
  'sourceMismatches','duplicateKeys','conflictKeys','sourceDataErrors'];
const DUP_FIELDS=['groups','exactDuplicate','singleExpectedMatch',
  'manualProtected','unresolvedConflict','sourceIncomplete'];
// Private deterministic digest: compare the *contents* of relevant records,
// including different codes/errors with equal counts, without printing records
// or digests. Array order is immaterial; object key order is canonicalized.
const PRIVATE_FIELDS=['expectedRows','storedRows',...ARRAY_FIELDS,
  'fundNavStates','foreignFxStates','priceIntegrity'];
function canonical(value){
  if(Array.isArray(value))return value.map(canonical);
  if(value&&typeof value==='object')return Object.fromEntries(
    Object.keys(value).sort().map(k=>[k,canonical(value[k])]));
  return value;
}
function privateDigest(record){
  const canonicalFields=PRIVATE_FIELDS.map(k=>{
    const a=record[k];
    if(!Array.isArray(a))throw Error('ISSUE507_COMPARE_BAD_ARRAY');
    return [k,a.map(x=>JSON.stringify(canonical(x))).sort()];
  });
  return createHash('sha256').update(JSON.stringify(canonicalFields)).digest('hex');
}
function count(n){if(!Number.isSafeInteger(n)||n<0||n>1000000)
  throw Error('ISSUE507_COMPARE_BAD_COUNT');return n;}
export function summarizeOne(payload,kind){
  if(payload?.status!=='ok')throw Error('ISSUE507_COMPARE_BAD_RESPONSE');
  if(kind==='single'){
    if(!Array.isArray(payload.diagnostics)||payload.diagnostics.length!==1
      ||payload.diagnostic?.date!==DATE)
      throw Error('ISSUE507_COMPARE_BAD_SINGLE');
  }else if(kind==='range'){
    if(!Array.isArray(payload.checkedDates)||payload.checkedDates.length!==1
      ||payload.checkedDates[0]!==DATE
      ||!Array.isArray(payload.diagnostics)||payload.diagnostics.length!==1)
      throw Error('ISSUE507_COMPARE_BAD_RANGE');
  }else throw Error('ISSUE507_COMPARE_BAD_KIND');
  const x=payload.diagnostics[0];
  if(!x||x.date!==DATE||!STATUSES.has(x.status))
    throw Error('ISSUE507_COMPARE_BAD_STATUS');
  const counts={};
  for(const k of ARRAY_FIELDS){
    if(!Array.isArray(x[k]))throw Error('ISSUE507_COMPARE_BAD_ARRAY');
    counts[k]=count(x[k].length);
  }
  const duplicates={};
  for(const k of DUP_FIELDS)duplicates[k]=count(x.duplicateSummary?.[k]);
  const rowCounts={expected:count(x.expectedRowCount),stored:count(x.storedRowCount)};
  // No contents of sourceDataErrors or per-code mismatches escape this parser.
  const sanitized={date:DATE,kind,status:x.status,rows:rowCounts,
    duplicates,counts};
  // Hidden properties are not serialized by JSON.stringify/log output.
  Object.defineProperties(sanitized,{
    privateDigest:{value:privateDigest(x),enumerable:false},
    sourceRevision:{value:kind==='range'
      ?JSON.stringify(canonical(payload.integritySourceRevision??null))
      :null,enumerable:false}
  });
  return sanitized;
}
async function request(url,token,action,fetchImpl){
  if(!ACTIONS.has(action))throw Error('ISSUE507_COMPARE_ACTION_FORBIDDEN');
  let response;
  try{
    response=await fetchImpl(url,{method:'POST',
      headers:{'content-type':'application/x-www-form-urlencoded;charset=UTF-8'},
      body:new URLSearchParams({action,
        [action==='diagnoseSnapshotIntegrity'?'date':'dates']:DATE,
        accessToken:token}),
      redirect:'follow',signal:AbortSignal.timeout(240000)});
  }catch{throw Error('ISSUE507_COMPARE_NETWORK_FAILED');}
  if(!response?.ok)throw Error('ISSUE507_COMPARE_HTTP_FAILED');
  try{return await response.json();}
  catch{throw Error('ISSUE507_COMPARE_JSON_FAILED');}
}
function sameCounts(a,b){
  return JSON.stringify({rows:a.rows,duplicates:a.duplicates,counts:a.counts})
    ===JSON.stringify({rows:b.rows,duplicates:b.duplicates,counts:b.counts});
}
export function compare(single,range,before,after,rangeRepeat=range){
  if(single.date!==DATE||range.date!==DATE||rangeRepeat.date!==DATE
    ||single.kind!=='single'||range.kind!=='range'
    ||rangeRepeat.kind!=='range')throw Error('ISSUE507_COMPARE_BAD_INPUT');
  if(before?.mode!=='READ_ONLY'||after?.mode!=='READ_ONLY'
    ||before.gasVersion!==after.gasVersion
    ||before.gasVersion!=='9.240')
    throw Error('ISSUE507_COMPARE_VERSION_DRIFT');
  const b=before.tradeSnapshotWorkerLastResult, a=after.tradeSnapshotWorkerLastResult;
  const checkpointStable=JSON.stringify(b)===JSON.stringify(a)
    &&before.pendingTradeSnapshotRebuildFrom===after.pendingTradeSnapshotRebuildFrom
    &&before.tradeSnapshotDeferredCount===after.tradeSnapshotDeferredCount;
  const sameStatus=single.status===range.status;
  const sourceStable=range.status===rangeRepeat.status
    &&sameCounts(range,rangeRepeat)
    &&range.privateDigest===rangeRepeat.privateDigest
    &&range.sourceRevision===rangeRepeat.sourceRevision;
  const detailMatch=single.privateDigest===range.privateDigest;
  const deferrable=x=>['SOURCE_INCOMPLETE','CONFLICT','PRICE_SUSPICIOUS'].includes(x.status);
  const priorWorkerBlocked=after.tradeSnapshotWorkerLastResult?.status==='BLOCKED'
    &&after.tradeSnapshotWorkerLastResult?.blockedDate===DATE;
  let diagnosis='CONSISTENT';
  if(!checkpointStable)diagnosis='WORKER_CHANGED_DURING_PROBE';
  else if(!sourceStable)diagnosis='SOURCE_OR_RANGE_CHANGED_DURING_PROBE';
  else if(!sameStatus||!sameCounts(single,range)||!detailMatch)
    diagnosis='SINGLE_RANGE_DIVERGENCE_CANDIDATE';
  else if(priorWorkerBlocked&&deferrable(single))
    diagnosis='BLOCKED_VS_CURRENT_DEFERRABLE';
  else if(priorWorkerBlocked)diagnosis='BLOCKED_WITH_NONDEFERRABLE_STATUS';
  // Both diagnostic paths can agree while the earlier worker faced different
  // inputs. Do NOT infer the historical cause from one later status.
  return {mode:'READ_ONLY',gasVersion:after.gasVersion,date:DATE,diagnosis,
    checkpointStable,priorWorkerBlocked,
    workerCheckpointAt:after.tradeSnapshotWorkerLastResult?.at||'NOT_OBSERVED',
    pendingDate:after.pendingTradeSnapshotRebuildFrom,
    deferredCount:after.tradeSnapshotDeferredCount,
    single,range,statusMatch:sameStatus,countsMatch:sameCounts(single,range),
    detailsMatch:detailMatch,sourceStable,independentReads:true,
    singleDeferrable:deferrable(single),rangeDeferrable:deferrable(range),
    readOnly:true,operation:'NO_WRITES'};
}
export async function runReadonly({url,token,fetchImpl=fetch,readStatus=runBackfillStatus}){
  const endpoint=validateWebAppUrl(url);
  if(typeof token!=='string'||!token.trim())throw Error('ISSUE507_COMPARE_TOKEN_MISSING');
  const badToken=token==='ISSUE507_COMPARE_NEGATIVE_AUTH'
    ?'ISSUE507_COMPARE_NEGATIVE_AUTH_ALT':'ISSUE507_COMPARE_NEGATIVE_AUTH';
  const rejected=await request(endpoint,badToken,'diagnoseSnapshotIntegrity',fetchImpl);
  if(rejected?.status!=='error'||rejected.message!=='인증 실패')
    throw Error('ISSUE507_COMPARE_AUTH_DISABLED');
  const before=await readStatus({url:endpoint,token,fetchImpl});
  const range=summarizeOne(await request(endpoint,token,'diagnoseSnapshotIntegrityRange',fetchImpl),'range');
  const single=summarizeOne(await request(endpoint,token,'diagnoseSnapshotIntegrity',fetchImpl),'single');
  // A/B/A sandwich: reject path attribution if surrounding indexed proofs differ.
  const rangeRepeat=summarizeOne(await request(endpoint,token,'diagnoseSnapshotIntegrityRange',fetchImpl),'range');
  const after=await readStatus({url:endpoint,token,fetchImpl});
  return compare(single,range,before,after,rangeRepeat);
}
export async function selfTest(){
  const rows={date:DATE,status:'SOURCE_INCOMPLETE',expectedRowCount:0,
    storedRowCount:2,duplicateSummary:Object.fromEntries(DUP_FIELDS.map(k=>[k,0])),
    expectedRows:[],storedRows:[],fundNavStates:[],foreignFxStates:[],priceIntegrity:[],
    ...Object.fromEntries(ARRAY_FIELDS.map(k=>[k,[]]))};
  rows.sourceDataErrors=['SECRET_ACCOUNT_123456'];
  const single=summarizeOne({status:'ok',diagnostics:[rows],diagnostic:rows},'single');
  const range=summarizeOne({status:'ok',diagnostics:[rows],checkedDates:[DATE]},'range');
  assert.ok(!JSON.stringify(single).includes('SECRET_ACCOUNT'));
  const state={mode:'READ_ONLY',gasVersion:'9.240',pendingTradeSnapshotRebuildFrom:DATE,
    tradeSnapshotDeferredCount:0,tradeSnapshotWorkerLastResult:{status:'BLOCKED',at:'2026-10-19T10:07:21.908Z',blockedDate:DATE}};
  const result=compare(single,range,state,state);
  assert.equal(result.diagnosis,'BLOCKED_VS_CURRENT_DEFERRABLE');
  assert.equal(result.statusMatch,true);
  assert.ok(!JSON.stringify(result).includes('privateDigest'));
  assert.ok(!JSON.stringify(result).includes('SECRET_ACCOUNT'));
  const different={...rows,sourceDataErrors:['DIFFERENT_SECRET_SAME_COUNT']};
  const alteredSingle=summarizeOne({status:'ok',diagnostics:[different],diagnostic:different},'single');
  assert.equal(alteredSingle.counts.sourceDataErrors,single.counts.sourceDataErrors);
  assert.equal(compare(alteredSingle,range,state,state).diagnosis,
    'SINGLE_RANGE_DIVERGENCE_CANDIDATE');
  const changedRange={...rows,sourceDataErrors:['CONCURRENT_DATA_CHANGE']};
  const changedRangeProof=summarizeOne({status:'ok',diagnostics:[changedRange],checkedDates:[DATE]},'range');
  assert.equal(compare(single,range,state,state,changedRangeProof).diagnosis,
    'SOURCE_OR_RANGE_CHANGED_DURING_PROBE');

  assert.equal(result.single.counts.sourceDataErrors,1);
  const valid={...rows,status:'VALID',sourceDataErrors:[]};
  const validSingle=summarizeOne({status:'ok',diagnostics:[valid],diagnostic:valid},'single');
  assert.equal(compare(validSingle,range,state,state).diagnosis,'SINGLE_RANGE_DIVERGENCE_CANDIDATE');
  assert.equal(compare(single,range,state,{...state,tradeSnapshotDeferredCount:1}).diagnosis,
    'WORKER_CHANGED_DURING_PROBE');
  assert.throws(()=>summarizeOne({status:'ok',diagnostics:[rows,rows],diagnostic:rows},'single'),
    /ISSUE507_COMPARE_BAD_SINGLE/);
  assert.throws(()=>summarizeOne({status:'ok',diagnostics:[{...rows,sourceDataErrors:null}],
    checkedDates:[DATE]},'range'),/ISSUE507_COMPARE_BAD_ARRAY/);
  let actions=[];const fake=async(_u,opts)=>{
    const action=opts.body.get('action'),token=opts.body.get('accessToken');
    actions.push(action);
    assert.ok(ACTIONS.has(action),'must not mutate GAS');
    assert.equal(opts.body.get('apply'),null);
    const payload=token!=='top-secret'?{status:'error',message:'인증 실패'}:
      action==='diagnoseSnapshotIntegrity'?{status:'ok',diagnostics:[rows],diagnostic:rows}:
      {status:'ok',checkedDates:[DATE],diagnostics:[rows],integritySourceRevision:1};
    return {ok:true,json:async()=>payload};
  };
  const report=await runReadonly({url:'https://script.google.com/macros/s/example/exec',
    token:'top-secret',fetchImpl:fake,readStatus:async()=>state});
  assert.equal(report.diagnosis,'BLOCKED_VS_CURRENT_DEFERRABLE');
  assert.deepEqual(actions,['diagnoseSnapshotIntegrity','diagnoseSnapshotIntegrityRange',
    'diagnoseSnapshotIntegrity','diagnoseSnapshotIntegrityRange']);
  assert.ok(!JSON.stringify(report).includes('top-secret'));
  await assert.rejects(()=>runReadonly({url:'https://script.google.com/macros/s/example/exec',
    token:'top-secret',fetchImpl:async()=>({ok:true,json:async()=>({status:'ok'})}),
    readStatus:async()=>state}),/ISSUE507_COMPARE_AUTH_DISABLED/);
  console.log('Issue #507 production read-only single/range diagnosis contract: PASS');
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
  try{
    if(process.argv.includes('--self-test'))await selfTest();
    else console.log(JSON.stringify(await runReadonly({
      url:process.env.GAS_WEB_APP_URL,token:process.env.GAS_ACCESS_TOKEN})));
  }catch(error){
    const code=String(error?.message||'');
    console.error(/^ISSUE507_COMPARE_[A-Z_]+$/.test(code)?code:'ISSUE507_COMPARE_UNKNOWN_ERROR');
    process.exitCode=1;
  }
}
