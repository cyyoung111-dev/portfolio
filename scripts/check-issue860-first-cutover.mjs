import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import YAML from 'yaml';
import {loadCutoverSources,BASE_BLOB,FINAL_BLOB,RELEASE} from './issue860-bootstrap-source.mjs';
import {runFirstCutover,BOOTSTRAP_BLOB,PREVIOUS_BOOTSTRAP_BLOB,assertFirstCutoverCliContext} from './issue860-first-cutover.mjs';
import {loadCutoverSources as loadPreviousSources} from '../reference/issue860-bootstrap-v1.mjs';
import {gasSourceBlobSha,assertGasReleaseReady} from './deploy-gas.mjs';
import {fixture as triggerFixture,manifest as triggerManifest} from './check-issue860-trigger-maintenance.mjs';
// A narrowly scoped main-push inspection cannot become a deploy or
// bypass the trusted main SHA and explicit no-approval contract.
const readonlyContext={
 GITHUB_EVENT_NAME:'push',GITHUB_REF:'refs/heads/main',GITHUB_REPOSITORY:'cyyoung111-dev/portfolio',
 GITHUB_SHA:'a'.repeat(40),GAS_EXPECTED_MAIN_SHA:'a'.repeat(40),
 GAS_ISSUE860_ONE_SHOT_INSPECT:'true',GAS_FIRST_GATE_PHASE:'inspect',
 GAS_DEPLOY_DRY_RUN:'true',GAS_9282_RELEASE_APPROVAL:'false',GAS_9283_RELEASE_APPROVAL:'false'
};
assert.equal(assertFirstCutoverCliContext(readonlyContext),'one-shot-readonly-inspect');
assert.equal(assertFirstCutoverCliContext({...readonlyContext,GITHUB_EVENT_NAME:'workflow_dispatch'}),'manual');
for(const altered of [
 {GAS_ISSUE860_ONE_SHOT_INSPECT:'false'},{GAS_FIRST_GATE_PHASE:'finalize'},
 {GAS_FIRST_GATE_PHASE:'bootstrap'},{GAS_FIRST_GATE_PHASE:'abort'},
 {GAS_DEPLOY_DRY_RUN:'false'},{GAS_9282_RELEASE_APPROVAL:'true'},
 {GAS_9283_RELEASE_APPROVAL:'true'},{GITHUB_REF:'refs/heads/pr'},
 {GITHUB_REPOSITORY:'another/repo'},{GAS_EXPECTED_MAIN_SHA:'b'.repeat(40)},
 {GITHUB_SHA:'invalid-sha'},{GITHUB_EVENT_NAME:'schedule'}
]){
 assert.throws(()=>assertFirstCutoverCliContext({...readonlyContext,...altered}),/MAIN_MANUAL_ONLY/);
}
const sources=loadCutoverSources();
const previousSources=loadPreviousSources();
assert.equal(gasSourceBlobSha(previousSources.bootstrapSource),PREVIOUS_BOOTSTRAP_BLOB);
assert.equal(gasSourceBlobSha(previousSources.finalSource),BASE_BLOB);
assert.equal(gasSourceBlobSha(sources.finalSource),FINAL_BLOB);
assert.equal(assertGasReleaseReady(sources.finalSource),'9.282');
assert.throws(()=>assertGasReleaseReady(sources.bootstrapSource),/NOT_APPROVED/);
assert.ok(sources.finalSource.startsWith(previousSources.finalSource));
const alias=sources.finalSource.slice(previousSources.finalSource.length);
assert.equal(alias,'\n// Issue860 editor-only resume; existing drain validation is unchanged.\nfunction issue507ResumeWriters() {\n  return issue507ResumeWriters_();\n}\n');
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
// Reproduce the operational gap on the exact previously published source:
// >50 properties made Settings read-only and no editor input function existed.
const oldEditor=vm.createContext({});vm.runInContext(previousSources.bootstrapSource,oldEditor);
assert.equal(typeof oldEditor.issue860BootstrapPreparePrompt,'undefined');
assert.equal(typeof oldEditor.issue507ResumeWriters,'undefined');
assert.equal(typeof oc.issue507ResumeWriters,'undefined','bootstrap must never expose resume alias');
// Execute the exact final profile. Public alias must retain existing barrier,
// active-receipt and repair-approval checks, without invoking financial APIs.
const finalEditor=triggerFixture(sources.finalSource),fc=finalEditor.context;
const finalProps=fc.PropertiesService.getScriptProperties();
finalProps.getProperties=()=>Object.fromEntries(finalEditor.properties);
let resumeNow=Date.now();fc.Date=class extends Date {static now(){return resumeNow;}};
assert.throws(()=>fc.issue507ResumeWriters(),/GATE_UNINITIALIZED/);
finalEditor.gate({barrierAt:resumeNow});
finalEditor.properties.set('issue507_writer_gate_rollout_v1',JSON.stringify({releaseId:RELEASE,
 oldDeploymentsDisabled:true,externalWritersBlocked:true,editorsBlocked:true,verifiedAt:resumeNow,
 legacyDrainEvidence:{kind:'EXECUTIONS_UI',scope:'ALL_PROJECT_ACTORS_AND_VERSIONS',terminalOnly:true,reference:'fixture-only'}}));
