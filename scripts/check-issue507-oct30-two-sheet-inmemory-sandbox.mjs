import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {planIssue507Oct30ScopedRevaluation}
 from './issue507-oct30-scoped-valuation-plan.mjs';
import {runOct30TwoSheetInMemorySandbox}
 from './issue507-oct30-two-sheet-inmemory-sandbox.mjs';

// Synthetic-only, checks source signature of frozen actual GAS.
const bytes=fs.readFileSync('src/gas/apps_script.gs');
const sha=createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
assert.equal(sha,'9c1a5f31d1abc4b44f7da9af7a50fe3f15967134');
const date='2026-10-30';
const names=Array.from({length:37},(_,i)=>String(i+1).padStart(6,'0'));
const beforeSnapshot=names.map((code,i)=>[
 date,code,'SYNTHETIC_HOLDING',2,200,400,100,200,-200,-50,
 'KRX_CARRY@2026-10-29',''
]);
beforeSnapshot.push(...['F00001','F00002'].map((code,i)=>{
 const nav=1200+i*150;return [
  date,code,'SYNTHETIC_NAV',1,1000,1000,nav,nav,nav-1000,
  Number(((nav-1000)/1000*100).toFixed(2)),'FUND_NAV',''];
}));
const beforeHistory=['F00001','F00002'].map((code,i)=>
 [date,code,'SYNTHETIC_NAV',1200+i*150,'','FUND_NAV']);
const otherSnapshot=[
 ['2026-10-29','777777','OTHER_DATE',1,100,100,200,200,100,100,'KRX',''],
 ['2026-10-31','888888','OTHER_DATE',1,100,100,200,200,100,100,'KRX','']
];
const otherHistory=[
 ['2026-10-29','777777','OTHER_DATE',200,'','KRX'],
 ['2026-10-31','888888','OTHER_DATE',200,'','KRX']
];
const quotes=Object.fromEntries(names.map((code,i)=>[code,{
 price:100+i,usedDate:date,source:i%2?'KRX_OTP':'KRX'}]));
const inputs={
 date,snapshotRows:beforeSnapshot,historyRows:beforeHistory,
 officialCloses:quotes,ledgerHoldings:names.map(code=>({
  code,qty:2,costAmt:400
 })),
 sourceEvidence:{mode:'ISSUE507_OCT30_PRIVATE_KRX_QUOTE_PROOF',
  status:'PER_CODE_SOURCE_AND_STORAGE_SCOPE_VERIFIED',date,
  verifiedPrivateQuoteCount:37,
  individualQuoteValuesDisclosed:false,safeToWrite:false}
};
const plan=planIssue507Oct30ScopedRevaluation(structuredClone(inputs));
const args={date,beforeSnapshot,beforeHistory,plan,otherSnapshot,otherHistory};
const inputBefore=structuredClone(args);
const run=fault=>runOct30TwoSheetInMemorySandbox({...structuredClone(args),fault});
const success=run('NONE');
assert.equal(success.summary.status,'SIMULATED_READBACK_MATCH');
assert.equal(success.summary.simulatedRowsChanged,74);
assert.equal(success.summary.safeToFinalize,false);
assert.equal(success.summary.realFinancialWrites,0);
assert.equal(success.summary.pendingCompletionMarkerAllowed,false);
assert.equal(success.summary.physicalBackupsVerified,false);
assert.equal(success.summary.realWriterGateVerified,false);
assert.equal(success.privateSandboxState.snapshot.length,41);
assert.equal(success.privateSandboxState.history.length,41);
assert.deepEqual(success.privateSandboxState.snapshot.slice(-2),otherSnapshot);
assert.deepEqual(success.privateSandboxState.history.slice(-2),otherHistory);
assert.deepEqual(success.privateSandboxState.snapshot.slice(37,39),beforeSnapshot.slice(37));
assert.deepEqual(success.privateSandboxState.history.slice(0,2),beforeHistory);
assert.deepEqual(args,inputBefore,'caller inputs must be unchanged');
let tests=1;
for(const fault of ['PRICE_PARTIAL','PRICE_UNKNOWN','PRICE_DONE',
  'SNAPSHOT_PARTIAL','SNAPSHOT_DONE','READBACK_CORRUPT']){
 const r=run(fault);
 assert.equal(r.summary.status,'SIMULATED_ROLLBACK_VERIFIED',fault);
 assert.equal(r.summary.restoredBothSheetsInSandbox,true);
 assert.equal(r.summary.pendingCompletionMarkerAllowed,false);
 assert.deepEqual(r.privateSandboxState.snapshot,
  beforeSnapshot.concat(otherSnapshot),fault);
 assert.deepEqual(r.privateSandboxState.history,
  beforeHistory.concat(otherHistory),fault);
 tests++;
}
const backup=run('BACKUP_FAIL');
assert.equal(backup.summary.status,'SIMULATED_ABORTED_UNCHANGED');
assert.equal(backup.summary.realFinancialWrites,0);
assert.deepEqual(backup.privateSandboxState.snapshot,
 beforeSnapshot.concat(otherSnapshot));
