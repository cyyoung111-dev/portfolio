#!/usr/bin/env node
// Offline source-only negative/positive tests. NO real GAS/Sheets/network access.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

const source=fs.readFileSync('ops/issue860/recover-exact-two-timeouts-v9289.gs','utf8');
const NOW=Date.parse('2026-11-11T00:55:00Z');
const tokens=['fictional-token-001','fictional-token-002'];
const expected=[
 ['runDailyPortfolioClose1900',1794306792206],
 ['runPortfolioCloseWatchdog2030',1794310621147]
];
function scenario(options={}){
 const writers=Object.fromEntries(expected.map(([name,startedAt],i)=>[
  tokens[i],{name,startedAt}
 ]));
 if(options.mutation)options.mutation(writers);
 const original={releaseId:'release_test',mode:options.mode||'OPEN',active:writers,
  completed:[{token:'done',state:'ENDED'}],finished:931,barrierAt:1794294530362};
 const state={'issue507_writer_gate_v1':JSON.stringify(original)};
 if(options.receipt)state['issue507_writer_end_v1_'+tokens[0]]='different';
 if(options.existingBackup)state.issue860_20261110_exact_gate_backup_v1='previous';
 const writes=[];
 const props={
  getProperty:k=>state[k]??null,
  setProperty:(k,v)=>{writes.push(k);if(options.denyWrite!==k)state[k]=v;},
 };
 const OldDate=Date;
 class FakeDate extends OldDate{constructor(...args){super(...(args.length?args:[NOW]));}static now(){return NOW;}}
 const context={
  ISSUE507_GATE_API_VERSION:options.version||'9.289',
  ISSUE507_GATE_RELEASE_ID:options.release||'release_test',
  _issue507GateAtomic_:fn=>fn(props),
  _issue507GateRead_:p=>JSON.parse(p.getProperty('issue507_writer_gate_v1')),
  _tradeLedgerWriteUnverified_:()=>!!options.unverified,
  _readPendingTradeSnapshotRebuild:()=>!!options.pending,
  Utilities:{
   DigestAlgorithm:{SHA_256:'SHA_256'},Charset:{UTF_8:'UTF_8'},
   computeDigest:(_,v)=>[...createHash('sha256').update(v).digest()].map(x=>x>127?x-256:x),
   formatDate:()=> '2026-11-11'
  },Date:FakeDate,Logger:{log(){}},JSON,Math,Object,Number
 };
 vm.runInNewContext(source,context,{timeout:750});
 const preview=()=>JSON.parse(JSON.stringify(context.issue860PreviewExactTwoTimeoutRecovery()));
 const commit=()=>JSON.parse(JSON.stringify(context.issue860CommitExactTwoTimeoutRecovery()));
 const approve=(digest,{external=true,date='2026-11-11'}={})=>{
  state.issue860_20261110_exact_gate_approval_v1=JSON.stringify({
   userApproved:true,externalWritersExcluded:external,
   approvedDateKst:date,expectedGateDigest:digest});
 };
 return {state,writes,context,original,preview,commit,approve};
}
const ok=scenario(),original=ok.state.issue507_writer_gate_v1;
const preview=ok.preview();
assert.equal(preview.recordedActive,2);
assert.equal(preview.status,'MATCHED_NOT_AUTHORIZED');
assert.equal(preview.financeWrites,0);
assert.equal(ok.writes.length,0);
assert.match(preview.originalGateDigest,/^[a-f0-9]{64}$/);
assert(!JSON.stringify(preview).includes(tokens[0]));
assert.throws(()=>ok.commit(),/ISSUE860_EXACT_APPROVAL_REQUIRED/);
assert.equal(ok.state.issue507_writer_gate_v1,original);
ok.approve(preview.originalGateDigest);
const result=ok.commit();
assert.equal(result.recoveredCount,2);
assert.equal(result.closeMarkedComplete,false);
assert.equal(result.producerEndReceiptsForged,0);
assert.equal(ok.state.issue860_20261110_exact_gate_backup_v1,original);
const next=JSON.parse(ok.state.issue507_writer_gate_v1);
assert.equal(Object.keys(next.active).length,0);
assert.equal(next.finished,931);
assert.equal(next.completed.length,1);
assert.equal(JSON.parse(ok.state.issue860_20261110_exact_gate_audit_v1).state,
 'PRUNED_TIMED_OUT_NOT_COMPLETED');
