#!/usr/bin/env node
// Run the REVIEWED v9.288 migration path in DRAINING-only operator mode
// against the exact 338-row in-memory test fixture. Never contacts GAS.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {TRADE_V2_GAS_MIGRATION_APPLY}
 from './trade-v2-gas-migration-apply-preview.mjs';
import {setup} from './check-gas9288-trade-v2-migration-apply-restore.mjs';

const source=fs.readFileSync('ops/issue734/targeted-timeout-gate-recovery.gs','utf8');
let candidate=TRADE_V2_GAS_MIGRATION_APPLY;
const from=candidate.indexOf('function _tradeV2MigrationManual_(mode) {');
assert(from>=0);
candidate=candidate.slice(from);
const changes=[
 ['function _tradeV2MigrationManual_(mode) {',
  'function _issue734DrainedTradeV2Migration_(mode) {'],
 ["  if (typeof _issue507GateInside_ !== 'undefined' && !_issue507GateInside_)\n    return _issue507GateInvoke_('_tradeV2MigrationManual_', _tradeV2MigrationManual_, this, arguments);\n",''],
 ["if(!gate||gate.mode!=='OPEN'||!gate.active||\n       Object.keys(gate.active).length>1)",
  "if(!gate||gate.mode!=='DRAINING'||!gate.active||\n       Object.keys(gate.active).length!==0)"],
 ["    if(mode==='RESTORE'){",
  "    // Additional operator-only cutover contract; published v9.288\n    // admission remains closed for every other writer.\n    _issue734AssertDrainedAfterRepair_(props);\n    if(mode==='RESTORE'){"]
];
for(const [a,b] of changes){
 assert.equal(candidate.split(a).length-1,1,'exact reviewed source transform: '+a.slice(0,50));
 candidate=candidate.replace(a,b);
}
assert(source.includes(candidate),'operator clone must be exact controlled transform');
assert.equal(source.split('function _issue734DrainedTradeV2Migration_(mode) {').length-1,1);
assert(!source.includes('issue507_writer_end_v1_+token'));
assert(!source.includes('issuedByBackdoor'));
assert(!source.includes('ScriptApp.newTrigger('));

function fixture(options={}){
 const env=setup(),ctx=env.ctx,props=env.props;
 const barrier=Date.now()-540000;
 ctx.ISSUE507_GATE_RELEASE_ID='TEST_RELEASE';
 ctx._issue507GateRead_=p=>JSON.parse(p.getProperty('issue507_writer_gate_v1'));
 ctx._issue507GateAtomic_=fn=>fn(props);
 ctx._issue507GateSave_=(p,g)=>p.setProperty('issue507_writer_gate_v1',JSON.stringify(g));
 ctx.Utilities.DigestAlgorithm={SHA_256:'SHA_256'};
 ctx.Utilities.Charset={UTF_8:'UTF_8'};
 ctx.Utilities.computeDigest=(_kind,raw)=>
  Array.from(createHash('sha256').update(raw).digest())
   .map(n=>n>127?n-256:n);
 let gate={releaseId:'TEST_RELEASE',mode:options.mode||'DRAINING',
  active:{},completed:[],finished:727,barrierAt:barrier};
 if(options.active)gate.active.test={name:'unrelated',startedAt:Date.now()-1000};
 props.setProperty('issue507_writer_gate_v1',JSON.stringify(gate));
 if(options.pause!==false){
  props.setProperty('issue734_writer_pause_before_v1','ORIGINAL_GATE_BACKUP');
  props.setProperty('issue734_writer_pause_audit_v1',JSON.stringify({
   status:'PAUSED',pausedAt:barrier,originalGateDigest:'HASH'}));
 }
 if(options.repair!==false){
  props.setProperty('issue734_writer_gate_before_20261110_v1','DRAINED_GATE_BACKUP');
  props.setProperty('issue734_writer_gate_repair_audit_v1',JSON.stringify({
   status:'PRUNED',recoveredCount:14}));
 }
 vm.runInContext(source,ctx,{timeout:1500});
 return {env,ctx,props,gate};
}
const f=fixture();
let p=f.ctx.issue734DrainedTradeV2Preflight();
assert.equal(p.status,'ok');
assert.equal(p.sourceRows,338);
assert.equal(p.schemaWidth,11);
assert.equal(p.journalStatus,'NONE');
assert.equal(f.env.counts.mutations,0);
assert.equal(f.env.counts.backups,0);
f.env.approve('APPLY',p);
const rejectedByOld=f.ctx.runTradeV2MigrationApply();
assert.equal(rejectedByOld.status,'error');
assert.equal(rejectedByOld.errorCode,'TRADE_V2_MIGRATION_WRITER_NOT_QUIESCENT');
assert.equal(f.env.counts.mutations,0);
const applied=f.ctx.issue734DrainedTradeV2Apply();
assert.equal(applied.status,'ok',JSON.stringify(applied));
assert.equal(applied.state,'APPLIED');
assert.equal(applied.assignedIds,338);
const ids=f.env.original.getRange(2,14,338,1).getValues().map(x=>x[0]);
assert.equal(new Set(ids).size,338);
assert.equal(f.env.counts.backups,1);
assert.equal(f.env.original.getLastColumn(),14);
assert.equal(JSON.parse(f.props.getProperty('issue507_writer_gate_v1')).mode,'DRAINING');
const journal=JSON.parse(f.props.getProperty('trade_v2_migration_journal_v1'));
assert.equal(journal.status,'APPLIED');
assert.deepEqual(f.env.original.getRange(2,1,338,11).getValues(),
 f.env.originals.slice(1));
