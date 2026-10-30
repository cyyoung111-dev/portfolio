import assert from 'node:assert/strict';
import fs from 'node:fs';
import YAML from 'yaml';
import {selectGasRelease,assertCurrentMainRelease} from './gas-release-gate.mjs';
import {rollbackGasCode} from './deploy-gas.mjs';

const sha='a'.repeat(40),repository='cyyoung111-dev/portfolio';
const run={name:'quality-check',path:'.github/workflows/quality-check.yml',
  event:'push',conclusion:'success',head_branch:'main',head_repository:{full_name:repository},head_sha:sha};
const input={eventName:'workflow_run',event:{workflow_run:run},ref:'refs/heads/main',repository,sha,enabled:'true'};
assert.equal(selectGasRelease(input).sha,sha);
for(const changes of [{event:'pull_request'},{conclusion:'failure'},{head_branch:'feature'},
  {head_repository:{full_name:'attacker/portfolio'}},{name:'other'},{path:'.github/workflows/other.yml'},
  {head_sha:'invalid'}]){
  assert.throws(()=>selectGasRelease({...input,event:{workflow_run:{...run,...changes}}}));
}
for(const changes of [{enabled:''},{enabled:'false'},{ref:'refs/heads/feature'},
  {ref:'refs/tags/main'},{repository:'attacker/portfolio'},{eventName:'push'}]){
  assert.throws(()=>selectGasRelease({...input,...changes}));
}
assert.equal(selectGasRelease({...input,eventName:'workflow_dispatch'}).automatic,false);
const response=s=>async()=>({ok:true,json:async()=>({object:{sha:s}})});
await assertCurrentMainRelease({sha,fetchImpl:response(sha)});
await assert.rejects(()=>assertCurrentMainRelease({sha,fetchImpl:response('b'.repeat(40))}),/STALE_COMMIT/);
await assert.rejects(()=>assertCurrentMainRelease({sha,fetchImpl:async()=>{throw Error('PRIVATE');}}),/MAIN_UNAVAILABLE/);

const oldFiles=[{name:'appsscript',type:'JSON',source:'{}'},
  {name:'Code',type:'SERVER_JS',source:'OLD'}];