assert.throws(()=>fc.issue507ResumeWriters(),/GATE_NOT_DRAINED/);
resumeNow+=420001;
finalEditor.gate({barrierAt:resumeNow-420001,active:{fixture:{name:'writer',startedAt:resumeNow-1000}}});
assert.throws(()=>fc.issue507ResumeWriters(),/GATE_NOT_DRAINED/);
assert.equal(JSON.parse(finalEditor.properties.get('issue507_writer_gate_v1')).active.fixture.name,'writer');
finalEditor.gate({barrierAt:resumeNow-420001});
finalEditor.properties.set('issue507_f00001_approval_v1','fixture-active-approval');
assert.throws(()=>fc.issue507ResumeWriters(),/GATE_APPROVAL_STILL_LIVE/);
finalEditor.properties.delete('issue507_f00001_approval_v1');
assert.equal(fc.issue507ResumeWriters().mode,'OPEN');
assert.equal(finalEditor.calls.filter(x=>x[0]==='delete'||x[0]==='create').length,0);
function promptFixture(code=sources.bootstrapSource){
 const f=triggerFixture(code),ctx=f.context;let raw='',button='OK',held=false,atPrompt=null,atLock=null;
 const realLocks=ctx.LockService;
 ctx.LockService={getScriptLock:()=>{
  const lock=realLocks.getScriptLock();return {hasLock:()=>held,
   waitLock(){if(atLock){const action=atLock;atLock=null;action();}lock.waitLock();held=true;},releaseLock(){held=false;lock.releaseLock();}};
 }};
 ctx.Utilities={newBlob:s=>({getBytes:()=>Buffer.from(s)})};
 ctx.SpreadsheetApp={getUi:()=>({Button:{OK:'OK'},ButtonSet:{OK_CANCEL:'OK_CANCEL'},prompt(){
  assert.equal(held,false,'prompt must precede lock acquisition');
  if(atPrompt)atPrompt();
  return {getSelectedButton:()=>button,getResponseText:()=>raw};
 }})};
 // No arbitrary property setter, trigger creation or financial API is exposed.
 for(let i=0;i<60;i++)f.properties.set('preserve-'+i,'existing-value-'+i);
 const saved=new Map(f.properties);
 return {f,ctx,saved,beforeLock(action){atLock=action;},input(value,selected='OK',duringPrompt=null){
  raw=typeof value==='string'?value:JSON.stringify(value);button=selected;atPrompt=duringPrompt;
 }};
}
let pf=promptFixture();pf.input(triggerManifest,'CANCEL');
assert.equal(pf.ctx.issue860BootstrapPreparePrompt().cancelled,true);assert.equal(pf.f.calls.length,0);
pf.input('{invalid');assert.throws(()=>pf.ctx.issue860BootstrapPreparePrompt(),/INPUT_JSON/);
pf.input('x'.repeat(8001));assert.throws(()=>pf.ctx.issue860BootstrapPreparePrompt(),/INPUT_CAPACITY/);
pf.input({...triggerManifest,triggers:[]});assert.throws(()=>pf.ctx.issue860BootstrapPreparePrompt(),/MANIFEST/);
assert.equal(pf.f.calls.length,0);
pf.input(triggerManifest,'OK',()=>pf.f.rows.push({...pf.f.rows[0],id:'concurrent-extra'}));
assert.throws(()=>pf.ctx.issue860BootstrapPreparePrompt(),/UI_MANIFEST|INVENTORY_CHANGED/);
assert.equal(pf.f.calls.length,0);
pf=promptFixture();pf.input(triggerManifest);
assert.equal(pf.ctx.issue860BootstrapPreparePrompt().phase,'PREPARED');
assert.equal(pf.f.calls.filter(x=>x[0]==='delete').length,0);
for(const [k,v]of pf.saved)assert.equal(pf.f.properties.get(k),v);
assert.throws(()=>pf.ctx.issue860BootstrapPreparePrompt(),/JOURNAL_EXISTS/);
const attestation=()=>({releaseId:RELEASE,oldDeploymentsDisabled:true,externalWritersBlocked:true,
 editorsBlocked:true,verifiedAt:Date.now(),legacyDrainEvidence:{kind:'EXECUTIONS_UI',
 scope:'ALL_PROJECT_ACTORS_AND_VERSIONS',terminalOnly:true,reference:'independent-fixture-evidence'}});
