import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {inspectOct30RepairAdmission,simulateOct30PlannedRecovery,DAY,GAS_BLOB}
  from './issue507-oct30-repair-admission-audit.mjs';

// Verify the immutable real production gate, not an invented gate behavior.
const bytes=fs.readFileSync('src/gas/apps_script.gs');
const sha=createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
assert.equal(sha,GAS_BLOB);
const gas=bytes.toString('utf8');
function getActualFunction(name){
 const start=gas.indexOf('function '+name+'(');
 assert.ok(start>=0,'missing production function '+name);
 const end=gas.indexOf('\n}',start);
 assert.ok(end>start);
 return gas.slice(start,end+2);
}
const enter=getActualFunction('_issue507GateEnter_');
const drain=getActualFunction('_issue507AssertDrain_');
const backup=getActualFunction('_backupSheetBeforeWrite');
const writer=getActualFunction('batchUpsertPriceHistory');
const snap=getActualFunction('_writeSnapshotDateScoped_');
assert.match(enter,/s\.mode!=='OPEN'/);
assert.match(drain,/Date\.now\(\)-s\.barrierAt<420000/);
assert.match(drain,/writeAuthorized:false/);
assert.match(backup,/_sheetContentSignature\(sheet\)/);
assert.match(backup,/sourceSignature/);
assert.match(writer,/PRICE_HISTORY_BATCH_COMMIT_TARGET_CHANGED/);
assert.match(snap,/Snapshot 대상일 외부 변경/);
const data={mode:'DRAINING',releaseId:'GATE-9.281',
 active:{},barrierAt:100000,finished:500};
const now=520000,verifiedAt=90000;
function invoke(name,s,{clock=now,rolloutAt=verifiedAt}={}){
 const props={getProperty:k=>k==='issue507_writer_gate_v1'?'present':null};
 const context={
  Date:{now:()=>clock},
  Utilities:{getUuid:()=> 'SYNTHETIC-TOKEN'},
  _issue507GateAtomic_:cb=>cb(props),
  _issue507GateReconcile_:(p,state)=>state,
  _issue507GateRead_:()=>structuredClone(s),
  _issue507GateRollout_:()=>({verifiedAt:rolloutAt}),
  _issue507GateSave_:()=>{},
 };
 return vm.runInNewContext(enter+'\n'+drain+'\n'+name+'()',context,
  {timeout:2000});
}
const verifiedDrain=invoke('_issue507AssertDrain_',data);
assert.equal(verifiedDrain.releaseId,'GATE-9.281');
assert.equal(verifiedDrain.proof,'ADMISSION_BARRIER_AND_COMPLETION_RECEIPTS');
assert.equal(verifiedDrain.activeCount,0);
assert.equal(verifiedDrain.writeAuthorized,false,
 'drain is not permission to edit financial data');
assert.throws(()=>invoke('_issue507GateEnter_',data),/GATE_MAINTENANCE/,
 'drained gate must block ordinary 555 writers');
const normal=invoke('_issue507GateEnter_',{...data,mode:'OPEN'});
assert.equal(normal,'SYNTHETIC-TOKEN');
let realDenials=0;
function expectDrainDenied(state,options={}){
 assert.throws(()=>invoke('_issue507AssertDrain_',state,options),/GATE_NOT_DRAINED/);
 realDenials++;
}
expectDrainDenied({...data,mode:'OPEN'});
expectDrainDenied({...data,mode:'DRAINING',active:{one:{name:'manual',startedAt:40000}}});
expectDrainDenied({...data,mode:'DRAINING',barrierAt:110000});
expectDrainDenied(data,{clock:519999});
expectDrainDenied(data,{rolloutAt:100001});

