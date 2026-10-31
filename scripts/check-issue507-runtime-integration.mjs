import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {prepareIssue507Runtime} from './prepare-issue507-runtime-integration.mjs';
import {assertGasReleaseReady,assertGasProjectFileSet} from './deploy-gas.mjs';
import {setup} from './check-issue507-f00001-scoped-repair.mjs';
const {candidate,manifest}=prepareIssue507Runtime();
assert.equal(manifest.deployable,false);assert.equal(manifest.financeWriteAuthorized,false);
assert.throws(()=>prepareIssue507Runtime({source:fs.readFileSync('reference/gas-v9.281.gs','utf8')+'\n'}),/BASE_SOURCE_CHANGED/);
assert.throws(()=>assertGasReleaseReady(candidate),/SOURCE_NOT_APPROVED/);
assert.throws(()=>assertGasProjectFileSet([{name:'appsscript',type:'JSON',source:'{}'},
 {name:'Code',type:'SERVER_JS',source:candidate},{name:'repair',type:'SERVER_JS',source:'function x(){}'}],'Code',[]),/UNREVIEWED_FILES/);
let now=1800000000000,sequence=0;
const props=new Map();const clone=x=>JSON.parse(JSON.stringify(x));
const propertyApi={getProperties:()=>Object.fromEntries(props),getProperty:k=>props.get(k)||null,setProperty:(k,v)=>props.set(k,v),deleteProperty:k=>props.delete(k)};
const runtime=fs.readFileSync('ops/issue507/writer-gate.gs','utf8');
function context(){let held=false,failures=0;const waits=[];const lock={hasLock:()=>held,waitLock:ms=>{waits.push(ms);assert.equal(held,false);if(failures-->0)throw Error('temporary busy');held=true;},releaseLock:()=>{held=false;}};
 const c=vm.createContext({Date:{now:()=>now},PropertiesService:{getScriptProperties:()=>propertyApi},
 LockService:{getScriptLock:()=>lock},Utilities:{getUuid:()=> 'synthetic-'+(++sequence)},console});
 vm.runInContext(`var ISSUE507_GATE_RELEASE_ID='${manifest.releaseId}';\n`+runtime,c);c.setLockFailures=n=>{failures=n;waits.length=0;};c.lockWaits=waits;return c;}
