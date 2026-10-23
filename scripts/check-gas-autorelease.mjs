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
  assert.ok(validate.steps.some(s=>s.run==='node scripts/gas-release-gate.mjs'));
  assert.ok(validate.steps.some(s=>s.run==='npm run check:ci'));
  assert.ok(!JSON.stringify(validate).includes('secrets.CLASPRC_JSON'));
  const quality=YAML.parse(fs.readFileSync('.github/workflows/quality-check.yml','utf8'));
  for(const path of ['src/gas/apps_script.gs','scripts/deploy-gas.mjs','scripts/gas-release-gate.mjs'])
    assert.ok(quality.on.push.paths.includes(path));
}
checkWorkflow(source);
for(const [before,after] of [["vars.GAS_AUTO_DEPLOY_ENABLED == 'true'","true"],
  ["head_branch == 'main'","head_branch != 'main'"],['portfolio-production-gas','other'],
  ['npm run check:ci','npm run check:gas']]){
  assert.throws(()=>checkWorkflow(source.replaceAll(before,after)));
}
console.log('GAS opt-in trusted main release, stale SHA rejection and scoped code rollback: PASS');