const signature='a'.repeat(64),signatureB='b'.repeat(64);
const op='issue507-oct30-simulated-0001',releaseId='GATE-9.281';
const receipt=sheet=>({
 sheet,operationId:op,systemGenerated:true,status:'CREATED',
 sourceSignature:signature,backupSignature:signatureB,
 backupCopyDigestMatchesSource:true,backupReadbackVerified:true,
 sourceUnchangedSinceBackup:true,backupRestorationProcedureRehearsed:true
});
const valid={
 source:{date:DAY,snapshotRows:39,domesticCarried:37,
  domesticHistoryRows:0,fundNavRows:2,fundHistoryRows:2,
  officialExactCount:37,individualPricesVerifiedInsideProtectedProcess:true,
  priceValuesDisclosed:false,dateCodeSourceOneToOne:true},
 provenance:{frozenGasBlob:GAS_BLOB,gasVersion:'9.281',
  scriptTimezone:'Asia/Seoul',sheetTimezoneVerified:true,sourceSameWithinRun:true},
 operator:{operationId:op,financialWriteApprovalDocumented:true,
  authorizedScope:'2026-10-30-domestic-37-only',
  independentApprovalFresh:true,expectedGateReleaseId:releaseId,
  independentScopedGateBypassReviewed:true,legacy555WriterFenceVerified:true},
 gate:{mode:'DRAINING',activeCount:0,barrierAt:100000,
  rolloutVerifiedAt:90000,observedAt:520000,
  legacyTerminalRunsIndependentlyVerified:true,releaseId},
 lock:{scriptLockHeld:true,ownerOperationId:op,
  externalSheetsApiWritersExcluded:true,noCompetingManualWriter:true},
 backups:[receipt('가격이력'),receipt('스냅샷')]
};
const perfect=inspectOct30RepairAdmission(structuredClone(valid));
assert.equal(perfect.status,'CHECKLIST_COMPLETE_NOT_EXECUTABLE');
assert.deepEqual(perfect.blockers,[]);
assert.equal(perfect.checksPassed,7);
assert.equal(perfect.writeAuthorized,false);
assert.equal(perfect.deployAuthorized,false);
assert.equal(perfect.existingProductionGateAllowsDrainedRepair,false);
assert.equal(perfect.sourceOnlyEvidenceCanAuthorizeFinancialWrite,false);
assert.ok(!JSON.stringify(perfect).includes(op));
assert.ok(!JSON.stringify(perfect).includes(signature));
let rejected=0;
function notReady(change,blocked){
 const a=structuredClone(valid);change(a);
 const r=inspectOct30RepairAdmission(a);
 assert.equal(r.status,'BLOCKED');
 assert.ok(r.blockers.includes(blocked),blocked+' absent');
 assert.equal(r.writeAuthorized,false);
 rejected++;
}
notReady(x=>x.source.officialExactCount=36,
 'PRIVATE_OFFICIAL_SOURCE_OR_ORIGINAL_SCOPE_MISSING');
notReady(x=>x.source.priceValuesDisclosed=true,
 'PRIVATE_OFFICIAL_SOURCE_OR_ORIGINAL_SCOPE_MISSING');
notReady(x=>x.source.dateCodeSourceOneToOne=false,
 'PRIVATE_OFFICIAL_SOURCE_OR_ORIGINAL_SCOPE_MISSING');
notReady(x=>x.provenance.frozenGasBlob='0'.repeat(40),
 'SOURCE_PROVENANCE_UNVERIFIED');
notReady(x=>x.provenance.sheetTimezoneVerified=false,
 'SOURCE_PROVENANCE_UNVERIFIED');
notReady(x=>x.operator.financialWriteApprovalDocumented=false,
 'EXPLICIT_WRITE_APPROVAL_MISSING');
notReady(x=>x.operator.independentApprovalFresh=false,
 'EXPLICIT_WRITE_APPROVAL_MISSING');
notReady(x=>x.operator.authorizedScope='all-history',
 'EXPLICIT_WRITE_APPROVAL_MISSING');
notReady(x=>x.gate.mode='OPEN','GLOBAL_WRITER_DRAIN_NOT_PROVEN');
notReady(x=>x.gate.activeCount=1,'GLOBAL_WRITER_DRAIN_NOT_PROVEN');
notReady(x=>x.gate.observedAt=519999,'GLOBAL_WRITER_DRAIN_NOT_PROVEN');
notReady(x=>x.gate.rolloutVerifiedAt=100001,'GLOBAL_WRITER_DRAIN_NOT_PROVEN');
notReady(x=>x.gate.legacyTerminalRunsIndependentlyVerified=false,
 'GLOBAL_WRITER_DRAIN_NOT_PROVEN');
notReady(x=>x.gate.releaseId='DIFFERENT','GLOBAL_WRITER_DRAIN_NOT_PROVEN');
notReady(x=>x.lock.scriptLockHeld=false,'EXCLUSIVE_WRITER_OWNERSHIP_NOT_PROVEN');
notReady(x=>x.lock.externalSheetsApiWritersExcluded=false,
 'EXCLUSIVE_WRITER_OWNERSHIP_NOT_PROVEN');
