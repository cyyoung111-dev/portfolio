#!/usr/bin/env node
// Source-only verification: guided operator flow, no live financial writes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const src=fs.readFileSync('ops/issue860/owner-one-click-exact-two-timeouts-v9289.gs','utf8');
new vm.Script(src);
const digest='a'.repeat(64);
function run(opts={}){
 const values={...opts.values},writes=[],log=[];
 const props={
  getProperty:k=>values[k]??null,
  setProperty:(k,v)=>{writes.push(k);if(opts.denyWrite!==true)values[k]=v;}
 };
 const p={status:'MATCHED_NOT_AUTHORIZED',gasVersion:'9.289',recordedActive:2,
  exactFunctionAndTimeMatched:true,producerReceiptsPresent:false,
  financeWrites:0,scriptPropertyWrites:0,originalGateDigest:digest,
  ...opts.preview};
 const commit=()=>{if(opts.throwCommit)throw Error('ISSUE860_EXACT_GATE_DRIFT');
   if(!opts.silentCommit)log.push('COMMIT_CALLED');
   return opts.commitResponse??{status:'PRUNED_TIMED_OUT_NOT_COMPLETED',
      recoveredCount:2,backupRetained:true,closeMarkedComplete:false,
      recordedActiveImmediatelyAfterPrune:0};
 };
 let count=0;
 const ctx={
   issue860PreviewExactTwoTimeoutRecovery:()=>{count++;return p;},
   issue860CommitExactTwoTimeoutRecovery:()=>{count++;return commit();},
   PropertiesService:{getScriptProperties:()=>props},
   Utilities:{formatDate:()=>opts.date||'2026-11-11'},
   Logger:{log:x=>log.push(x)},Date,JSON
 };
 if(opts.omitPreview)delete ctx.issue860PreviewExactTwoTimeoutRecovery;
 vm.runInNewContext(src,ctx,{timeout:1000});
 let result,error;
 try{result=JSON.parse(JSON.stringify(ctx.issue860OwnerConfirmsNoExternalWriterAndRecover()));}
 catch(e){error=String(e.message);}
 return {result,error,values,writes,log,count};
}
const ok=run();
assert.equal(ok.error,undefined);
assert.equal(ok.result.status,'PRUNED_TIMED_OUT_NOT_COMPLETED');
assert.equal(ok.result.recoveredCount,2);
assert.equal(ok.result.closeMarkedComplete,false);
assert.equal(ok.writes.length,1);
assert.equal(ok.count,2);
const approval=JSON.parse(ok.values.issue860_20261110_exact_gate_approval_v1);
assert.deepEqual(approval,{userApproved:true,externalWritersExcluded:true,
 approvedDateKst:'2026-11-11',expectedGateDigest:digest});
assert(!JSON.stringify(ok.log).includes('expectedGateDigest'));
assert(!JSON.stringify(ok.log).includes(digest));
for(const args of [
 {omitPreview:true},
 {preview:{status:'OTHER'}},
 {preview:{gasVersion:'9.290'}},
 {preview:{recordedActive:3}},
 {preview:{originalGateDigest:'wrong'}},
 {preview:{producerReceiptsPresent:true}},
 {preview:{financeWrites:1}},
 {preview:{scriptPropertyWrites:1}},
 {values:{issue860_20261110_exact_gate_approval_v1:'existing'}},
]){
 const x=run(args);
 assert.match(x.error||'',/^ISSUE860_GUIDED_RECOVERY_/);
 assert.equal(x.writes.length,0);
 assert(!x.log.includes('COMMIT_CALLED'));
}
const failedApproval=run({denyWrite:true});
assert.match(failedApproval.error,/APPROVAL_READBACK_FAILED/);
assert.equal(failedApproval.count,1);
const gateDrift=run({throwCommit:true});
assert.equal(gateDrift.error,'ISSUE860_EXACT_GATE_DRIFT');
assert.equal(gateDrift.values.issue860_20261110_exact_gate_approval_v1!==undefined,true);
assert.equal(gateDrift.count,2);
assert(!gateDrift.log.includes('COMMIT_CALLED'));
const invalidCommit=run({commitResponse:{status:'PREPARED'}});
assert.match(invalidCommit.error,/POSTVERIFY_FAILED/);
assert(!src.includes('issue507_writer_gate_v1')); // core Gate write belongs only to exact recovery
assert(!src.includes('SpreadsheetApp.'));
assert(!src.includes('ScriptApp.'));
console.log(JSON.stringify({kind:'ISSUE860_GUIDED_ONE_CLICK_SOURCE_ONLY_PASS',
 scenarios:13,approvesExactLiveDigest:true,
 refusingExtraActive:true,refusingPriorApproval:true,
 reliesOnGuardedBackupCommit:true,realPropertyWrites:0,
 liveFinancialWrites:0,liveGasDeployments:0}));
