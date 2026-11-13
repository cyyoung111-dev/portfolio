import assert from 'node:assert/strict';
import fs from 'node:fs';
import YAML from 'yaml';
import {assertSingleCloseOwnerReadiness,recoverIssue734Once}
 from './issue734-recover-close-owner-once.mjs';
const DATE='2026-11-12';
const proof={status:'VERIFIED',currentGas:'9.293',date:DATE,
 snapshotRows:39,tradeRows:338,writerIdle:true,financeWrites:0,gasDeployments:0};
const base={gasVersion:'9.293',snapshotLastDate:DATE,priceHistoryLastDate:DATE,
 pendingCount:0,triggerReady:true,tradeLedgerWriteUnverified:false,
 close:{runDate:DATE,state:'INCOMPLETE',stage:'PRICE',snapshotStale:false,
 priceOk:true}};
const fund=code=>({code,date:DATE,navState:'EXISTING_CONFIRMED',
 valuationRequired:true,unitsApplied:true,reconciled:true,
 evaluationState:'EXISTING_VALID',snapshotState:'EXISTING_VALID'});
const funds={F00001:[fund('F00001')],F00002:[fund('F00002')]};
assert.equal(assertSingleCloseOwnerReadiness({proof,status:base,funds}).mode,
 'EXACT_OWNER_READ_ONLY_READY');
let rejectCases=0;
for(const invalid of [
 {proof:{...proof,currentGas:'9.294'}},
 {proof:{...proof,writerIdle:false}},
 {proof:{...proof,snapshotRows:38}},
 {proof:{...proof,tradeRows:337}},
 {status:{...base,gasVersion:'9.294'}},
 {status:{...base,pendingCount:1}},
 {status:{...base,close:{...base.close,runDate:'2026-11-13'}}},
 {status:{...base,close:{...base.close,state:'COMPLETE'}}},
 {status:{...base,close:{...base.close,stage:'FUND'}}},
 {status:{...base,close:{...base.close,snapshotStale:true}}},
 {funds:{...funds,F00001:[{...fund('F00001'),navState:'NAV_MISSING'}]}},
 {funds:{...funds,F00002:[{...fund('F00002'),evaluationState:'WRITE_REQUIRED'}]}},
 {funds:{...funds,F00002:[{...fund('F00002'),unitsApplied:false}]}},
 {funds:{...funds,F00001:[]}},
 {funds:{...funds,F00001:[fund('F00001'),fund('F00001')]}}
]){
 assert.throws(()=>assertSingleCloseOwnerReadiness({
   proof:invalid.proof??proof,status:invalid.status??base,
   funds:invalid.funds??funds
 }),/ISSUE734_ONCE_/);
 rejectCases++;
}
const url='https://script.google.com/macros/s/TEST_DEPLOYMENT_ID_1234567/exec';
const token='TEST_PRIVATE_TOKEN_987654321';
function mock({confirm='APPLY',changedOwner=false,lostApplyAck=false,
 missingNav=false,previewBlocked=false}={}){
 const calls=[],states=[];
 let statusReads=0;
 const statusAfter={...base,close:{...base.close,state:'ERROR',stage:'ERROR',priceOk:true}};
 const readStatus=async()=>{
  statusReads++;
  const s=changedOwner&&statusReads===2
    ?{...base,close:{...base.close,runDate:'2026-11-13'}}
    :statusReads===3?statusAfter:base;
  states.push(s.close?.stage);return s;
 };
 const post=async({action,args})=>{
  calls.push({action,apply:args?.apply??null,phase:args?.phase??null});
  if(action==='getFundValuationStatus'){
   const code=args.code, row=missingNav&&code==='F00002'
     ?{...fund(code),navState:'NAV_MISSING'}:fund(code);
   return {status:'ok',fundResults:{[code]:{code,dates:[row]}}};
  }
  if(args.apply==='0')return previewBlocked
    ?{status:'error',message:'not allowed'}
    :{status:'ok',date:DATE,complete:false};
  if(args.apply==='1'){
    if(lostApplyAck)throw Error('ISSUE734_ONCE_APPLY_ACK_UNCERTAIN_DO_NOT_RETRY');
    return {status:'ok',date:DATE,scheduled:true};
  }
  throw Error('UNEXPECTED_SIDE_EFFECT');
 };
 return {args:{url,token,confirm,verify:async()=>proof,readStatus,post},
  calls,states,getStatusReads:()=>statusReads};
}
const good=mock();
const result=await recoverIssue734Once(good.args);
assert.equal(result.kind,'ISSUE734_OWNER_REPAIR_ONCE_ACK');
assert.equal(result.closeComplete,false);
assert.equal(result.navCompletionRequiresIndependentReceipt,true);
assert.equal(result.autoApplyRetries,0);
assert.equal(good.calls.filter(c=>c.apply==='1').length,1);
assert.deepEqual(good.calls.map(c=>c.action),
 ['getFundValuationStatus','getFundValuationStatus',
  'resumeIncompletePortfolioClose','resumeIncompletePortfolioClose']);
assert.equal(good.getStatusReads(),3);
const unapproved=mock({confirm:''});
await assert.rejects(()=>recoverIssue734Once(unapproved.args),
 /ISSUE734_ONCE_EXPLICIT_MANUAL_APPROVAL_REQUIRED/);
assert.equal(unapproved.calls.length,0);
for(const which of [
 {missingNav:true},{changedOwner:true},{previewBlocked:true},
 {lostApplyAck:true}
]){
 const t=mock(which);
 await assert.rejects(()=>recoverIssue734Once(t.args),/ISSUE734_ONCE_|UNVERIFIED/);
 assert(t.calls.filter(c=>c.apply==='1').length<=1);
 if(!which.lostApplyAck)assert.equal(t.calls.filter(c=>c.apply==='1').length,0);
}
const flow=YAML.parse(fs.readFileSync('.github/workflows/issue-507-fund-close-resume.yml','utf8'));
const env=flow.jobs.resume.steps.find(s=>String(s.run||'').includes('run-incomplete-close-resume.mjs')).env;
assert.match(env.ISSUE734_CONFIRM_RECOVERY,/inputs\.diagnose_only == false/);
assert.match(env.ISSUE734_CONFIRM_RECOVERY,/inputs\.confirm_recovery == 'APPLY'/);
const inputs=(flow.on??flow.true).workflow_dispatch.inputs;
assert.equal(inputs.diagnose_only.default,true);
assert.equal(inputs.confirm_recovery.default,'');
assert.equal(flow.jobs.resume.environment,'portfolio-production-gas');
const runner=fs.readFileSync('scripts/run-incomplete-close-resume.mjs','utf8');
assert.match(runner,/RESUME_\|AUTOMATION_DIAG_\|ISSUE734_ONCE_/,
 'CLI must report exact one-shot recovery fail-closed reasons');
console.log(JSON.stringify({kind:'ISSUE734_ONCE_CLOSE_OWNER_RECOVERY_OFFLINE_PASS',
 rejectCases,appliesInSuccess:1,appliesInFailureAtMost:1,
 manualApprovalOnly:true,navIndependent:true,
 completeAlwaysRequiresReceipt:true,liveFinancialWrites:0,gasDeployments:0}));