const newFiles=[oldFiles[0],{...oldFiles[1],source:'NEW'}];
for(const published of [false,true]){
  let files=structuredClone(newFiles),version=published?2:1,writes=[];
  const result=await rollbackGasCode({beforeFiles:oldFiles,candidateFiles:newFiles,
    beforeDeployment:{deploymentConfig:{versionNumber:1}},newVersion:2,
    readFiles:async()=>files,writeFiles:async x=>{writes.push('head');files=x;},
    readDeployment:async()=>({deploymentConfig:{versionNumber:version}}),
    writeDeployment:async x=>{writes.push('deployment');version=x.versionNumber;}});
  assert.equal(result.dataWrites,0);assert.deepEqual(files,oldFiles);assert.equal(version,1);
  assert.deepEqual(writes,['head','deployment']);
}
for(const concurrent of ['head','deployment']){
  let writes=0;
  await assert.rejects(()=>rollbackGasCode({beforeFiles:oldFiles,candidateFiles:newFiles,
    beforeDeployment:{deploymentConfig:{versionNumber:1}},newVersion:2,
    readFiles:async()=>concurrent==='head'?[oldFiles[0],{...oldFiles[1],source:'THIRD_PARTY'}]:newFiles,
    readDeployment:async()=>({deploymentConfig:{versionNumber:concurrent==='deployment'?3:2}}),
    writeFiles:async()=>writes++,writeDeployment:async()=>writes++}),/CONCURRENT_CHANGE/);
  assert.equal(writes,0,'concurrent changes must be preserved before any rollback write');
}
const source=fs.readFileSync('.github/workflows/gas-deploy.yml','utf8');
function checkReleaseCoverage(quality){
  assert.deepEqual(quality.on.push.branches,['main']);
  assert.equal(quality.on.push.paths,undefined,'every main push needs a release check');
  assert.equal(quality.on.push['paths-ignore'],undefined);
}
function checkWorkflow(source){
  const doc=YAML.parseDocument(source,{uniqueKeys:true});assert.equal(doc.errors.length,0);
  const workflow=doc.toJS();
  assert.deepEqual(workflow.on.workflow_run,{workflows:['quality-check'],types:['completed'],branches:['main']});
  assert.deepEqual(workflow.permissions,{contents:'read'});
  const deploy=workflow.jobs.deploy,validate=workflow.jobs.validate;
  assert.match(deploy.if,/github.ref == 'refs\/heads\/main'/);
  assert.match(deploy.if,/vars.GAS_AUTO_DEPLOY_ENABLED == 'true'/);
  for(const condition of ["conclusion == 'success'","event == 'push'","head_branch == 'main'",'head_repository.full_name == github.repository'])
    assert.ok(deploy.if.includes(condition));
  assert.equal(deploy.environment,'portfolio-production-gas');assert.equal(deploy.needs,'validate');
  assert.equal(deploy.steps[0].with.ref,'$'+'{{ needs.validate.outputs.sha }}');
  assert.equal(deploy.env.GAS_EXPECTED_MAIN_SHA,'$'+'{{ needs.validate.outputs.sha }}');
  assert.equal(deploy.concurrency['cancel-in-progress'],false);
  // Last proven successful production source, never merely HEAD's first parent.
  const sourceStep=validate.steps.find(step=>step.id==='gas_source');
  assert.ok(sourceStep,'proven deployment source preflight is required');
  assert.equal(sourceStep.if,"github.event_name == 'workflow_run'");
  assert.equal(sourceStep.run,'node scripts/gas-auto-deploy-eligibility.mjs');
  assert.match(JSON.stringify(sourceStep.env),/github.token/);
  assert.match(JSON.stringify(sourceStep.env),/github.repository/);
  assert.match(JSON.stringify(sourceStep.env),/github.run_id/);
  const expr=String.fromCharCode(36,123,123)+' steps.gas_source.outputs.changed '+String.fromCharCode(125,125);
  assert.equal(validate.outputs.auto_source_changed,expr);
  assert.match(deploy.if,/needs\.validate\.outputs\.auto_source_changed == 'true'/);
  for(const stepName of ['Install dependencies','Full release checks']){
    const step=validate.steps.find(x=>x.name===stepName);
    assert.match(step.if,/steps\.gas_source\.outputs\.changed == 'true'/);
    assert.match(step.if,/github\.event_name != 'workflow_run'/);
  }
  assert.ok(validate.steps.some(s=>s.run==='node scripts/gas-release-gate.mjs'));
  assert.ok(validate.steps.some(s=>s.run==='npm run check:ci'));
  assert.ok(!JSON.stringify(validate).includes('secrets.CLASPRC_JSON'));
  const quality=YAML.parse(fs.readFileSync('.github/workflows/quality-check.yml','utf8'));
  checkReleaseCoverage(quality);
}
checkWorkflow(source);
{
  const quality=YAML.parse(fs.readFileSync('.github/workflows/quality-check.yml','utf8'));
  quality.on.push.paths=['src/gas/apps_script.gs'];
  assert.throws(()=>checkReleaseCoverage(quality));
}
for(const [before,after] of [
  ["needs.validate.outputs.auto_source_changed == 'true'","true"],
  ["node scripts/gas-auto-deploy-eligibility.mjs","echo changed=false"],
  ["vars.GAS_AUTO_DEPLOY_ENABLED == 'true'","true"],
    ["head_branch == 'main'","head_branch != 'main'"],['portfolio-production-gas','other'],
  ['npm run check:ci','npm run check:gas']]){
  assert.throws(()=>checkWorkflow(source.replaceAll(before,after)));
}
console.log('GAS opt-in trusted main release, stale SHA rejection and scoped code rollback: PASS');

