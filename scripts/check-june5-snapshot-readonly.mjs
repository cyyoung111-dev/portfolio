import assert from 'node:assert/strict';
import {TARGET_DATE,summarizeJune5Proof,verifyJune5}
  from './diagnose-june5-snapshot-readonly.mjs';

const zero={groups:0,exactDuplicate:0,singleExpectedMatch:0,
  manualProtected:0,unresolvedConflict:0,sourceIncomplete:0};
const day={date:TARGET_DATE,status:'VALID',expectedRowCount:37,storedRowCount:37,
  duplicateSummary:zero,missingCodes:[],unexpectedCodes:[],duplicateKeys:[],
  qtyMismatches:[],costAmtMismatches:[],evalUnitMismatches:[],
  evalAmtMismatches:[],sourceMismatches:[],sourceDataErrors:[],
  fundNavStates:['F00001','F00002','F00003'].map(code=>({
    code,source:'FUND_NAV',sourceDate:TARGET_DATE,temporary:false})),
  secretField:'DO_NOT_LOG_PRIVATE_DATA'};
const success={status:'ok',checkedDates:[TARGET_DATE],diagnostics:[day]};
let p=summarizeJune5Proof(success);
assert.equal(p.healthy,true);
assert.equal(p.expectedRows,37);
assert.equal(p.fundNavStateCount,3);
assert.doesNotMatch(JSON.stringify(p),/DO_NOT_LOG_PRIVATE_DATA/);
const mutate=(fn)=>{
  const x=structuredClone(success);fn(x.diagnostics[0]);return summarizeJune5Proof(x);
};
assert.equal(mutate(d=>{d.status='CONFLICT';}).healthy,false);
assert.equal(mutate(d=>{d.storedRowCount=39;}).healthy,false);
assert.equal(mutate(d=>{d.duplicateSummary.groups=1;}).healthy,false);
assert.equal(mutate(d=>{d.qtyMismatches=[{price:123,secret:'SECRET'}];}).healthy,false);
assert.equal(mutate(d=>{d.sourceMismatches=[{}];}).healthy,false);
assert.equal(mutate(d=>{d.fundNavStates[0].source='FUND_NAV_CARRY';}).healthy,false);
assert.equal(mutate(d=>{d.fundNavStates[0].sourceDate='2026-06-04';}).healthy,false);
assert.equal(mutate(d=>{d.fundNavStates[0].temporary=true;}).healthy,false);
assert.equal(mutate(d=>{d.fundNavStates[1].code='F00001';}).healthy,false);
assert.throws(()=>summarizeJune5Proof({...success,checkedDates:['2026-06-04']}),
  /JUNE5_INVALID_RESPONSE/);
assert.throws(()=>summarizeJune5Proof({...success,diagnostics:[day,day]}),
  /JUNE5_INVALID_RESPONSE/);
assert.throws(()=>mutate(d=>{d.duplicateSummary.groups=-1;}),/JUNE5_INVALID_COUNTS/);
assert.throws(()=>mutate(d=>{delete d.evalAmtMismatches;}),/JUNE5_INVALID_ARRAYS/);
const safeError=summarizeJune5Proof({status:'error',errorCode:'RUNTIME_ERROR',
  message:'ACCESS_TOKEN_SECRET'});
assert.deepEqual(safeError,{mode:'READ_ONLY',date:TARGET_DATE,
  diagnosisComplete:false,errorCode:'RUNTIME_ERROR'});
assert.doesNotMatch(JSON.stringify(safeError),/ACCESS_TOKEN_SECRET/);
const url='https://script.google.com/macros/s/safe-exec/exec',token='SECRET';
const calls=[];
let mode='ok';
const fake=async(givenUrl,opt)=>{
  assert.equal(givenUrl,url);assert.equal(opt.method,'POST');
  assert.equal(opt.body.get('action'),'diagnoseSnapshotIntegrityRange');
  assert.equal(opt.body.get('dates'),TARGET_DATE);
  assert.equal(opt.body.has('apply'),false);
  calls.push({action:opt.body.get('action'),dates:opt.body.get('dates')});
  if(opt.body.get('accessToken')!==token)
    return {ok:true,json:async()=>mode==='missingAuth'
      ?success:{status:'error',message:'인증 실패'}};
  return {ok:true,json:async()=>success};
};
assert.equal((await verifyJune5({url,token,fetchImpl:fake})).diagnosisComplete,true);
assert.equal(calls.length,2);
mode='missingAuth';
await assert.rejects(()=>verifyJune5({url,token,fetchImpl:fake}),
  /JUNE5_AUTH_NOT_ENFORCED/);
await assert.rejects(()=>verifyJune5({url,token:'',fetchImpl:fake}),
  /JUNE5_TOKEN_MISSING/);
console.log('June 5 exact-date GAS read-only diagnostics contract PASS');
