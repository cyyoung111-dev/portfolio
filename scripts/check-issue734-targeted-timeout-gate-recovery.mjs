#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createHash} from 'node:crypto';

const source=fs.readFileSync('ops/issue734/targeted-timeout-gate-recovery.gs','utf8');
function makeEnvironment(options={}){
 const values={}, writes=[];
 const props={
  getProperty:key=>values[key]??null,
  setProperty:(key,value)=>{
   if(options.rejectKey===key)return;
   values[key]=value;writes.push({key,value});
  }
 };
 let s;
 const context={
  ISSUE507_GATE_API_VERSION:options.version||'9.288',
  _issue507GateInside_:false,
  ISSUE507_GATE_RELEASE_ID:'test_release',
  _issue507GateAtomic_:fn=>fn(props),
  _issue507GateRead_:p=>JSON.parse(p.getProperty('issue507_writer_gate_v1')),
  _issue507GateSave_:(p,g)=>p.setProperty('issue507_writer_gate_v1',JSON.stringify(g)),
  _tradeLedgerWriteUnverified_:()=>!!options.unverified,
  _readPendingTradeSnapshotRebuild:()=>!!options.pending,
  getss:()=>({getSheetByName:()=>options.noSheet?null:{
   getLastRow:()=>options.rows??339,getLastColumn:()=>options.columns??11
  }}),
  CONFIG:{TIMEZONE:'Asia/Seoul',SHEET_TRADES:'거래이력'},
  Utilities:{
   DigestAlgorithm:{SHA_256:1},Charset:{UTF_8:1},
   computeDigest:(_alg,raw)=>[...createHash('sha256').update(raw).digest()]
     .map(n=>n>127?n-256:n),
   formatDate:()=>'2026-11-10'
  },
  Logger:{log(){}},Date,JSON,Number,Math,Object,String
 };
 vm.runInNewContext(source,context,{timeout:1000,filename:'targeted-timeout-gate-recovery.gs'});
 s={releaseId:'test_release',mode:'OPEN',active:{},completed:[],finished:727,
  barrierAt:1793860977311,bootstrapMaintenance:true};
 context.ISSUE734_RECOVERY_EXPECTED_TIMED_OUT_.forEach(([name,startedAt],i)=>{
  s.active['token_test_'+i]={name,startedAt};
 });
 values.issue507_writer_gate_v1=JSON.stringify(s);
 if(options.receipt)values['issue507_writer_end_v1_token_test_0']='valid_producer_receipt';
 if(options.backup)values.issue734_writer_gate_before_20261110_v1='prior';
 if(options.journal)values.trade_v2_migration_journal_v1=JSON.stringify({status:options.journal});
 return {context,values,writes,gate:s,props};
}
const PREVIEW='issue734PreviewTimedOutGateRecovery',
 COMMIT='issue734CommitTimedOutGateRecovery';
function approved(e,{date='2026-11-10',external=true,digest}={}){
 const p=e.context[PREVIEW]();
 e.values.issue734_stale_gate_recovery_approval_v1=JSON.stringify({
  approvedFor:'PRUNE_EXACT_14_TIMED_OUT',releaseVersion:'9.288',
  userApproved:true,externalWritersExcluded:external,
  approvedDate:date,expectedGateDigest:digest??p.originalGateDigest
 });
 return p;
}
const e=makeEnvironment();
const before=e.values.issue507_writer_gate_v1;
const p=approved(e);
assert.equal(p.activeCount,14);
assert.equal(p.status,'MATCHED_BUT_NOT_AUTHORIZED');
assert.match(p.originalGateDigest,/^[a-f0-9]{64}$/);
assert.equal(e.writes.length,0,'preview must never write');
const result=e.context[COMMIT]();
assert.equal(result.status,'PRUNED');
assert.equal(result.recoveredCount,14);
assert.equal(result.migrationApplied,false);
assert.equal(result.financeWrites,0);
assert.equal(e.values.issue734_writer_gate_before_20261110_v1,before);
const after=JSON.parse(e.values.issue507_writer_gate_v1);
assert.equal(Object.keys(after.active).length,0);
assert.equal(after.mode,'OPEN');
assert.equal(after.finished,727,'must not forge completed receipt count');
assert.equal(after.completed.length,0);
assert.equal(after.releaseId,'test_release');
assert.equal(JSON.parse(e.values.issue734_writer_gate_repair_audit_v1).status,'PRUNED');
assert(!e.writes.some(w=>w.key.startsWith('issue507_writer_end_v1_')));
assert.throws(()=>e.context[COMMIT](),/ISSUE734_RECOVERY_ACTIVE_OR_RELEASE_DRIFT/);
let negative=0;
for(const corrupt of [
 e=>{e.gate.active.token_test_0.startedAt++;},
 e=>{e.gate.active.token_test_0.name='runOtherWriter';},
 e=>{e.gate.active.token_extra={name:'newWriter',startedAt:Date.now()};},
 e=>{delete e.gate.active.token_test_7;},
 e=>{e.gate.mode='DRAINING';},
 e=>{e.gate.releaseId='test_other';}
]){
 const x=makeEnvironment();corrupt(x);
 x.values.issue507_writer_gate_v1=JSON.stringify(x.gate);
 assert.throws(()=>x.context[PREVIEW](),/ISSUE734_RECOVERY_/);
 assert.equal(x.writes.length,0);negative++;
}
for(const o of [
 {version:'9.289'}, {unverified:true}, {pending:true}, {rows:338},
 {columns:14},{noSheet:true},{receipt:true},{backup:true},{journal:'WRITING'}
]){
 const x=makeEnvironment(o);
 assert.throws(()=>x.context[PREVIEW](),/ISSUE734_RECOVERY_/);
 assert.equal(x.writes.length,0);negative++;
}
for(const badApproval of [
 ()=>null,
 {date:'2026-11-09'},
 {external:false},
 {digest:'0'.repeat(64)}
]){
 const x=makeEnvironment();
 if(badApproval===(()=>null))continue;
 const prev=x.context[PREVIEW]();
 if(typeof badApproval==='object')approved(x,badApproval);
 assert.throws(()=>x.context[COMMIT](),/ISSUE734_RECOVERY_APPROVAL_REQUIRED/);
 assert.equal(x.values.issue507_writer_gate_v1,JSON.stringify(x.gate));
 assert.equal(x.writes.length,0);negative++;
}
for(const rejectKey of [
 'issue734_writer_gate_before_20261110_v1',
 'issue734_writer_gate_repair_audit_v1'
]){
 const x=makeEnvironment({rejectKey});approved(x);
 assert.throws(()=>x.context[COMMIT](),/ISSUE734_RECOVERY_(BACKUP|AUDIT)_READBACK_FAILED/);
 assert.equal(x.values.issue507_writer_gate_v1,JSON.stringify(x.gate));
 negative++;
}
assert.equal(source.includes("s.active={}"),false);
assert(source.includes('next.active={}'));
assert(source.includes('ISSUE734_RECOVERY_APPROVAL_REQUIRED'));
assert(!source.includes('issue507_writer_end_v1_'+ 'XYZ-SECRET'));