pf.input(attestation());assert.throws(()=>pf.ctx.issue860BootstrapRolloutPrompt(),/NOT_PAUSED/);
pf.ctx.issue860BootstrapPause();
for(const change of [{externalWritersBlocked:false},{verifiedAt:Date.now()-300001},
 {verifiedAt:Date.now()+3600000},{legacyDrainEvidence:{reference:'missing-kind'}}]){
 pf.input({...attestation(),...change});assert.throws(()=>pf.ctx.issue860BootstrapRolloutPrompt(),/ROLLOUT/);
 assert.equal(pf.f.properties.has('issue507_writer_gate_rollout_v1'),false);
}
pf.input(attestation(),'CANCEL');assert.equal(pf.ctx.issue860BootstrapRolloutPrompt().cancelled,true);
pf.f.fault.save=true;pf.input(attestation());assert.throws(()=>pf.ctx.issue860BootstrapRolloutPrompt(),/save/);
pf.f.fault.save=false;pf.input({...attestation(),unrelatedCredential:'must-not-persist'});
assert.equal(pf.ctx.issue860BootstrapRolloutPrompt().rolloutRecorded,true);
assert.ok(!pf.f.properties.get('issue507_writer_gate_rollout_v1').includes('must-not-persist'));
assert.equal(pf.ctx.issue860BootstrapInitialize().initialized,true);
assert.equal(pf.ctx.issue860BootstrapRestore().phase,'RESTORED');
pf.input(attestation());assert.equal(pf.ctx.issue860BootstrapRolloutPrompt().rolloutRecorded,true);
for(const [k,v]of pf.saved)assert.equal(pf.f.properties.get(k),v);
pf.f.gate({mode:'OPEN'});pf.input(attestation());
const beforeRejected=pf.f.properties.get('issue507_writer_gate_rollout_v1');
assert.throws(()=>pf.ctx.issue860BootstrapRolloutPrompt(),/GATE/);
assert.equal(pf.f.properties.get('issue507_writer_gate_rollout_v1'),beforeRejected);
// A missing post-prompt inventory check must be detected by an actual run.
const mutant=sources.bootstrapSource.replace("if(rows.length!==manifest.triggers.length||manifest.triggers.some(function(t){",
 "if(false&&manifest.triggers.some(function(t){");
const concurrent=promptFixture();concurrent.input(triggerManifest);concurrent.beforeLock(()=>concurrent.f.rows.pop());
assert.throws(()=>concurrent.ctx.issue860BootstrapPreparePrompt(),/INVENTORY_CHANGED/);
assert.equal(concurrent.f.calls.length,0);
const mutation=promptFixture(mutant);mutation.input(triggerManifest);mutation.beforeLock(()=>mutation.f.rows.pop());
assert.equal(mutation.ctx.issue860BootstrapPreparePrompt().phase,'PREPARED','mutant admits incomplete inventory');
// Actual incident: a deferred NAV retry is not part of the 11 permanent jobs.
// Preserve its UID, schedule and business reservation instead of deleting or
// recreating it; all routes are already hard-denied by the bootstrap source.
const deferred={id:'deferred-fixture',handler:'runDeferredFundAfterPortfolioCloseFailure',
 binding:'PRODUCTION',event:'CLOCK',source:'CLOCK',sourceId:null,
 schedule:{kind:'MINUTELY',minutes:10,timezone:'Asia/Seoul'}};
