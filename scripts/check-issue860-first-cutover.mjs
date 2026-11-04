import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import YAML from 'yaml';
import {loadCutoverSources,RELEASE} from './issue860-bootstrap-source.mjs';
import {runFirstCutover,BOOTSTRAP_BLOB} from './issue860-first-cutover.mjs';
import {gasSourceBlobSha} from './deploy-gas.mjs';
import {fixture as triggerFixture,manifest as triggerManifest} from './check-issue860-trigger-maintenance.mjs';
const sources=loadCutoverSources();
assert.equal(gasSourceBlobSha(sources.bootstrapSource),BOOTSTRAP_BLOB);
// Execute ALL actual original entrypoints: even a pre-existing OPEN property
// cannot admit one writer through the maintenance profile.
const names=[...sources.finalSource.matchAll(/return _issue507GateInvoke_\('([^']+)'/g)].map(m=>m[1]);
assert.equal(names.length,555);
const c=vm.createContext({});vm.runInContext(sources.bootstrapSource,c);
for(const name of names)assert.throws(()=>c[name](),/ISSUE860_BOOTSTRAP_MAINTENANCE/,name);
let metadataWrites=0,locked=false;
const props=new Map();
const p={getProperty:k=>props.get(k)||null,getProperties:()=>Object.fromEntries(props),
 setProperty(k,v){metadataWrites++;props.set(k,v);},deleteProperty(){throw Error('unexpected cleanup');}};
c.PropertiesService={getScriptProperties:()=>p};c.LockService={getScriptLock:()=>({hasLock:()=>locked,
 waitLock(){assert.equal(locked,false);locked=true;},releaseLock(){locked=false;}})};
c.jsonOk=x=>({status:'ok',...x});c.jsonError=message=>({status:'error',message});
c._isAuthorizedRequest=()=>false;
assert.equal(c.doGet({parameter:{action:'getWriterGateStatus'}}).status,'error');
c._isAuthorizedRequest=()=>true;
assert.equal(c.doGet({parameter:{action:'getWriterGateStatus'}}).writerGate.mode,'UNINITIALIZED');
assert.equal(metadataWrites,0);
// Actual editor-only prepare/pause -> independent operator attestation ->
// initialize -> seven-minute barrier -> restore -> ready protocol.
const operational=triggerFixture(sources.bootstrapSource),oc=operational.context;
let now=Date.now();oc.Date=class extends Date {static now(){return now;}};
oc.jsonOk=x=>({status:'ok',...x});oc.jsonError=message=>({status:'error',message});
oc._isAuthorizedRequest=()=>true;
operational.properties.set('issue860_ui_trigger_manifest_v1',JSON.stringify(triggerManifest));
assert.equal(oc.issue860BootstrapPrepare().phase,'PREPARED');
assert.equal(oc.doGet({parameter:{action:'getWriterGateStatus'}}).writerGate.firstCutoverAbortReady,true);
assert.throws(()=>oc.issue860BootstrapInitialize(),/NOT_PAUSED/);
assert.equal(oc.issue860BootstrapPause().phase,'PAUSED');
assert.equal(oc.doGet({parameter:{action:'getWriterGateStatus'}}).writerGate.firstCutoverAbortReady,false);
assert.throws(()=>oc.issue860BootstrapInitialize(),/ROLLOUT_REQUIRED/);
operational.properties.set('issue507_writer_gate_rollout_v1',JSON.stringify({releaseId:RELEASE,
 oldDeploymentsDisabled:true,externalWritersBlocked:true,editorsBlocked:true,verifiedAt:now,
 legacyDrainEvidence:{kind:'EXECUTIONS_UI',scope:'ALL_PROJECT_ACTORS_AND_VERSIONS',terminalOnly:true,reference:'fixture-only'}}));
assert.equal(oc.issue860BootstrapInitialize().mode,'DRAINING');
assert.equal(oc.issue860BootstrapRestore().phase,'RESTORED');
let g=()=>oc.doGet({parameter:{action:'getWriterGateStatus'}}).writerGate;
assert.equal(g().firstCutoverReady,false);
now+=420001;assert.equal(g().firstCutoverReady,true);
now+=1800001;assert.equal(g().firstCutoverReady,false,'stale prior rollout cannot be replayed');
let rollout=JSON.parse(operational.properties.get('issue507_writer_gate_rollout_v1'));
rollout.verifiedAt=now;operational.properties.set('issue507_writer_gate_rollout_v1',JSON.stringify(rollout));
assert.equal(oc.issue860BootstrapRenewBarrier().barrierRenewed,true);
assert.equal(g().firstCutoverReady,false);now+=420001;assert.equal(g().firstCutoverReady,true);
operational.rows.push({...operational.rows[0],id:'foreign'});assert.equal(g().firstCutoverReady,false);operational.rows.pop();
// Re-running initialization never resets a barrier after restore.
assert.throws(()=>oc.issue860BootstrapInitialize(),/NOT_PAUSED/);
assert.equal(JSON.parse(operational.properties.get('issue507_writer_gate_v1')).mode,'DRAINING');
const state={releaseId:RELEASE,mode:'OPEN',active:{},completed:[],finished:0,barrierAt:Date.now()};
props.set('issue507_writer_gate_v1',JSON.stringify(state));
for(const name of names.filter(n=>!['jsonOk','jsonError','_isAuthorizedRequest'].includes(n)))
 assert.throws(()=>c[name](),/ISSUE860_BOOTSTRAP_MAINTENANCE/,name);
assert.equal(metadataWrites,0);
// A deleted admission throw must reintroduce an actual original body entry.
const mutated=vm.createContext({});vm.runInContext(sources.bootstrapSource.replace("throw new Error('ISSUE860_BOOTSTRAP_MAINTENANCE');",''),mutated);
let entered=false;mutated._issue507GateAtomic_=()=>{entered=true;throw Error('entered gate');};
assert.throws(()=>mutated.today(),/entered gate/);assert.equal(entered,true);

const clone=x=>JSON.parse(JSON.stringify(x));
const manifest={name:'appsscript',type:'JSON',source:'{"runtimeVersion":"V8"}'};
const files=source=>[{name:'Code',type:'SERVER_JS',source},manifest];
function fixture(head='legacy',published=head){
 const code={legacy:fs.readFileSync('reference/gas-v9.281.gs','utf8').replace(/\r\n/g,'\n'),
  bootstrap:sources.bootstrapSource,final:sources.finalSource};
 let currentHead=files(code[head]),v=published==='legacy'?336:337,next=338;
 const versions=new Map([[336,files(code.legacy)],[v,files(code[published])]]),calls=[],fault={};
 const rpc={
  async readState(){calls.push('read');return clone({head:{files:currentHead},published:{files:versions.get(v)},
   deployment:{deploymentConfig:{versionNumber:v,manifestFileName:'appsscript'}}});},
  async inventory(){calls.push('inventory');if(fault.inventory)throw Error('inventory');},
  async writeContent(f){calls.push('content');currentHead=clone(f);},
  async createVersion(){calls.push('version');const id=next++;versions.set(id,clone(currentHead));return id;},
  async readVersion(id){return {files:fault.createdDrift?files('unreviewed'):clone(versions.get(id))};},
  async publish(config){calls.push('publish');if(fault.publishBefore)throw Error('publish lost');v=config.versionNumber;
   if(fault.publishAfter){fault.publishAfter=false;throw Error('publish response lost');}},
  async readDeployment(){return {deploymentConfig:{versionNumber:v}};},pause:async()=>{}
 };
 const gateState={mode:'DRAINING',activeCount:0,repairAuthorized:false,approvalPresent:false,
  releaseId:RELEASE,firstCutoverReady:true};
 return {rpc,calls,fault,gateState,async run(phase,options={}){
  let checks=0;
  return runFirstCutover({phase,approved:true,dryRun:false,sources,rpc,checkMain:async()=>{
   calls.push('main');checks++;if(fault.mainAt===checks)throw Error('stale main');},
   gate:async()=>gateState,...options});
 }};
}
let f=fixture();assert.equal((await f.run('bootstrap',{dryRun:true,approved:false})).dryRun,true);
assert.ok(!f.calls.includes('content'));
f=fixture();await assert.rejects(f.run('bootstrap',{approved:false}),/APPROVAL/);assert.equal(f.calls.length,0);
f=fixture();assert.equal((await f.run('bootstrap')).deployed,true);
assert.deepEqual(f.calls.filter(x=>['content','version','publish'].includes(x)),['content','version','publish']);
assert.equal((await f.run('bootstrap')).alreadyDeployed,true);
f=fixture('bootstrap');assert.equal((await f.run('finalize')).deployed,true);
assert.equal(f.gateState.mode,'DRAINING');assert.equal((await f.run('finalize')).alreadyDeployed,true);
for(const change of [{mode:'OPEN'},{activeCount:1},{approvalPresent:true},{firstCutoverReady:false},{releaseId:'other'}]){
 f=fixture('bootstrap');Object.assign(f.gateState,change);
 await assert.rejects(f.run('finalize'),/DRAIN|BOOTSTRAP_NOT_READY/);assert.ok(!f.calls.includes('content'));
}
f=fixture();await assert.rejects(f.run('finalize'),/BEFORE_SOURCE/);assert.ok(!f.calls.includes('content'));
for(const fault of [{inventory:true},{mainAt:2}]){
 f=fixture();Object.assign(f.fault,fault);await assert.rejects(f.run('bootstrap'));assert.ok(!f.calls.includes('content'));
}
f=fixture();f.fault.createdDrift=true;await assert.rejects(f.run('bootstrap'),/FORWARD_RECOVERY_REQUIRED/);
assert.ok(!f.calls.includes('publish'));
// An interrupted HEAD write is completed forward; no restoration of ungated code.
f=fixture('bootstrap','legacy');assert.equal((await f.run('bootstrap')).deployed,true);assert.ok(!f.calls.includes('content'));
f=fixture('final','bootstrap');assert.equal((await f.run('bootstrap')).deployed,true);
f=fixture('final');assert.equal((await f.run('bootstrap')).deployed,true);
f=fixture('final');f.gateState.mode='OPEN';await assert.rejects(f.run('bootstrap'),/DRAIN/);assert.ok(!f.calls.includes('content'));
f=fixture();f.fault.publishAfter=true;await assert.rejects(f.run('bootstrap'),/FORWARD_RECOVERY_REQUIRED/);
assert.equal((await f.run('bootstrap')).alreadyDeployed,true);
f=fixture('bootstrap');Object.assign(f.gateState,{mode:'UNINITIALIZED',firstCutoverAbortReady:true});
assert.equal((await f.run('abort')).abortedBeforeGate,true);assert.ok(!f.calls.includes('version'));
for(const state of [{mode:'DRAINING',firstCutoverAbortReady:true},{mode:'UNINITIALIZED',firstCutoverAbortReady:false}]){
 f=fixture('bootstrap');Object.assign(f.gateState,state);await assert.rejects(f.run('abort'),/ABORT_NOT_SAFE/);
 assert.ok(!f.calls.includes('content'));
}

const workflow=YAML.parse(fs.readFileSync('.github/workflows/gas-deploy.yml','utf8'));
assert.equal(workflow.on.workflow_dispatch.inputs.first_gate_phase.default,'none');
assert.deepEqual(workflow.on.workflow_dispatch.inputs.first_gate_phase.options,['none','bootstrap','finalize','abort']);
const steps=workflow.jobs.deploy.steps;
const special=steps.find(s=>s.run==='node scripts/issue860-first-cutover.mjs');
assert.equal(special.if,"env.GAS_FIRST_GATE_PHASE != 'none'");
assert.equal(special['continue-on-error'],undefined);
for(const name of ['Deploy GAS','Read-only release state before any deployment write'])
 assert.equal(steps.find(s=>s.name===name).if,"env.GAS_FIRST_GATE_PHASE == 'none'");
for(const s of steps.filter(s=>/Activate NH|Verify KRX 37/.test(s.name)))assert.match(s.if,/GAS_FIRST_GATE_PHASE == 'none'/);
assert.equal(workflow.jobs.deploy.environment,'portfolio-production-gas');
assert.match(fs.readFileSync('scripts/deploy-gas.mjs','utf8'),/GAS_FIRST_GATE_CUTOVER_UNVERIFIED/);
console.log('Issue860 first cutover: 555 maintenance denials, auth, pinned phases, drain, immutable readback and forward recovery PASS');