tests++;
const badRollback=run('ROLLBACK_FAILURE');
assert.equal(badRollback.summary.status,'SIMULATED_ROLLBACK_UNVERIFIED');
assert.equal(badRollback.summary.restoredBothSheetsInSandbox,false);
assert.equal(badRollback.summary.automaticRetryAllowed,false);
assert.equal(badRollback.summary.safeToFinalize,false);
tests++;
const external=run('EXTERNAL_BEFORE_WRITE');
assert.equal(external.summary.status,'SIMULATED_EXTERNAL_CONFLICT_UNRESOLVED');
assert.equal(external.summary.restoredBothSheetsInSandbox,false);
assert.equal(external.summary.automaticRetryAllowed,false);
assert.deepEqual(external.privateSandboxState.history,
 beforeHistory.concat(otherHistory));
assert.notDeepEqual(external.privateSandboxState.snapshot,
 beforeSnapshot.concat(otherSnapshot));
tests++;
// Exact same synthetic inputs on repeated calls never mutate backing inputs
// and therefore cannot append duplicates. This is NOT a live retry proof.
const twice=run('NONE');
assert.deepEqual(twice.privateSandboxState.history,
 success.privateSandboxState.history);
assert.deepEqual(twice.privateSandboxState.snapshot,
 success.privateSandboxState.snapshot);
tests++;
function refuse(mutate,pattern){
 const a=structuredClone(args);mutate(a);
 assert.throws(()=>runOct30TwoSheetInMemorySandbox(a),pattern);
 tests++;
}
refuse(a=>a.date='2026-10-29',/ISSUE507_SANDBOX_NOT_AUTHORIZED_INPUT/);
refuse(a=>a.plan.summary.safeToApply=true,/ISSUE507_SANDBOX_NOT_AUTHORIZED_INPUT/);
refuse(a=>a.otherHistory.push(structuredClone(a.beforeHistory[0])),
 /ISSUE507_SANDBOX_OTHER_DATE_CONFLICT/);
refuse(a=>a.beforeSnapshot.pop(),/ISSUE507_OCT30_POSTSTATE_/);
refuse(a=>a.plan.privatePlan.domestic[0].after[5]++,
 /ISSUE507_OCT30_POSTSTATE_/);
refuse(a=>a.plan.privatePlan.domestic[1].rowIndex=0,
 /ISSUE507_SANDBOX_PATCH_INDEX/);
refuse(a=>a.fault='UNKNOWN_GAS',/ISSUE507_SANDBOX_NOT_AUTHORIZED_INPUT/);
assert.deepEqual(args,inputBefore);
for(const s of [success.summary,badRollback.summary,external.summary]){
 const out=JSON.stringify(s);
 for(const sensitive of ['SYNTHETIC_HOLDING','SYNTHETIC_NAV','F00001','000001'])
  assert.ok(!out.includes(sensitive),'sensitive data in summary');
}
console.log(JSON.stringify({
 mode:'ISSUE507_OCT30_TWO_SHEET_INMEMORY_ROLLBACK_TEST',
 result:'PASS',syntheticScenarios:tests,syntheticHistoryAppend:37,
 syntheticSnapshotPatches:37,otherDateRowsPreserved:2,
 backupRestoreFaultsCovered:true,externalWriterCollisionCovered:true,
 realFinancialWrites:0,realGASDeployed:false,nhTokenRequests:0
}));
