import assert from 'node:assert/strict';
import fs from 'node:fs';
import YAML from 'yaml';
import {assessNov19DerivedRecovery,recoverNov19DerivedOnce,TARGET_DATE}
 from './issue734-nov19-derived-once.mjs';

const code='F00002',other='F00001';
const proof={status:'VERIFIED',version:'9.304',tradeRows:338,tradeV2HashVerified:true,
 writerGateMode:'OPEN',activeCount:0,pendingCount:0,tradeSnapshotDeferredCount:0,
 financeWrites:0};
const status={gasVersion:'9.304',triggerReady:true,
 tradeLedgerWriteUnverified:false,pendingTradeSnapshotRebuildFrom:'-',
 tradeSnapshotDeferredCount:0,pendingCount:0,snapshotLastDate:TARGET_DATE,
 priceHistoryLastDate:TARGET_DATE,overallStatus:'NORMAL',
 close:{state:'COMPLETE',stage:'COMPLETE',runDate:TARGET_DATE,
 priceOk:true,fundOk:true,fundState:'DONE',fundAttemptDate:TARGET_DATE,
 closeErrorPresent:false,fundErrorPresent:false}};
const row=(fund,override={})=>({code:fund,date:TARGET_DATE,navState:'EXISTING_CONFIRMED',
 valuationRequired:true,unitsApplied:true,reconciled:true,evaluationState:'EXISTING_VALID',
 snapshotState:'WRITE_REQUIRED',...override});
const pending=row(code);
assert.equal(assessNov19DerivedRecovery({integrity:proof,status,row:pending,code}).state,'EXACT_DATE_PENDING');
assert.equal(assessNov19DerivedRecovery({integrity:proof,status,row:row(code,{snapshotState:'EXISTING_VALID'}),code}).state,'ALREADY_VERIFIED');
const laterClose={...status,snapshotLastDate:'2026-11-20',priceHistoryLastDate:'2026-11-20',
 close:{...status.close,runDate:'2026-11-20',fundAttemptDate:'2026-11-20'}};
for(const fund of [code,other]) {
 assert.equal(assessNov19DerivedRecovery({integrity:proof,status:laterClose,
  row:row(fund,{snapshotState:'EXISTING_VALID'}),code:fund}).state,'ALREADY_VERIFIED',
  'existing exact-day NAV/Snapshot must be a no-write success despite later CLOSE');
 assert.throws(()=>assessNov19DerivedRecovery({integrity:proof,status:laterClose,
  row:row(fund),code:fund}),/ISSUE734_NOV19_CLOSE_OWNER_OR_DATE_UNVERIFIED/,
  'never replay stale date after latest CLOSE advanced');
}
for(const broken of [
 {...laterClose,close:{...laterClose.close,stage:'FUND_PENDING'}},
 {...laterClose,close:{...laterClose.close,fundAttemptDate:'2026-11-19'}},
 {...laterClose,overallStatus:'INCOMPLETE'},
 {...laterClose,pendingCount:1},
 {...laterClose,snapshotLastDate:'2026-11-18'}
])assert.throws(()=>assessNov19DerivedRecovery({integrity:proof,status:broken,
 row:row(code,{snapshotState:'EXISTING_VALID'}),code}),
 /ISSUE734_NOV19_CLOSE_OWNER_OR_DATE_UNVERIFIED/);