const gate=context();
const receipt={releaseId:manifest.releaseId,oldDeploymentsDisabled:true,externalWritersBlocked:true,editorsBlocked:true,legacyDrainEvidence:{kind:'EXECUTIONS_UI',scope:'ALL_PROJECT_ACTORS_AND_VERSIONS',terminalOnly:true,reference:'SYNTHETIC_EVIDENCE'},verifiedAt:now};
props.set('issue507_writer_gate_rollout_v1',JSON.stringify(receipt));
const cold=gate._issue507GateEnter_('manual');gate._issue507GateExit_(cold);assert.equal(JSON.parse(props.get('issue507_writer_gate_v1')).mode,'OPEN');
assert.equal(gate.issue507BeginWriterDrain_().mode,'DRAINING');
const initial=props.get('issue507_writer_gate_v1');
assert.throws(()=>gate._issue507AssertDrain_(),/NOT_DRAINED/);
now+=419999;assert.throws(()=>gate._issue507AssertDrain_(),/NOT_DRAINED/);
now++;assert.equal(gate._issue507AssertDrain_().processApiRequired,false);
gate.issue507BeginWriterDrain_();assert.equal(props.get('issue507_writer_gate_v1'),initial);
assert.equal(gate.issue507ResumeWriters_().mode,'OPEN');
// A second maintenance cycle cannot reuse the prior cycle's aged rollout
// attestation. Re-verify blocked legacy/editor/external writers before drain.
assert.throws(()=>gate.issue507BeginWriterDrain_(),/GATE_ROLLOUT_STALE/);
assert.equal(JSON.parse(props.get('issue507_writer_gate_v1')).mode,'OPEN');
props.set('issue507_writer_gate_rollout_v1',JSON.stringify({...receipt,verifiedAt:now}));
// An in-flight manual refresh remains registered BEFORE external NAV fetch.
// Completion writes a unique durable proof BEFORE trying the production lock.
const contended=gate._issue507GateEnter_('contended-completion');
gate.setLockFailures(1);assert.doesNotThrow(()=>gate._issue507GateExit_(contended));
assert.deepEqual(gate.lockWaits,[1000]);
assert.ok(props.get('issue507_writer_end_v1_'+contended));
assert.ok(JSON.parse(props.get('issue507_writer_gate_v1')).active[contended]);
gate.setLockFailures(0);const reconcileProbe=gate._issue507GateEnter_('reconcile-probe');gate._issue507GateExit_(reconcileProbe);
assert.equal(props.has('issue507_writer_end_v1_'+contended),false);
const quotaOwner=gate._issue507GateEnter_('metadata-failure');
const saveProperty=propertyApi.setProperty;let mutations=0;
propertyApi.setProperty=()=>{mutations++;throw Error('synthetic quota');};
assert.throws(()=>gate._issue507GateExit_(quotaOwner),/COMPLETION_RECEIPT_UNVERIFIED/);assert.equal(mutations,1);
assert.ok(JSON.parse(props.get('issue507_writer_gate_v1')).active[quotaOwner]);
propertyApi.setProperty=saveProperty;gate._issue507GateExit_(quotaOwner);
// A cleanup write failure preserves the independent terminal receipt and
// recovers on later admission, without repeating the completed producer body.
const deferredOwner=gate._issue507GateEnter_('cleanup-write-failure');
propertyApi.setProperty=(key,value)=>{if(key==='issue507_writer_gate_v1')throw Error('cleanup quota');return saveProperty(key,value);};
assert.doesNotThrow(()=>gate._issue507GateExit_(deferredOwner));
assert.ok(props.get('issue507_writer_end_v1_'+deferredOwner));
propertyApi.setProperty=saveProperty;
const nextOwner=gate._issue507GateEnter_('next-owner');gate._issue507GateExit_(nextOwner);
assert.equal(props.has('issue507_writer_end_v1_'+deferredOwner),false);
const beforeDuplicate=JSON.parse(props.get('issue507_writer_gate_v1')).finished;
gate._issue507GateExit_(deferredOwner);assert.equal(JSON.parse(props.get('issue507_writer_gate_v1')).finished,beforeDuplicate);
// Invalid terminal proof cannot clear any active owner.
const forgedOwner=gate._issue507GateEnter_('invalid-proof');
const activeState=JSON.parse(props.get('issue507_writer_gate_v1'));
props.set('issue507_writer_end_v1_'+forgedOwner,JSON.stringify({releaseId:manifest.releaseId,token:forgedOwner,...activeState.active[forgedOwner],state:'ENDED',acknowledged:false,endedAt:now+1}));
assert.throws(()=>gate._issue507GateEnter_('blocked-by-invalid-proof'),/END_PROOF_INVALID/);
props.delete('issue507_writer_end_v1_'+forgedOwner);gate._issue507GateExit_(forgedOwner);
const finishedBefore=JSON.parse(props.get('issue507_writer_gate_v1')).finished;
const token=gate._issue507GateEnter_('handleRefreshFundValuations');
const maintenance=context();maintenance.issue507BeginWriterDrain_();now+=420000;
assert.throws(()=>maintenance._issue507AssertDrain_(),/NOT_DRAINED/);
assert.throws(()=>maintenance._issue507GateEnter_('runDailyPriceHistory'),/MAINTENANCE/);
// No expiry inference: a killed execution still blocks after an entire day.
now+=86400000;assert.throws(()=>maintenance._issue507AssertDrain_(),/NOT_DRAINED/);
gate._issue507GateExit_(token);assert.equal(maintenance._issue507AssertDrain_().finished,finishedBefore+1);
const s=JSON.parse(props.get('issue507_writer_gate_v1'));assert.equal(Object.keys(s.active).length,0);assert.equal(s.completed.at(-1).token,token);assert.equal(s.completed[0].state,'ENDED');assert.ok(s.completed[0].endedAt>=s.completed[0].startedAt);
props.set('issue507_f00001_approval_v1','live');assert.throws(()=>maintenance.issue507ResumeWriters_(),/APPROVAL_STILL_LIVE/);props.delete('issue507_f00001_approval_v1');
maintenance.issue507ResumeWriters_();
assert.throws(()=>gate._issue507GateInvoke_('throws',()=>{throw Error('fixture failure');},null,[]),/fixture failure/);
assert.equal(gate._issue507GateInside_,false);assert.equal(Object.keys(JSON.parse(props.get('issue507_writer_gate_v1')).active).length,0);
// Execute every generated wrapper: rejection occurs BEFORE any original body,
// covering HTTP, menus, CLOCK/onEdit callbacks and direct helper entry points.
const ctx=vm.createContext({console,Date:class extends Date {static now(){return now;}},LockService:{getScriptLock:()=>({hasLock:()=>false,waitLock(){},releaseLock(){}})},
 PropertiesService:{getScriptProperties:()=>propertyApi},Utilities:{getUuid:()=> 'wrapped-'+(++sequence)}});
