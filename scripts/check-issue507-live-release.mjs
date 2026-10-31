import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {buildIssue507LiveRelease} from './build-issue507-live-release.mjs';
import {assertGasReleaseReady,extractExpectedGasVersion,assertWriterGateReleaseTransition,gasSourceBlobSha} from './deploy-gas.mjs';
import {setup} from './check-issue507-f00001-scoped-repair.mjs';
const live=fs.readFileSync('src/gas/apps_script.gs','utf8'),build=buildIssue507LiveRelease();
assert.equal(live,build.source);assert.equal(build.entrypointCount,555);
assert.equal(assertGasReleaseReady(live),'9.282');assert.equal(extractExpectedGasVersion(live),'9.282');
const releaseManifest=JSON.parse(fs.readFileSync('ops/issue507/release-9.282.json','utf8'));
assert.equal(releaseManifest.originalVersionPinsReviewed,23);assert.equal(releaseManifest.sourceBlob,gasSourceBlobSha(live));
const base=fs.readFileSync('reference/gas-v9.281.gs','utf8');
assert.doesNotThrow(()=>assertWriterGateReleaseTransition(base,live));
assert.doesNotThrow(()=>assertWriterGateReleaseTransition(live,live));
assert.throws(()=>assertWriterGateReleaseTransition(live,base),/GATE_REMOVAL_ROLLBACK_BLOCKED/);
const names=[...base.matchAll(/^function (\w+)\s*\(/gm)].map(m=>m[1]);
let liveSequence=0;
function create(props=new Map(),program=live){
 let held=false,failures=0,hook=()=>{};const lock={hasLock:()=>held,waitLock:()=>{assert.equal(held,false);if(failures-->0)throw Error('long financial lock');held=true;},releaseLock:()=>{held=false;}};
 const ctx=vm.createContext({console,Date,LockService:{getScriptLock:()=>lock},Utilities:{getUuid:()=> 'live-fixture-'+(++liveSequence),formatDate:(d,tz)=>new Intl.DateTimeFormat('sv-SE',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit'}).format(d)},
  PropertiesService:{getScriptProperties:()=>({getProperties:()=>Object.fromEntries(props),getProperty:k=>props.get(k)||null,setProperty:(k,v)=>{props.set(k,v);hook(k,v);},deleteProperty:k=>props.delete(k)})}});
 vm.runInContext(program,ctx);return {ctx,props,setPropertyHook:fn=>{hook=fn;},setLockFailures:n=>{failures=n;},get held(){return held;}};
}
const h=create();let produced=0;
h.ctx.getss=()=>({});h.ctx._createFundRecoveryDiagnostic=()=>null;h.ctx._fundRecoveryDiagnosticStart=()=>{};h.ctx._fundRecoveryDiagnosticFinish=()=>{};
h.ctx._refreshFundValuations=()=>{produced++;assert.equal(h.ctx._issue507GateInside_,true);return {ok:true};};h.ctx.jsonOk=x=>x;h.ctx.jsonError=message=>({status:'error',message});
// Real public refresh body auto-bootstraps and returns normally on first call.
assert.equal(h.ctx.handleRefreshFundValuations('2026-10-30','2026-10-30','F00001').ok,true);
assert.equal(produced,1);let s=JSON.parse(h.props.get('issue507_writer_gate_v1'));assert.equal(s.mode,'OPEN');assert.equal(Object.keys(s.active).length,0);assert.equal(s.completed.length,1);
assert.equal(h.props.has('issue507_f00001_approval_v1'),false);assert.throws(()=>h.ctx._issue507AssertDrain_(),/ROLLOUT_REQUIRED/);
// Every original function rejects before its body in an explicit drain.
const full=create();s={...s,mode:'DRAINING'};full.props.set('issue507_writer_gate_v1',JSON.stringify(s));
for(const name of names)assert.throws(()=>full.ctx[name](),/GATE_MAINTENANCE/,name);
// Metadata-only status remains authenticated/reachable even during drain.
full.ctx._isAuthorizedRequest=()=>false;full.ctx.jsonError=x=>({status:'error',message:x});full.ctx.jsonOk=x=>({status:'ok',...x});
assert.equal(full.ctx.doGet({parameter:{action:'getWriterGateStatus'}}).status,'error');
full.ctx._isAuthorizedRequest=()=>true;
assert.equal(full.ctx.doGet({parameter:{action:'getWriterGateStatus'}}).writerGate.mode,'DRAINING');
assert.equal(full.held,false);
// Reproduce P1 with actual LIVE today(): >24 normal completions each contend
// with a long-held financial lock during cleanup. No capacity leak/result loss.
const longLock=create(),realExit=longLock.ctx._issue507GateExit_;
longLock.ctx._issue507GateExit_=token=>{longLock.setLockFailures(1);return realExit(token);};
for(let i=0;i<30;i++)assert.equal(typeof longLock.ctx.today(),'string');
longLock.ctx._issue507GateExit_=realExit;longLock.setLockFailures(0);longLock.ctx.today();
assert.equal(Object.keys(JSON.parse(longLock.props.get('issue507_writer_gate_v1')).active).length,0);
assert.equal([...longLock.props.keys()].filter(k=>k.startsWith('issue507_writer_end_v1_')).length,0);
// Two real LIVE VM contexts share Properties. A collector completes >8 runs
// between producer set/readback, then deletes ACKED proof before producer's
// cleanup. UNACKED proof is retained, so original today() still returns.
const race=create(),collector=create(race.props);let first=true,ackFirst=true;
race.setPropertyHook((key,value)=>{
 if(!key.startsWith('issue507_writer_end_v1_'))return;
 const e=JSON.parse(value);
 if(first && !e.acknowledged){first=false;for(let i=0;i<40;i++)collector.ctx.today();}
 else if(!first && ackFirst && e.acknowledged){ackFirst=false;collector.ctx.today();assert.equal(race.props.has(key),false);}
});
assert.equal(typeof race.ctx.today(),'string');assert.equal(first,false);assert.equal(ackFirst,false);
assert.equal(Object.keys(JSON.parse(race.props.get('issue507_writer_gate_v1')).active).length,0);
assert.equal([...race.props.keys()].filter(k=>k.startsWith('issue507_writer_end_v1_')).length,0);
// Mutation oracle: permitting GC of UNACKED proof reintroduces the reviewed
// result-loss race. The same two-context interleaving MUST then fail.
const unsafe=live.replace('e.acknowledged!==true || e.releaseId','false || e.releaseId');assert.notEqual(unsafe,live);
const mutant=create(new Map(),unsafe),mutantCollector=create(mutant.props,unsafe);let interleave=true;
mutant.setPropertyHook((key,value)=>{if(interleave && key.startsWith('issue507_writer_end_v1_') && !JSON.parse(value).acknowledged){interleave=false;mutantCollector.ctx.today();}});
assert.throws(()=>mutant.ctx.today(),/GATE_COMPLETION_RECEIPT_UNVERIFIED/);
// Unknown stored release state is not erased to recover service automatically.
const failedBootstrap=create();failedBootstrap.props.set=()=>{throw Error('BOOTSTRAP_QUOTA');};assert.throws(()=>failedBootstrap.ctx.today(),/BOOTSTRAP_QUOTA/);assert.equal(failedBootstrap.held,false);
const bad=create();bad.props.set('issue507_writer_gate_v1',JSON.stringify({...s,releaseId:'wrong'}));assert.throws(()=>bad.ctx.today(),/GATE_STATE_INVALID/);
assert.equal(JSON.parse(bad.props.get('issue507_writer_gate_v1')).releaseId,'wrong');
// Full LIVE source + real gate + production calculator + synthetic Sheets.
const f=setup(),adapters={};
for(const name of ['getss','_buildSnapshotRowsFromTradeAndPriceHistory','_readRawSnapshotRowsByDate','getCodeItems','_getFundEvaluationAtDate','diagnosePriceHistoryIntegrity','_buildSnapshotRangeReadContext','_tradeLedgerWriteUnverified_','_getFundValuationStatus','_touchSnapshotIntegritySourceRevision'])adapters[name]=f.ctx[name];
const lock=f.ctx.LockService.getScriptLock();lock.hasLock=()=>f.held;f.ctx.LockService.getScriptLock=()=>lock;
vm.runInContext(live,f.ctx);Object.assign(f.ctx,adapters);
const now=Date.now(),releaseId=build.releaseId;
f.props.set('issue507_writer_gate_rollout_v1',JSON.stringify({releaseId,verifiedAt:now-420001,oldDeploymentsDisabled:true,externalWritersBlocked:true,editorsBlocked:true,
 legacyDrainEvidence:{kind:'EXECUTIONS_UI',scope:'ALL_PROJECT_ACTORS_AND_VERSIONS',terminalOnly:true,reference:'SYNTHETIC'}}));
f.props.set('issue507_writer_gate_v1',JSON.stringify({releaseId,mode:'DRAINING',active:{},completed:[],finished:0,barrierAt:now-420001}));
f.approve();assert.equal(f.run(true).changed,1);assert.deepEqual(f.data.slice(2),f.initial.slice(2));assert.equal(f.data[2][10],'FUND_NAV_CARRY_INPUT_REQUIRED');
console.log('PASS v9.282 LIVE: deterministic source, 555 admission guards, OPEN bootstrap without repair grant, authenticated drain status, gate-removal rollback blocked, 39-row scoped preservation');