const resumed=f.ctx.issue734ResumeWritersAfterApplied();
assert.equal(resumed.status,'OPEN');
assert.equal(resumed.tradeRows,338);
assert.equal(JSON.parse(f.props.getProperty('issue507_writer_gate_v1')).mode,'OPEN');
assert.equal(f.props.getProperty('trade_v2_migration_approval_v1'),null);
assert.equal(f.props.getProperty('issue734_stale_gate_recovery_approval_v1'),null);
assert.equal(JSON.parse(f.props.getProperty('issue734_writer_pause_audit_v1')).status,'RESUMED');
assert(f.props.getProperty('issue734_writer_gate_before_20261110_v1'));
assert(f.props.getProperty('issue734_writer_pause_before_v1'));
assert.equal(f.env.counts.backups,1);

let negatives=0;
for(const options of [{mode:'OPEN'},{active:true},{pause:false},{repair:false}]){
 const e=fixture(options);
 assert.throws(()=>e.ctx.issue734DrainedTradeV2Preflight(),
  /ISSUE734_MAINTENANCE_/);
 assert.equal(e.env.counts.mutations,0);
 negatives++;
}
{
 const e=fixture();
 const pre=e.ctx.issue734DrainedTradeV2Preflight();
 const noApproval=e.ctx.issue734DrainedTradeV2Apply();
 assert.equal(noApproval.status,'error');
 assert.equal(noApproval.errorCode,'TRADE_V2_MIGRATION_APPROVAL_REQUIRED');
 assert.equal(e.env.counts.backups,0);
 negatives++;
 e.env.approve('APPLY',pre);
 const approval=JSON.parse(e.props.getProperty('trade_v2_migration_approval_v1'));
 approval.writerIsolationConfirmed=false;
 e.props.setProperty('trade_v2_migration_approval_v1',JSON.stringify(approval));
 assert.equal(e.ctx.issue734DrainedTradeV2Apply().errorCode,
  'TRADE_V2_MIGRATION_APPROVAL_REQUIRED');
 assert.equal(e.env.counts.mutations,0);
 negatives++;
}
{
 const e=fixture();const pre=e.ctx.issue734DrainedTradeV2Preflight();
 e.env.approve('APPLY',pre);
 const apply=e.ctx.issue734DrainedTradeV2Apply();
 assert.equal(apply.status,'ok');
 e.env.original.getRange(2,14,1,1).setValues([['tr_modified_external']]);
 assert.throws(()=>e.ctx.issue734ResumeWritersAfterApplied(),
  /ISSUE734_RESUME_TRADE_ID_DRIFT/);
 assert.equal(JSON.parse(e.props.getProperty('issue507_writer_gate_v1')).mode,'DRAINING');
 negatives++;
}
console.log(JSON.stringify({kind:'ISSUE734_DRAINED_MIGRATION_SOURCE_PASS',
 exactOriginalFinanceMutationContract:true,legacyGateRemainsBlockedDuringMigration:true,
 testedRows:338,backupCount:1,negativeScenarios:negatives,
 scriptPropertyWritesProduction:0,financeWritesProduction:0,deployments:0}));