const productionBindingSha256=createHash('sha256').update('TEST_PRODUCTION_DEPLOYMENT').digest('hex');
const preservedManifest=()=>({schema:1,releaseId:RELEASE,operationId:'preserved-fixture',
 uiEvidence:'fixture UI bindings and schedules, not production attestation',productionVersion:337,productionBindingSha256,
 triggers:[...JSON.parse(JSON.stringify(triggerManifest.triggers)).map(t=>({...t,
 binding:t.originalDeployment==='HEAD'?'HEAD':'PRODUCTION'})),JSON.parse(JSON.stringify(deferred))]});
const oldInventory=triggerFixture(previousSources.bootstrapSource);
oldInventory.rows.push({...deferred});
oldInventory.properties.set('issue860_ui_trigger_manifest_v1',JSON.stringify(triggerManifest));
assert.throws(()=>oldInventory.context.issue860BootstrapPrepare(),/INVENTORY_CHANGED/);
assert.equal(oldInventory.calls.length,0);
let preserved=promptFixture();preserved.f.rows.push({...deferred});
preserved.input(preservedManifest(),'CANCEL');
assert.equal(preserved.ctx.issue860BootstrapPreservePrompt().cancelled,true);
preserved.input(preservedManifest(),'OK',()=>preserved.f.rows.push({...deferred,id:'foreign-fixture',handler:'foreignWriter'}));
assert.throws(()=>preserved.ctx.issue860BootstrapPreservePrompt(),/INVENTORY_CHANGED/);
assert.equal(preserved.f.calls.length,0);
preserved=promptFixture();preserved.f.rows.push({...deferred});
let broken=preservedManifest();broken.triggers[11].schedule.minutes=5;
preserved.input(broken);assert.throws(()=>preserved.ctx.issue860BootstrapPreservePrompt(),/PRESERVED_MANIFEST/);
assert.equal(preserved.f.calls.length,0);
const reservation='{"triggerId":"deferred-fixture","date":"2026-11-04","attempts":2,"owner":{"runId":"fixture-owner"}}';
preserved.f.properties.set('portfolio_fund_deferred_schedule_v1',reservation);
const originalRows=JSON.stringify(preserved.f.rows);
preserved.input(preservedManifest());
assert.equal(preserved.ctx.issue860BootstrapPreservePrompt().preservedCount,12);
assert.throws(()=>preserved.ctx.issue860BootstrapPreservePrompt(),/PRESERVED_EXISTS/);
assert.throws(()=>preserved.f.prepare(),/PRESERVED_MODE/);
assert.throws(()=>preserved.ctx.issue860BootstrapPause(),/PRESERVED_MODE/);
assert.throws(()=>preserved.ctx.issue860BootstrapRestore(),/PRESERVED_MODE/);
preserved.ctx.jsonOk=x=>({status:'ok',...x});preserved.ctx.jsonError=message=>({status:'error',message});
preserved.ctx._isAuthorizedRequest=()=>true;
let preservedNow=Date.now();preserved.ctx.Date=class extends Date {static now(){return preservedNow;}};
let pg=()=>preserved.ctx.doGet({parameter:{action:'getWriterGateStatus'}}).writerGate;
assert.equal(pg().firstCutoverAbortReady,true);
assert.equal(pg().preservedTriggers.inventoryUnchanged,true);
assert.equal(pg().preservedTriggers.count,12);
assert.throws(()=>preserved.ctx.issue860BootstrapInitialize(),/ROLLOUT_REQUIRED/);
preserved.input({...attestation(),verifiedAt:preservedNow});
assert.equal(preserved.ctx.issue860BootstrapRolloutPrompt().rolloutRecorded,true);
assert.equal(preserved.ctx.issue860BootstrapInitialize().initialized,true);
const barrier=JSON.parse(preserved.f.properties.get('issue507_writer_gate_v1')).barrierAt;
assert.equal(preserved.ctx.issue860BootstrapInitialize().initialized,false);
assert.equal(JSON.parse(preserved.f.properties.get('issue507_writer_gate_v1')).barrierAt,barrier);
assert.equal(pg().firstCutoverAbortReady===true,false);assert.equal(pg().firstCutoverReady,false);
preservedNow+=420001;assert.equal(pg().firstCutoverReady,true);
assert.equal(preserved.f.properties.get('portfolio_fund_deferred_schedule_v1'),reservation);
assert.equal(JSON.stringify(preserved.f.rows),originalRows);
assert.equal(preserved.f.calls.filter(x=>x[0]==='delete'||x[0]==='create').length,0);
preserved.f.rows[11].id='changed-uid';assert.equal(pg().firstCutoverReady,false);
assert.throws(()=>preserved.ctx.issue860BootstrapInitialize(),/INVENTORY_CHANGED/);
preserved.f.rows[11].id=deferred.id;
preservedNow+=1800001;assert.equal(pg().firstCutoverReady,false);
preserved.input({...attestation(),verifiedAt:preservedNow});
assert.equal(preserved.ctx.issue860BootstrapRolloutPrompt().rolloutRecorded,true);
assert.equal(preserved.ctx.issue860BootstrapRenewBarrier().barrierRenewed,true);
assert.equal(pg().firstCutoverReady,false);preservedNow+=420001;assert.equal(pg().firstCutoverReady,true);
assert.equal(preserved.f.properties.get('portfolio_fund_deferred_schedule_v1'),reservation);
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
  bootstrap:sources.bootstrapSource,previous:previousSources.bootstrapSource,base:previousSources.finalSource,final:sources.finalSource};
 let currentHead=files(code[head]),v=published==='legacy'?336:337,next=338;
 const versions=new Map([[336,files(code.legacy)],[v,files(code[published])]]),calls=[],fault={};
 const rpc={
  async readState(){calls.push('read');return clone({head:{files:currentHead},published:{files:versions.get(v)},
   deployment:{deploymentId:'TEST_PRODUCTION_DEPLOYMENT',deploymentConfig:{versionNumber:v,manifestFileName:'appsscript'}}});},
  async inventory(){calls.push('inventory');if(fault.inventory)throw Error('inventory');},
  async writeContent(f){calls.push('content');currentHead=clone(f);},
  async createVersion(){calls.push('version');const id=next++;versions.set(id,clone(currentHead));
   if(fault.expireDuringVersion)gateState.firstCutoverReady=false;
   return id;},
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
   gate:async()=>{if(fault.gateError)throw Error(fault.gateError);return gateState;},...options});
 }};
}
let f=fixture();assert.equal((await f.run('bootstrap',{dryRun:true,approved:false})).dryRun,true);
f=fixture('previous');f.fault.mainAt=1;
assert.equal((await f.run('inspect',{dryRun:true,approved:false})).readOnly,true);
assert.ok(!f.calls.includes('main'),'GET-only inspect must not be tied to an obsolete main SHA');
assert.ok(!f.calls.some(x=>['content','version','publish'].includes(x)));
f=fixture('previous');f.fault.mainAt=1;
await assert.rejects(f.run('bootstrap',{dryRun:true,approved:false}),/stale main/);
assert.ok(!f.calls.some(x=>['content','version','publish'].includes(x)),
 'mutating phases continue to pin the current main before any write');