let denied=0;
for(const bad of [
 {integrity:{...proof,version:'9.305'}},{integrity:{...proof,tradeRows:337}},
 {integrity:{...proof,activeCount:1}},{integrity:{...proof,tradeV2HashVerified:false}},
 {status:{...status,snapshotLastDate:'2026-11-20'}},
 {status:{...status,priceHistoryLastDate:'2026-11-18'}},
 {status:{...status,close:{...status.close,runDate:'2026-11-20'}}},
 {status:{...status,close:{...status.close,state:'INCOMPLETE'}}},
 {status:{...status,tradeLedgerWriteUnverified:true}},
 {row:row(code,{navState:'NAV_MISSING'})},
 {row:row(code,{unitsApplied:false})},
 {row:row(code,{reconciled:false})},
 {row:row(code,{evaluationState:'NOT_REQUIRED'})},
 {row:row(code,{date:'2026-11-18'})},
 {row:row(other)}
]){
 assert.throws(()=>assessNov19DerivedRecovery({integrity:bad.integrity??proof,
  status:bad.status??status,row:bad.row??pending,code}),/ISSUE734_NOV19_/);denied++;
}
const url='https://script.google.com/macros/s/TEST_DEPLOYMENT_123/exec',token='MOCK_PRIVATE_ACCESS_TOKEN';
function mocks({fund=code,confirm='APPLY_2026-11-19',diagnoseOnly=false,
 changed=false,alreadyValid=false,writeError='',afterInvalid=false,
 statusState=status}={}){
 let reads=0,writes=0,verifyCalls=0,statusCalls=0;
 const post=async({action,args,write})=>{
  if(action==='getFundValuationStatus'){
   reads++;assert.equal(args.from,TARGET_DATE);assert.equal(args.to,TARGET_DATE);
   assert.equal(args.code,fund);
   const ready=alreadyValid ||(writes>0&&!afterInvalid);
   const snapshotState=ready?'EXISTING_VALID':'WRITE_REQUIRED';
   return {status:'ok',fundResults:{[fund]:{code:fund,
    dates:[row(fund,{snapshotState,
     ...(changed&&reads===2?{evaluationState:'NOT_CREATED'}:{})})]}}};
  }
  assert.equal(action,fund==='F00001'?'collectHanwhaFundNav':'collectKbFundNav');
  assert.deepEqual(args,{mode:'refresh',date:TARGET_DATE});
  assert.equal(write,true);
  writes++;
  if(writeError==='LOST')throw Error('ISSUE734_NOV19_WRITE_ACK_UNCERTAIN_NO_RETRY');
  if(writeError==='REJECT')return {status:'error'};
  return {status:'ok'};
 };
 const config={url,token,code:fund,confirm,diagnoseOnly,post,
  verify:async()=>{verifyCalls++;return proof;},
  readStatus:async()=>{statusCalls++;return statusState;}};
 return {config,get:()=>({reads,writes,verifyCalls,statusCalls})};
}
const diagnose=mocks({diagnoseOnly:true,confirm:''});
const view=await recoverNov19DerivedOnce(diagnose.config);
assert.equal(view.mode,'READ_ONLY');assert.equal(diagnose.get().writes,0);
const good=mocks();
const done=await recoverNov19DerivedOnce(good.config);
assert.equal(done.readbackVerified,true);assert.equal(done.writeAttempts,1);
assert.equal(good.get().writes,1);assert.equal(good.get().verifyCalls,2);
assert.equal(good.get().reads,3);
const hanwha=mocks({fund:other});
assert.equal((await recoverNov19DerivedOnce(hanwha.config)).state,'EXACT_DAY_DERIVED_VERIFIED');
assert.equal(hanwha.get().writes,1);
const noChanges=mocks({alreadyValid:true});
assert.equal((await recoverNov19DerivedOnce(noChanges.config)).alreadyVerified,true);
assert.equal(noChanges.get().writes,0);
for(const fund of [code,other]) {
 const alreadyNewer=mocks({fund,alreadyValid:true,statusState:laterClose});
 const result=await recoverNov19DerivedOnce(alreadyNewer.config);
 assert.equal(result.state,'ALREADY_VERIFIED');
 assert.equal(result.mode,'READ_ONLY');
 assert.equal(result.alreadyVerified,true);
 assert.equal(alreadyNewer.get().writes,0);
 assert.equal(alreadyNewer.get().verifyCalls,1);
 assert.equal(alreadyNewer.get().reads,1);
 const stalePending=mocks({fund,statusState:laterClose});
 await assert.rejects(()=>recoverNov19DerivedOnce(stalePending.config),
  /ISSUE734_NOV19_CLOSE_OWNER_OR_DATE_UNVERIFIED/);
 assert.equal(stalePending.get().writes,0);
}
const noConsent=mocks({confirm:''});
await assert.rejects(()=>recoverNov19DerivedOnce(noConsent.config),/ISSUE734_NOV19_MANUAL_APPROVAL_REQUIRED/);
assert.equal(noConsent.get().verifyCalls,0);assert.equal(noConsent.get().writes,0);
const drift=mocks({changed:true});
await assert.rejects(()=>recoverNov19DerivedOnce(drift.config),/ISSUE734_NOV19_SOURCE_CHANGED_DURING_PREFLIGHT/);
assert.equal(drift.get().writes,0);
for(const writeError of ['LOST','REJECT']){
 const x=mocks({writeError,afterInvalid:true});
 await assert.rejects(()=>recoverNov19DerivedOnce(x.config),/ISSUE734_NOV19_/);
 assert.equal(x.get().writes,1,'never retry uncertain/rejected financial writer');
}
const recovered=mocks({writeError:'LOST'});
assert.equal((await recoverNov19DerivedOnce(recovered.config)).ackRecoveredByReadback,true);
assert.equal(recovered.get().writes,1);
for(const badCode of ['F00003','',undefined]) {
 await assert.rejects(()=>recoverNov19DerivedOnce({url,token,code:badCode}),
  /ISSUE734_NOV19_FUND_SCOPE_INVALID/);
}
const wf=YAML.parse(fs.readFileSync('.github/workflows/issue734-nov19-fund-derived-once.yml','utf8'));
assert.equal(wf.on.schedule,undefined);
assert.equal(wf.on.push,undefined);
assert.equal(wf.on.workflow_run,undefined);
assert.deepEqual(Object.keys(wf.on.workflow_dispatch.inputs).sort(),['fund_code','operation']);
assert.deepEqual(wf.on.workflow_dispatch.inputs.fund_code.options,['F00001','F00002']);
assert.deepEqual(wf.on.workflow_dispatch.inputs.operation.options,['진단만','실제 복구 (1회)']);
assert.equal(wf.on.workflow_dispatch.inputs.operation.default,'진단만');
assert.equal(wf.on.workflow_dispatch.inputs.operation.type,'choice');
assert.equal(wf.on.workflow_dispatch.inputs.operation.required,true);
assert.equal(wf.jobs.repair.environment,'portfolio-production-gas');
assert.equal(wf.jobs.repair.concurrency.group,'gas-production-deploy');
const run=wf.jobs.repair.steps.find(s=>String(s.run||'').includes('node scripts/issue734-nov19-derived-once.mjs'));
assert(run);
assert.match(run.env.ISSUE734_CONFIRM,/inputs\.operation == '실제 복구 \(1회\)'/);
assert.match(run.env.ISSUE734_CONFIRM,/&& 'APPLY_2026-11-19' \|\| ''/);
assert.match(run.env.ISSUE734_DIAGNOSE_ONLY,/inputs\.operation == '진단만'/);
assert.match(run.env.ISSUE734_DIAGNOSE_ONLY,/&& 'true' \|\| 'false'/);
assert.doesNotMatch(JSON.stringify(wf),/inputs\.confirm_recovery|inputs\.diagnose_only/);
assert.match(run.env.ISSUE734_FUND_CODE,/inputs\.fund_code/);
assert.doesNotMatch(JSON.stringify(wf),/schedule:|workflow_run:|resumeIncompletePortfolioClose|importFundNav/);
console.log(JSON.stringify({kind:'ISSUE734_NOV19_SINGLE_FUND_REPAIR_OFFLINE_PASS',
 rejectCases:denied,mocksVerified:9,financeWrites:0,realGasCalls:0,
 manualOnly:true,eachFundAtMostOneRefresh:true,noNavReimport:true}));