vm.runInContext(candidate,ctx);
const realEnter=ctx._issue507GateEnter_,realExit=ctx._issue507GateExit_;
let blocked=0;
ctx._issue507GateEnter_=()=>{blocked++;throw Error('GATE_MAINTENANCE');};
for(const name of manifest.entrypoints){assert.equal(typeof ctx[name],'function');assert.throws(()=>ctx[name](),/GATE_MAINTENANCE/,name);}
assert.equal(blocked,manifest.entrypointCount);
// Actual handleRefreshFundValuations and doPost bodies, with external producer
// stubbed at its I/O boundary. Gate admission precedes BOTH routes' fetch.
const enters=[],exits=[];ctx._issue507GateEnter_=name=>{enters.push(name);return 'owner';};ctx._issue507GateExit_=owner=>exits.push(owner);
ctx._issue507Original_getss_=()=>({});ctx._issue507Original__isAuthorizedRequest_=()=>true;
ctx._issue507Original__createFundRecoveryDiagnostic_=()=>null;
ctx._issue507Original__fundRecoveryDiagnosticStart_=()=>{};ctx._issue507Original__fundRecoveryDiagnosticFinish_=()=>{};
ctx._issue507Original_jsonOk_=x=>x;ctx._issue507Original_jsonError_=msg=>({error:msg});
let fetched=0;ctx._issue507Original__refreshFundValuations_=()=>{assert.equal(enters.length,1);assert.equal(ctx._issue507GateInside_,true);fetched++;return {status:'ok'};};
ctx.handleRefreshFundValuations('2026-10-30','2026-10-30','F00001');assert.deepEqual(enters,['handleRefreshFundValuations']);assert.deepEqual(exits,['owner']);
enters.length=0;exits.length=0;
ctx.doPost({postData:{contents:'action=refreshFundValuations&from=2026-10-30&to=2026-10-30&code=F00001'}});
assert.deepEqual(enters,['doPost']);assert.equal(fetched,2);assert.deepEqual(exits,['owner']);
// Real registry + original manual refresh handler, while another GAS context
// closes admission during its external-fetch interval.
// This is a THIRD drain cycle: an old operator receipt must fail until renewed.
assert.throws(()=>maintenance.issue507BeginWriterDrain_(),/GATE_ROLLOUT_STALE/);
props.set('issue507_writer_gate_rollout_v1',JSON.stringify({...receipt,verifiedAt:now}));
ctx._issue507GateEnter_=realEnter;ctx._issue507GateExit_=realExit;
ctx._issue507Original__refreshFundValuations_=()=>{
 assert.equal(Object.keys(JSON.parse(props.get('issue507_writer_gate_v1')).active).length,1);
 maintenance.issue507BeginWriterDrain_();now+=420000;
 assert.throws(()=>maintenance._issue507AssertDrain_(),/NOT_DRAINED/);
 assert.throws(()=>maintenance._issue507GateEnter_('second-refresh'),/MAINTENANCE/);
 return {status:'ok'};
};
ctx.handleRefreshFundValuations('2026-10-30','2026-10-30','F00001');
assert.equal(maintenance._issue507AssertDrain_().activeCount,0);
// Missing or nonterminal legacy execution evidence never becomes proof merely
// because the elapsed-time observation window has passed.
const savedReceipt=props.get('issue507_writer_gate_rollout_v1');
for(const evidence of [null,{kind:'PROCESS_API_403',scope:'ALL_PROJECT_ACTORS_AND_VERSIONS',terminalOnly:true,reference:'x'},
 {...receipt.legacyDrainEvidence,terminalOnly:false},{...receipt.legacyDrainEvidence,reference:''}]) {
 props.set('issue507_writer_gate_rollout_v1',JSON.stringify({...receipt,legacyDrainEvidence:evidence}));
 assert.throws(()=>maintenance._issue507AssertDrain_(),/ROLLOUT_REQUIRED/);
}
props.set('issue507_writer_gate_rollout_v1',savedReceipt);
// Integrated repair module must use a REAL empty DRAINING gate, never booleans
// alone. Keep synthetic Sheets adapters while running generated production code.
const h=setup(),adapters={};
for(const name of ['getss','_buildSnapshotRowsFromTradeAndPriceHistory','_readRawSnapshotRowsByDate','getCodeItems','_getFundEvaluationAtDate','diagnosePriceHistoryIntegrity','_buildSnapshotRangeReadContext','_tradeLedgerWriteUnverified_','_getFundValuationStatus','_touchSnapshotIntegritySourceRevision'])adapters[name]=h.ctx[name];
const fixtureLock=h.ctx.LockService.getScriptLock();fixtureLock.hasLock=()=>h.held;h.ctx.LockService.getScriptLock=()=>fixtureLock;
vm.runInContext(candidate,h.ctx);
for(const [name,fn] of Object.entries(adapters))h.ctx['_issue507Original_'+name+'_']=fn;
const realNow=Date.now();h.props.set('issue507_writer_gate_rollout_v1',JSON.stringify({...receipt,verifiedAt:realNow-420001}));
h.props.set('issue507_writer_gate_v1',JSON.stringify({releaseId:manifest.releaseId,mode:'DRAINING',active:{},completed:[],finished:0,barrierAt:realNow-420001}));
h.approve();assert.equal(h.run(true).changed,1);assert.deepEqual(h.data.slice(2),h.initial.slice(2));assert.equal(h.data[2][10],'FUND_NAV_CARRY_INPUT_REQUIRED');assert.equal(h.ctx._issue507GateInside_,false);
// Missing integration gate no longer accepts the old manual quiescence receipt.
const isolated=setup();delete isolated.ctx._issue507AssertDrain_;assert.throws(()=>isolated.run(false));assert.equal(isolated.writes.length,0);
console.log('PASS staged runtime: 555 entry points, real refresh/doPost admission, receipts/drain/hardkill, Process API independent proof, single-row integration and release rejection');