assert(!ok.writes.some(k=>k.startsWith('issue507_writer_end_v1_')));
assert.throws(()=>ok.commit(),/ISSUE860_EXACT_GATE_DRIFT/);

const negatives=[
 {version:'9.288',error:/ISSUE860_EXACT_VERSION/},
 {version:'9.290',error:/ISSUE860_EXACT_VERSION/},
 {mode:'DRAINING',error:/ISSUE860_EXACT_GATE_DRIFT/},
 {release:'different',error:/ISSUE860_EXACT_GATE_DRIFT/},
 {receipt:true,error:/ISSUE860_EXACT_PRODUCER_RECEIPT_PRESENT/},
 {existingBackup:true,error:/ISSUE860_EXACT_PREVIOUS_ATTEMPT_EXISTS/},
 {pending:true,error:/ISSUE860_EXACT_PENDING_TRADE_WRITER/},
 {unverified:true,error:/ISSUE860_EXACT_PENDING_TRADE_WRITER/},
 {mutation:gate=>{gate.extra={name:'runPendingTradeSnapshotRebuild',startedAt:NOW};},
  error:/ISSUE860_EXACT_GATE_DRIFT/},
 {mutation:gate=>{gate[tokens[0]].startedAt+=1;},
  error:/ISSUE860_EXACT_EXECUTION_SET_DRIFT/},
 {mutation:gate=>{gate[tokens[0]].name='another';},
  error:/ISSUE860_EXACT_EXECUTION_SET_DRIFT/}
];
for(const args of negatives){
 const x=scenario(args);
 assert.throws(()=>x.preview(),args.error);
 assert.equal(x.writes.length,0);
}
for(const rejectKey of ['issue860_20261110_exact_gate_backup_v1',
 'issue860_20261110_exact_gate_audit_v1']){
 const x=scenario({denyWrite:rejectKey}),pre=x.preview();x.approve(pre.originalGateDigest);
 assert.throws(()=>x.commit(),/ISSUE860_EXACT_(BACKUP|AUDIT)_READBACK/);
 assert.equal(Object.keys(JSON.parse(x.state.issue507_writer_gate_v1).active).length,2);
}
for(const args of [
 {external:false},{date:'2026-11-10'}
]){
 const x=scenario(),pre=x.preview();x.approve(pre.originalGateDigest,args);
 assert.throws(()=>x.commit(),/ISSUE860_EXACT_APPROVAL_REQUIRED/);
 assert.equal(x.writes.length,0);
}
const drift=scenario();const first=drift.preview();drift.approve(first.originalGateDigest);
drift.state.issue507_writer_gate_v1=drift.state.issue507_writer_gate_v1.replace(
 '"finished":931','"finished":932');
assert.throws(()=>drift.commit(),/ISSUE860_EXACT_APPROVAL_REQUIRED/);
assert.equal(drift.writes.length,0);
assert(!source.includes('ScriptApp.'));
assert(!source.includes('SpreadsheetApp.'));
assert(!source.includes('doPost('));
console.log(JSON.stringify({kind:'ISSUE860_EXACT_TWO_RECOVERY_OFFLINE_PASS',
 verifiedOriginalStartTimes:true,scenarioCount:1+negatives.length+2+2+1,
 exactMatchAndHash:true,backupBeforePrune:true,
 operatorApprovalRequired:true,financialWrites:0,
 realGASMutations:0,realGASRequests:0}));