f=fixture('previous');await assert.rejects(f.run('finalize'),/BEFORE_SOURCE/);
assert.ok(!f.calls.includes('content'));
f=fixture('previous');assert.equal((await f.run('bootstrap')).deployed,true);
assert.deepEqual(f.calls.filter(x=>['content','version','publish'].includes(x)),['content','version','publish']);
f=fixture('previous');Object.assign(f.gateState,{mode:'UNINITIALIZED',firstCutoverAbortReady:true});
assert.equal((await f.run('abort')).abortedBeforeGate,true);
f=fixture('base');assert.equal((await f.run('finalize')).deployed,true);
f=fixture('base');f.gateState.mode='OPEN';await assert.rejects(f.run('bootstrap'),/DRAIN/);
assert.ok(!f.calls.includes('content'));
f=fixture('bootstrap');f.gateState.preservedTriggers={count:12,productionVersion:336,productionBindingSha256,inventoryUnchanged:true};
assert.equal((await f.run('finalize')).deployed,true);
for(const preservedTriggers of [{count:12,productionBindingSha256:'0'.repeat(64),inventoryUnchanged:true},
 {count:12,productionBindingSha256,inventoryUnchanged:false}]){
 f=fixture('bootstrap');f.gateState.preservedTriggers=preservedTriggers;
 await assert.rejects(f.run('finalize'),/PRESERVED_BINDING/);assert.ok(!f.calls.includes('content'));
}
f=fixture();
assert.ok(!f.calls.includes('content'));
f=fixture();await assert.rejects(f.run('bootstrap',{approved:false}),/APPROVAL/);assert.equal(f.calls.length,0);
f=fixture();assert.equal((await f.run('bootstrap')).deployed,true);
assert.deepEqual(f.calls.filter(x=>['content','version','publish'].includes(x)),['content','version','publish']);
assert.equal((await f.run('bootstrap')).alreadyDeployed,true);
f=fixture('bootstrap');assert.equal((await f.run('finalize')).deployed,true);
assert.equal(f.gateState.mode,'DRAINING');assert.equal((await f.run('finalize')).alreadyDeployed,true);
f=fixture('bootstrap');f.fault.expireDuringVersion=true;
await assert.rejects(f.run('finalize'),/FORWARD_RECOVERY_REQUIRED/);
assert.ok(!f.calls.includes('publish'),'expired readiness must block publication after version creation');
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
f=fixture();f.fault.gateError='ISSUE860_CUTOVER_GATE_AUTH_REJECTED';
await assert.rejects(f.run('bootstrap'),e=>e.message==='ISSUE860_CUTOVER_FORWARD_RECOVERY_REQUIRED'&&
 e.stage==='GATE_READBACK'&&e.causeCode==='ISSUE860_CUTOVER_GATE_AUTH_REJECTED'&&Number.isSafeInteger(e.createdVersion));