notReady(x=>x.backups.pop(),'BOTH_SHEETS_VERIFIED_BACKUPS_MISSING');
notReady(x=>x.backups[0].sheet='스냅샷',
 'BOTH_SHEETS_VERIFIED_BACKUPS_MISSING');
notReady(x=>x.backups[0].operationId='OTHER',
 'BOTH_SHEETS_VERIFIED_BACKUPS_MISSING');
notReady(x=>x.backups[0].sourceSignature='bad',
 'BOTH_SHEETS_VERIFIED_BACKUPS_MISSING');
notReady(x=>x.backups[0].backupReadbackVerified=false,
 'BOTH_SHEETS_VERIFIED_BACKUPS_MISSING');
notReady(x=>x.backups[1].sourceUnchangedSinceBackup=false,
 'BOTH_SHEETS_VERIFIED_BACKUPS_MISSING');
notReady(x=>x.operator.independentScopedGateBypassReviewed=false,
 'SCOPED_DRAINING_GATE_EXCEPTION_NOT_PROVEN');
notReady(x=>x.operator.legacy555WriterFenceVerified=false,
 'SCOPED_DRAINING_GATE_EXCEPTION_NOT_PROVEN');
const okSequence=[
 {step:'BACKUPS',outcome:'OK'},
 {step:'PRICE_HISTORY',outcome:'OK'},
 {step:'SNAPSHOT',outcome:'OK'},
 {step:'READBACK',outcome:'OK'}
];
const finished=simulateOct30PlannedRecovery(okSequence);
assert.equal(finished.status,'NEEDS_OPERATOR_CONFIRMATION');
assert.equal(finished.completionMarkerAuthorized,false);
assert.equal(finished.financialWrites,0);
const halt=simulateOct30PlannedRecovery([{step:'BACKUPS',outcome:'FAILED'}]);
assert.equal(halt.status,'HALTED_NO_WRITES');
assert.equal(halt.operatorRollbackOrReconciliationRequired,false);
for(const problem of ['FAILED','TIMEOUT','UNKNOWN']){
 const h=simulateOct30PlannedRecovery([
 {step:'BACKUPS',outcome:'OK'},
 {step:'PRICE_HISTORY',outcome:'OK'},
 {step:'SNAPSHOT',outcome:problem}
 ]);
 assert.equal(h.status,'INCIDENT_PARTIAL_UNKNOWN');
 assert.equal(h.operatorRollbackOrReconciliationRequired,true);
 assert.equal(h.autoRetryAuthorized,false);
}
const readbackFailure=simulateOct30PlannedRecovery([
 {step:'BACKUPS',outcome:'OK'},
 {step:'PRICE_HISTORY',outcome:'OK'},
 {step:'SNAPSHOT',outcome:'OK'},
 {step:'READBACK',outcome:'FAILED'}
]);
assert.equal(readbackFailure.status,'INCIDENT_PARTIAL_UNKNOWN');
assert.throws(()=>simulateOct30PlannedRecovery([
 {step:'BACKUPS',outcome:'OK'},
 {step:'PRICE_HISTORY',outcome:'TIMEOUT'},
 {step:'PRICE_HISTORY',outcome:'OK'}
]),/TERMINAL_RETRY_DENIED/);
assert.throws(()=>simulateOct30PlannedRecovery([
 {step:'PRICE_HISTORY',outcome:'OK'}
]),/OUT_OF_ORDER/);
assert.throws(()=>simulateOct30PlannedRecovery([
 {step:'BACKUPS',outcome:'OK'},
 {step:'BACKUPS',outcome:'OK'}
]),/OUT_OF_ORDER/);
assert.throws(()=>simulateOct30PlannedRecovery([{step:'BACKUPS',outcome:'not-a-status'}]),
 /OUTCOME_UNKNOWN/);
console.log(JSON.stringify({
 mode:'ISSUE507_OCT30_BARRIER_AND_BACKUP_SOURCE_CONTRACT',result:'PASS',
 blockedMutations:rejected,productionDrainNegativeCases:realDenials,
 actualProductionGateExecuted:true,syntheticTransactionCases:10,
 exposedFinancialValues:false,financialWrites:0,gasDeploy:false,nhTokens:0
}));