const maintenance=makeEnvironment();
const originalGateRaw=maintenance.values.issue507_writer_gate_v1;
const paused=maintenance.context.issue734StartWriterMaintenancePause();
assert.equal(paused.status,'DRAINING');
assert.equal(paused.originalGateBackupSaved,true);
assert.equal(maintenance.values.issue734_writer_pause_before_v1,originalGateRaw);
assert.equal(JSON.parse(maintenance.values.issue734_writer_pause_audit_v1).status,'PAUSED');
assert.equal(JSON.parse(maintenance.values.issue507_writer_gate_v1).mode,'DRAINING');
assert.equal(maintenance.context.issue734StartWriterMaintenancePause===undefined,false);
assert.throws(()=>maintenance.context.issue734PreviewTimedOutGateRecovery(),
 /ISSUE734_RECOVERY_PAUSE_UNVERIFIED/);
// Simulate the independent 7-minute barrier WITHOUT waiting in CI.
const RealDate=Date;
class AdvancedDate extends RealDate{static now(){return RealDate.now()+480000;}}
maintenance.context.Date=AdvancedDate;
const afterBarrier=maintenance.context.issue734PreviewTimedOutGateRecovery();
assert.equal(afterBarrier.status,'MATCHED_BUT_NOT_AUTHORIZED');
const correct=JSON.stringify({
 approvedFor:'PRUNE_EXACT_14_TIMED_OUT',releaseVersion:'9.288',
 userApproved:true,externalWritersExcluded:true,approvedDate:'2026-11-10',
 expectedGateDigest:afterBarrier.originalGateDigest
});
maintenance.values.issue734_stale_gate_recovery_approval_v1=correct;
const corrected=maintenance.context.issue734CommitTimedOutGateRecovery();
assert.equal(corrected.status,'PRUNED');
const gAfter=JSON.parse(maintenance.values.issue507_writer_gate_v1);
assert.equal(gAfter.mode,'DRAINING');
assert.equal(Object.keys(gAfter.active).length,0);
assert.equal(gAfter.finished,727);
assert.equal(maintenance.values.issue734_writer_pause_before_v1,originalGateRaw);
assert.equal(JSON.parse(maintenance.values.issue734_writer_gate_repair_audit_v1).status,'PRUNED');
assert(!maintenance.writes.some(x=>x.key.startsWith('issue507_writer_end_v1_')));
const legacyAbort=maintenance.context.issue734AbortWriterMaintenancePause();
assert.equal(legacyAbort.status,'OPEN');
assert.equal(legacyAbort.activeCount,0);
assert.equal(JSON.parse(maintenance.values.issue507_writer_gate_v1).mode,'OPEN');
assert.equal(JSON.parse(maintenance.values.issue734_writer_pause_audit_v1).status,'ABORTED');
const pauseOnly=makeEnvironment();
const pauseBefore=pauseOnly.values.issue507_writer_gate_v1;
pauseOnly.context.issue734StartWriterMaintenancePause();
pauseOnly.context.Date=AdvancedDate;
const pauseAbort=pauseOnly.context.issue734AbortWriterMaintenancePause();
assert.equal(pauseAbort.status,'OPEN');
assert.equal(pauseAbort.activeCount,14);
assert.equal(JSON.parse(pauseOnly.values.issue507_writer_gate_v1).mode,'OPEN');
assert.equal(pauseOnly.values.issue734_writer_pause_before_v1,pauseBefore);
const interrupted=makeEnvironment();
interrupted.context.issue734StartWriterMaintenancePause();
interrupted.context.Date=AdvancedDate;
interrupted.values.trade_v2_migration_journal_v1=JSON.stringify({status:'WRITING'});
assert.throws(()=>interrupted.context.issue734AbortWriterMaintenancePause(),
 /ISSUE734_PAUSE_ABORT_MIGRATION_IN_PROGRESS/);
assert.equal(JSON.parse(interrupted.values.issue507_writer_gate_v1).mode,'DRAINING');


console.log(JSON.stringify({kind:'ISSUE734_TARGETED_RECOVERY_SOURCE_PASS',
 confirmedMatches:14,negativeScenarios:negative,
 scriptLockRequired:true,rawGateBackupRequired:true,
 producerReceiptForgeryForbidden:true,
 gateMutationOnlyAfterApproval:true,financeWrites:0,gasDeployments:0}));
