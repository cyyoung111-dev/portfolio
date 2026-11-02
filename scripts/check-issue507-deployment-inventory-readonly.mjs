import assert from 'node:assert/strict';
import fs from 'node:fs';
import YAML from 'yaml';
import {inspectGasDeploymentsReadOnly} from './issue507-deployment-inventory-readonly.mjs';

const scriptId='TEST_SCRIPT_IDENTIFIER_12345';
const expectedDeploymentId='TEST_EXPECTED_DEPLOYMENT_123';
const secret='PRIVATE_TOKEN_NOT_FOR_LOGS_1234';
const item=(id,types=['WEB_APP'])=>({
 deploymentId:id,deploymentConfig:{versionNumber:336},
 entryPoints:types.map(entryPointType=>({entryPointType,
  webApp:{url:'https://example.invalid/PRIVATE_WEBAPP_URL'}})),
 description:'PRIVATE_DEPLOYMENT_DESCRIPTION'
});
function setup(pages){
 const calls=[];
 const fetchImpl=async(url,options)=>{
  calls.push({url,options});
  assert.equal(options.method,'GET');
  assert.equal(options.headers.Authorization,'Bearer '+secret);
  assert.equal(options.redirect,'error');
  const p=new URL(url).searchParams.get('pageToken')||'';
  const value=pages[p];
  if(!value)throw Error('PRIVATE_UNEXPECTED_FETCH_URL');
  return {ok:true,status:200,text:async()=>JSON.stringify(value)};
 };
 return {calls,run:()=>inspectGasDeploymentsReadOnly({
  scriptId,expectedDeploymentId,googleAccessToken:secret,fetchImpl})};
}
const single=setup({'':{deployments:[item(expectedDeploymentId)]}});
let result=await single.run();
assert.equal(result.status,'INVENTORY_ONLY');
assert.equal(result.reason,'LEGACY_EXECUTION_AND_EXTERNAL_WRITER_ISOLATION_UNVERIFIED');
assert.equal(result.releaseAuthorized,false);
assert.equal(result.deploymentCount,1);
assert.equal(result.expectedDeploymentFound,true);
assert.equal(result.inventoryComplete,true);
assert.equal(result.allActorsAndVersionsTerminatedVerified,false);
assert.equal(result.externalSheetsWritersExcludedVerified,false);
assert.equal(result.gasWrites,0);
assert.equal(single.calls.length,1);
assert.ok(!JSON.stringify(result).includes(expectedDeploymentId));
assert.ok(!JSON.stringify(result).includes('PRIVATE_'));
assert.ok(!JSON.stringify(result).includes(scriptId));
const second=setup({'':{deployments:[item(expectedDeploymentId)],
 nextPageToken:'SECOND'},SECOND:{deployments:[item('OLD_DEPLOYMENT_ID_123',['EXECUTION_API'])]}});
result=await second.run();
assert.equal(result.status,'BLOCKED');
assert.equal(result.reason,'ADDITIONAL_DEPLOYMENTS_REQUIRE_ISOLATION');
assert.equal(result.additionalRoutableDeploymentCount,1);
assert.equal(result.pagesRead,2);
assert.equal(result.executionApiEntryCount,1);
assert.equal(second.calls.length,2);
assert.equal(new URL(second.calls[1].url).searchParams.get('pageToken'),'SECOND');
assert.ok(!JSON.stringify(result).includes('OLD_DEPLOYMENT_ID_123'));
for(const payload of [
 {deployments:[]},
 {deployments:[item(expectedDeploymentId),item('OLD_EXTRA_WEB_APP_ID')]},
 {deployments:[item(expectedDeploymentId,['UNRECOGNIZED'])]},
 {deployments:[item(expectedDeploymentId,[])]}
]){
 const t=setup({'':payload}),out=await t.run();
 assert.equal(out.status,'BLOCKED');
 assert.equal(out.releaseAuthorized,false);
}
for(const payload of [
 {deployments:[item(expectedDeploymentId),item(expectedDeploymentId)]},
 {deployments:[{...item(expectedDeploymentId),deploymentConfig:{versionNumber:'336'}}]},
 {deployments:[{...item(expectedDeploymentId),entryPoints:null}]},
 {deployments:'PRIVATE_FAKE'},
 {deployments:[item(expectedDeploymentId)],nextPageToken:'LOOP'}
]){
 const t=setup({'':payload,LOOP:{deployments:[],nextPageToken:'LOOP'}});
 await assert.rejects(t.run(),/ISSUE507_DEPLOYMENT_INVENTORY_/);
}
await assert.rejects(inspectGasDeploymentsReadOnly({
 scriptId:'',expectedDeploymentId,googleAccessToken:secret}),
 /ISSUE507_DEPLOYMENT_INVENTORY_CONFIG_UNVERIFIED/);
await assert.rejects(inspectGasDeploymentsReadOnly({
 scriptId,expectedDeploymentId,googleAccessToken:'INVALID'}),
 /ISSUE507_DEPLOYMENT_INVENTORY_CONFIG_UNVERIFIED/);
for(const status of [401,403,500]){
 await assert.rejects(inspectGasDeploymentsReadOnly({
  scriptId,expectedDeploymentId,googleAccessToken:secret,
  fetchImpl:async()=>({ok:false,status})
 }),/ISSUE507_DEPLOYMENT_INVENTORY_(PERMISSION|HTTP)_UNVERIFIED/);
}
const wf=fs.readFileSync('.github/workflows/issue507-deployment-inventory-readonly.yml','utf8');
const doc=YAML.parse(wf);
assert.ok(Object.hasOwn(doc.on||{},'workflow_dispatch'),
 'YAML workflow_dispatch without inputs is intentionally null');
assert.equal(Object.keys(doc.on).length,1,'no schedule, push or PR authenticated triggers');
assert.equal(doc.permissions.contents,'read');
assert.equal(doc.jobs.audit.environment,'portfolio-production-gas');
assert.equal(doc.jobs.audit.if,"github.ref == 'refs/heads/main' && github.event_name == 'workflow_dispatch'");
assert.equal(doc.jobs.audit.concurrency.group,'gas-production-deploy');
assert.equal(doc.jobs.audit.concurrency['cancel-in-progress'],false);
const yaml=JSON.stringify(doc.jobs.audit);
assert.match(yaml,/secrets\.CLASPRC_JSON/);
assert.doesNotMatch(yaml,/GAS_ACCESS_TOKEN|NHPLUG|write|deploy-gas\.mjs|scripts\.run/);
assert.match(yaml,/scripts\/issue507-deployment-inventory-readonly\.mjs/);
// Regress live workflow #41453599853: repository intentionally lacks
// package-lock.json; unconditional npm ci aborts before the GET-only audit.
const installer=doc.jobs.audit.steps.find(step=>step.name==='Install offline schema validator');
assert.ok(installer&&typeof installer.run==='string');
assert.match(installer.run,/if \[ -f package-lock\.json \]; then/);
assert.match(installer.run,/npm ci --ignore-scripts/);
assert.match(installer.run,/npm install --no-package-lock --no-audit --no-fund --ignore-scripts/);
assert.doesNotMatch(installer.run,/npm install[^\n]*--dangerously-allow-all-scripts/);
const runner=fs.readFileSync('scripts/issue507-deployment-inventory-readonly.mjs','utf8');
assert.match(runner,/method:'GET'/);
assert.doesNotMatch(runner,/method:\s*'PUT'|method:\s*'DELETE'/);
assert.ok(!runner.includes('releaseAuthorized:true'));
console.log('Issue507 GAS deployment inventory GET-only, pagination, redaction, fail-closed: PASS');