f=fixture();f.fault.gateError='PRIVATE_UNTRUSTED_PROVIDER_SECRET';
await assert.rejects(f.run('bootstrap'),e=>e.causeCode==='ISSUE860_CUTOVER_UNVERIFIED'&&!JSON.stringify(e).includes('PRIVATE_UNTRUSTED'));
f=fixture('bootstrap');assert.equal((await f.run('inspect',{dryRun:true,approved:false})).readOnly,true);
assert.ok(!f.calls.some(x=>['content','version','publish'].includes(x)));
await assert.rejects(f.run('inspect'),/INSPECT_READ_ONLY/);
f=fixture('bootstrap');Object.assign(f.gateState,{mode:'UNINITIALIZED',firstCutoverAbortReady:true});
assert.equal((await f.run('abort')).abortedBeforeGate,true);assert.ok(!f.calls.includes('version'));
for(const state of [{mode:'DRAINING',firstCutoverAbortReady:true},{mode:'UNINITIALIZED',firstCutoverAbortReady:false}]){
 f=fixture('bootstrap');Object.assign(f.gateState,state);await assert.rejects(f.run('abort'),/ABORT_NOT_SAFE/);
 assert.ok(!f.calls.includes('content'));
}

const workflow=YAML.parse(fs.readFileSync('.github/workflows/gas-deploy.yml','utf8'));
assert.equal(workflow.on.workflow_dispatch.inputs.first_gate_phase.default,'none');
assert.deepEqual(workflow.on.workflow_dispatch.inputs.first_gate_phase.options,['none','bootstrap','finalize','abort','inspect']);
const steps=workflow.jobs.deploy.steps;
const special=steps.find(s=>s.run==='node scripts/issue860-first-cutover.mjs');
assert.equal(special.if,"env.GAS_FIRST_GATE_PHASE != 'none' && env.GAS_FIRST_GATE_PHASE != 'inspect'");
const inspect=steps.find(s=>s.run==='node scripts/issue507-deployment-inventory-readonly.mjs');
assert.equal(inspect.if,"env.GAS_FIRST_GATE_PHASE == 'inspect' && env.GAS_DEPLOY_DRY_RUN == 'true'");
assert.equal(inspect['continue-on-error'],undefined);
const rejectInspect=steps.find(s=>s.name==='Reject write-enabled inspect');
assert.equal(rejectInspect.if,"env.GAS_FIRST_GATE_PHASE == 'inspect' && env.GAS_DEPLOY_DRY_RUN != 'true'");
assert.equal(special['continue-on-error'],undefined);
for(const name of ['Deploy GAS','Read-only release state before any deployment write'])
 assert.equal(steps.find(s=>s.name===name).if,"env.GAS_FIRST_GATE_PHASE == 'none'");
for(const s of steps.filter(s=>/Activate NH|Verify KRX 37/.test(s.name)))assert.match(s.if,/GAS_FIRST_GATE_PHASE == 'none'/);
assert.equal(workflow.jobs.deploy.environment,'portfolio-production-gas');
assert.match(fs.readFileSync('scripts/deploy-gas.mjs','utf8'),/GAS_FIRST_GATE_CUTOVER_UNVERIFIED/);
console.log('Issue860 first cutover: 555 maintenance denials, auth, pinned phases, drain, immutable readback and forward recovery PASS');