// Actual deploy diagnostic path: OAuth exchange + GET only, no source/version/deployment writes.
{
 const {deploy,inspectGasReleaseState,summarizeGasReleaseFailure}=await import('./deploy-gas.mjs');
 const gas=fs.readFileSync('src/gas/apps_script.gs','utf8');
 assert.equal(inspectGasReleaseState({headSource:gas,publishedSource:gas}).head.approved,true);
 const report=inspectGasReleaseState({headSource:gas+'\nPRIVATE',publishedSource:'PRIVATE'});
 assert.equal(report.head.approved,false);assert.equal(report.published.approved,false);assert.ok(!JSON.stringify(report).includes('PRIVATE'));
 assert.deepEqual(summarizeGasReleaseFailure({httpStatus:400,providerStatus:'INVALID_ARGUMENT',syntaxLine:123,message:'PRIVATE_URL_TOKEN'},'CONTENT_WRITE'),
  {mode:'GAS_RELEASE_FAILURE',stage:'CONTENT_WRITE',failureCode:'UNKNOWN',httpStatus:400,providerStatus:'INVALID_ARGUMENT',providerReason:'UNKNOWN',syntaxLine:123});
 assert.ok(!JSON.stringify(summarizeGasReleaseFailure({httpStatus:'PRIVATE',providerStatus:'PRIVATE',syntaxLine:Infinity},'PRIVATE')).includes('PRIVATE'));
 assert.equal(summarizeGasReleaseFailure(new Error('AUTOMATION_DIAG_BAD_TRIGGER'),'AUTOMATION_VERIFY').failureCode,'AUTOMATION_DIAG_BAD_TRIGGER');
 assert.equal(summarizeGasReleaseFailure(new Error('deployment version 검증 실패: expected=323, observed=322'),'DEPLOYMENT_READBACK').failureCode,'DEPLOYMENT_VERSION_MISMATCH');
 assert.equal(summarizeGasReleaseFailure(new Error('AUTOMATION_DIAG_BAD_TRIGGER PRIVATE'),'AUTOMATION_VERIFY').failureCode,'UNKNOWN');
 const previousFetch=globalThis.fetch,previousEnv={...process.env},previousLog=console.log;const calls=[];
 const files=[{name:'appsscript',type:'JSON',source:'{}'},{name:'Code',type:'SERVER_JS',source:gas}];
 try {
  Object.assign(process.env,{GAS_SCRIPT_ID:'TEST',GAS_WEB_APP_URL:'https://script.google.com/macros/s/TEST/exec',GAS_DEPLOYMENT_ID:'TEST',GAS_DEPLOY_DIAGNOSTIC_ONLY:'true',
   CLASPRC_JSON:JSON.stringify({client_id:'TEST',client_secret:'TEST',refresh_token:'TEST'})});
  delete process.env.GAS_EXPECTED_MAIN_SHA;delete process.env.GITHUB_ACTIONS;
  console.log=()=>{};
  globalThis.fetch=async(url,options={})=>{
   const u=new URL(url),method=options.method||'GET';calls.push({host:u.host,method});
   let data;
   if(u.host==='oauth2.googleapis.com')data={access_token:'TEST'};
   else {assert.equal(method,'GET');data=u.pathname.endsWith('/deployments/TEST')?{deploymentConfig:{versionNumber:1},entryPoints:[{entryPointType:'WEB_APP'}]}:{files};}
   return{ok:true,text:async()=>JSON.stringify(data)};
  };
  const r=await deploy();assert.equal(r.mode,'READ_ONLY_GAS_RELEASE_STATE');assert.equal(r.dataWrites,0);
  assert.equal(calls.filter(c=>c.host==='script.googleapis.com').length,3);
  assert.ok(calls.filter(c=>c.host==='script.googleapis.com').every(c=>c.method==='GET'));
 }finally{globalThis.fetch=previousFetch;console.log=previousLog;for(const k of Object.keys(process.env))if(!(k in previousEnv))delete process.env[k];Object.assign(process.env,previousEnv);}
}
console.log('PASS: actual release diagnosis has no project writes; approved-source state and safe bounded failure reports');
