import assert from 'node:assert/strict';
import {SEPTEMBER_DATES,summarizeSeptemberProof,verifySeptember}
  from './diagnose-september-snapshot-readonly.mjs';
const dates=[...SEPTEMBER_DATES];
const zero={groups:0,exactDuplicate:0,singleExpectedMatch:0,
  manualProtected:0,unresolvedConflict:0,sourceIncomplete:0};
const day=date=>({date,status:'VALID',expectedRowCount:39,storedRowCount:39,
  duplicateSummary:zero,missingCodes:[],unexpectedCodes:[],duplicateKeys:[],
  qtyMismatches:[],costAmtMismatches:[],evalUnitMismatches:[],
  evalAmtMismatches:[],sourceMismatches:[],sourceDataErrors:[],
  fundNavStates:['F00001','F00002'].map(code=>({code,source:'FUND_NAV',sourceDate:date,temporary:false})),
  rawAccountSecret:'NEVER_OUTPUT_THIS'});
const success={status:'ok',checkedDates:dates,diagnostics:dates.map(day)};
const checked=summarizeSeptemberProof(success);
assert.equal(checked.healthy,true);
assert.equal(checked.exactFundNav,true);
assert.deepEqual(checked.snapshots.map(x=>[x.date,x.status,x.expectedRows,x.storedRows]),
  dates.map(d=>[d,'VALID',39,39]));
assert.doesNotMatch(JSON.stringify(checked),/NEVER_OUTPUT_THIS/);
const navCarry=structuredClone(success);
navCarry.diagnostics[0].fundNavStates[0].source='FUND_NAV_CARRY';
navCarry.diagnostics[0].fundNavStates[0].temporary=true;
assert.equal(summarizeSeptemberProof(navCarry).exactFundNav,false);
assert.equal(summarizeSeptemberProof(navCarry).healthy,false);
const navDate=structuredClone(success);
navDate.diagnostics[1].fundNavStates[1].sourceDate='2026-09-15';
assert.equal(summarizeSeptemberProof(navDate).healthy,false);
const navDuplicate=structuredClone(success);
navDuplicate.diagnostics[1].fundNavStates[1].code='F00001';
assert.equal(summarizeSeptemberProof(navDuplicate).healthy,false);
const navMissing=structuredClone(success);
navMissing.diagnostics[0].fundNavStates=[];
assert.equal(summarizeSeptemberProof(navMissing).healthy,false);
const navInput=structuredClone(success);
navInput.diagnostics[0].fundNavStates[0].source='FUND_NAV_INPUT_REQUIRED';
assert.equal(summarizeSeptemberProof(navInput).healthy,false);
const sourceConflict=structuredClone(success);
sourceConflict.diagnostics[0].sourceMismatches=[{code:'F00001'}];
sourceConflict.diagnostics[0].status='MISMATCH';
assert.equal(summarizeSeptemberProof(sourceConflict).healthy,false);
const duplicate=structuredClone(success);
duplicate.diagnostics[1].duplicateSummary.groups=1;
assert.equal(summarizeSeptemberProof(duplicate).healthy,false);
const count=structuredClone(success);
count.diagnostics[0].storedRowCount=40;
assert.equal(summarizeSeptemberProof(count).healthy,false);
assert.throws(()=>summarizeSeptemberProof({...success,diagnostics:[success.diagnostics[0]]}),
  /SEPT_SNAPSHOT_INVALID_RESPONSE/);
assert.throws(()=>summarizeSeptemberProof({...success,
  diagnostics:[success.diagnostics[0],success.diagnostics[0]]}),
  /SEPT_SNAPSHOT_INVALID_DATES/);
assert.deepEqual(summarizeSeptemberProof({status:'error',errorCode:'SOURCE_DATA_ERROR',
  phase:'index_build',message:'SECRET_FROM_GAS'}),
  {mode:'READ_ONLY',dates,healthy:false,errorCode:'SOURCE_DATA_ERROR',phase:'index_build'});
const url='https://script.google.com/macros/s/safe-exec/exec',token='A_SECRET';
let actions=[],mode='ok';
const fake=async(_url,opt)=>{
  assert.equal(_url,url);assert.equal(opt.method,'POST');
  const body=opt.body;actions.push({action:body.get('action'),dates:body.get('dates')});
  assert.equal(body.get('action'),'diagnoseSnapshotIntegrityRange');
  assert.equal(body.get('dates'),'2026-09-15,2026-09-16');
  if(body.get('accessToken')!==token)
    return {ok:true,json:async()=>mode==='authDisabled'
      ?success:{status:'error',message:'인증 실패'}};
  if(mode==='upstreamError')return {ok:true,json:async()=>({
    status:'error',errorCode:'RUNTIME_ERROR',phase:'snapshot_integrity',
    message:'NEVER_OUTPUT_THIS_SECRET'})};
  return {ok:true,json:async()=>success};
};
assert.equal((await verifySeptember({url,token,fetchImpl:fake})).healthy,true);
assert.equal(actions.length,2);
mode='authDisabled';await assert.rejects(()=>verifySeptember({url,token,fetchImpl:fake}),
  /SEPT_SNAPSHOT_AUTH_NOT_ENFORCED/);
mode='upstreamError';
let bad=await verifySeptember({url,token,fetchImpl:fake});
assert.equal(bad.healthy,false);
assert.equal(bad.errorCode,'RUNTIME_ERROR');
assert.doesNotMatch(JSON.stringify(bad),/SECRET/);
await assert.rejects(()=>verifySeptember({url,token:'',fetchImpl:fake}),
  /SEPT_SNAPSHOT_TOKEN_MISSING/);
console.log('September isolated GAS read-only proof: PASS');
