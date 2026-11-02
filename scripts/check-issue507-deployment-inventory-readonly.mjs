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
function setup(pages,details={}){
 const calls=[];
 const fetchImpl=async(url,options)=>{
  calls.push({url,options});
  assert.equal(options.method,'GET');
  assert.equal(options.headers.Authorization,'Bearer '+secret);
  assert.equal(options.redirect,'error');
  const parsed=new URL(url),p=parsed.searchParams.get('pageToken')||'';
  const match=parsed.pathname.match(/\/deployments\/([^/]+)$/);
  const value=match?details[decodeURIComponent(match[1])]:pages[p];
  if(!value)throw Error('PRIVATE_UNEXPECTED_FETCH_URL');
  return {ok:true,status:200,text:async()=>JSON.stringify(value)};
 };
 return {calls,run:(opts={})=>inspectGasDeploymentsReadOnly({
  scriptId,expectedDeploymentId,googleAccessToken:secret,fetchImpl,...opts})};
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
const headOnly={deploymentId:'HEAD'};
const withAutoHead=setup({'':{deployments:[
 headOnly,item(expectedDeploymentId)]}});
result=await withAutoHead.run();
assert.equal(result.status,'INVENTORY_ONLY');
assert.equal(result.headDeploymentCount,1);
assert.equal(result.deploymentCount,2);
assert.equal(result.unverifiedVersionedDeploymentCount,0);
assert.equal(result.additionalRoutableDeploymentCount,0);
assert.equal(result.releaseAuthorized,false);
assert.equal(result.allActorsAndVersionsTerminatedVerified,false);
// HEAD with a publicly routable entry point is not automatically exempt.
const headRoutable=setup({'':{deployments:[
 {...headOnly,entryPoints:[{entryPointType:'WEB_APP'}]},
 item(expectedDeploymentId)]}});
result=await headRoutable.run();
assert.equal(result.status,'BLOCKED');
assert.equal(result.reason,'ADDITIONAL_DEPLOYMENTS_REQUIRE_ISOLATION');
assert.equal(result.headDeploymentCount,1);
// A repeated field omitted for an empty list is still blocked (not approved).
result=await setup({'':{}}).run();
assert.equal(result.status,'BLOCKED');
assert.equal(result.reason,'EXPECTED_DEPLOYMENT_NOT_PROVEN');
const blankHeadConfig=setup({'':{deployments:[
 {deploymentId:'HEAD',deploymentConfig:{versionNumber:0},entryPoints:[]},
 item(expectedDeploymentId)]}});
assert.equal((await blankHeadConfig.run()).status,'INVENTORY_ONLY');
// Some legacy/archived deployments lack positive version metadata in LIST.
// Finish listing and count every entry, but never permit a writer cutover.
for(const badVersion of [undefined,0,-1,'336',null]){
 const id='OLD_MISSING_VERSION_DEPLOYMENT_123';
 const d=item(id,['EXECUTION_API']);
 if(badVersion===undefined)delete d.deploymentConfig.versionNumber;
 else d.deploymentConfig.versionNumber=badVersion;
 const t=setup({'':{deployments:[item(expectedDeploymentId),d]}});
 const out=await t.run();
 assert.equal(out.status,'BLOCKED');
 assert.equal(out.reason,'VERSION_METADATA_UNVERIFIED');
 assert.equal(out.unverifiedVersionedDeploymentCount,1);
 assert.equal(out.deploymentCount,2);
 assert.equal(out.additionalRoutableDeploymentCount,1);
 assert.equal(out.executionApiEntryCount,1);
 assert.equal(out.releaseAuthorized,false);
 assert.equal(out.allActorsAndVersionsTerminatedVerified,false);
 assert.ok(!JSON.stringify(out).includes(id));
}
const missingVersionPage=setup({
 '':{deployments:[item(expectedDeploymentId),{
  ...item('ARCHIVED_NO_VERSION'),deploymentConfig:{}}],nextPageToken:'SECOND'},
 SECOND:{deployments:[item('ADDITIONAL_VERSIONED_WEB_APP')]}
});
const missingVersionReport=await missingVersionPage.run();
assert.equal(missingVersionReport.status,'BLOCKED');
assert.equal(missingVersionReport.reason,'VERSION_METADATA_UNVERIFIED');
assert.equal(missingVersionReport.pagesRead,2);
assert.equal(missingVersionReport.deploymentCount,3);
assert.equal(missingVersionReport.unverifiedVersionedDeploymentCount,1);
assert.equal(missingVersionReport.additionalRoutableDeploymentCount,2);
const missingExpectedVersion=item(expectedDeploymentId);
delete missingExpectedVersion.deploymentConfig.versionNumber;
const expectedMissing=await setup({'':{deployments:[missingExpectedVersion]}}).run();
assert.equal(expectedMissing.status,'BLOCKED');
assert.equal(expectedMissing.reason,'VERSION_METADATA_UNVERIFIED');
assert.equal(expectedMissing.expectedDeploymentFound,true);
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
// Four real WEB_APP entries (one LIST-version absent) require independent
// GET-only detail confirmation; recovering a GET version CANNOT clear blockers.
const legacyA='EXTRA_DEPLOYMENT_A_001',legacyB='EXTRA_DEPLOYMENT_B_001',
 legacyC='EXTRA_DEPLOYMENT_C_001';
const listed=[
 item(expectedDeploymentId),item(legacyA),item(legacyB),item(legacyC)
];
delete listed[2].deploymentConfig.versionNumber;
const detailRows=Object.fromEntries([
 [expectedDeploymentId,item(expectedDeploymentId)],
 [legacyA,item(legacyA)],
 [legacyB,item(legacyB)],
 [legacyC,item(legacyC)]
]);
const deep=setup({'':{deployments:listed}},detailRows);
const details=await deep.run({verifyDetails:true});
assert.equal(details.status,'BLOCKED');
assert.equal(details.reason,'VERSION_METADATA_UNVERIFIED');
assert.equal(details.deploymentCount,4);
assert.equal(details.webAppEntryCount,4);
assert.equal(details.unverifiedVersionedDeploymentCount,1);
assert.equal(details.additionalRoutableDeploymentCount,3);
assert.equal(details.detailVerificationAttempted,true);
assert.equal(details.detailGetRequestedCount,4);
assert.equal(details.detailGetCheckedCount,4);
assert.equal(details.detailVersionRecoveredCount,1);
assert.equal(details.detailGetUnverifiedCount,0);
assert.equal(details.detailVersionConflictCount,0);
assert.equal(details.detailEntryPointMismatchCount,0);
assert.equal(details.releaseAuthorized,false);
assert.equal(details.allActorsAndVersionsTerminatedVerified,false);
assert.equal(deep.calls.length,5);
for(const x of [expectedDeploymentId,legacyA,legacyB,legacyC,secret,
 'PRIVATE_WEBAPP_URL','PRIVATE_DEPLOYMENT_DESCRIPTION']){
 assert.ok(!JSON.stringify(details).includes(x),'private metadata not in audit');
}
const detailFail=setup({'':{deployments:[item(expectedDeploymentId)]}});
const dFail=await detailFail.run({verifyDetails:true});
assert.equal(dFail.status,'BLOCKED');
assert.equal(dFail.reason,'DETAIL_METADATA_UNVERIFIED');
assert.equal(dFail.detailGetRequestedCount,1);
assert.equal(dFail.detailGetUnverifiedCount,1);
assert.equal(dFail.releaseAuthorized,false);
const mismatch=setup({'':{deployments:[item(expectedDeploymentId)]}},
 {[expectedDeploymentId]:item(expectedDeploymentId,['EXECUTION_API'])});
const dMismatch=await mismatch.run({verifyDetails:true});
assert.equal(dMismatch.status,'BLOCKED');
assert.equal(dMismatch.detailEntryPointMismatchCount,1);
const verMismatch=setup({'':{deployments:[item(expectedDeploymentId)]}},
 {[expectedDeploymentId]:{...item(expectedDeploymentId),
  deploymentConfig:{versionNumber:337}}});
const dVersion=await verMismatch.run({verifyDetails:true});
assert.equal(dVersion.status,'BLOCKED');
assert.equal(dVersion.detailVersionConflictCount,1);
const detailMissingVersion=item(expectedDeploymentId);
delete detailMissingVersion.deploymentConfig.versionNumber;
const vFail=setup({'':{deployments:[item(expectedDeploymentId)]}},
 {[expectedDeploymentId]:detailMissingVersion});
const dNoVersion=await vFail.run({verifyDetails:true});
assert.equal(dNoVersion.status,'BLOCKED');
assert.equal(dNoVersion.detailVersionStillUnverifiedCount,1);
const idMismatch=setup({'':{deployments:[item(expectedDeploymentId)]}},
 {[expectedDeploymentId]:item(legacyA)});
const dId=await idMismatch.run({verifyDetails:true});
assert.equal(dId.status,'BLOCKED');
assert.equal(dId.detailGetUnverifiedCount,1);
assert.equal(dId.releaseAuthorized,false);
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
for(const [payload,reason] of [
 [{deployments:[item(expectedDeploymentId),item(expectedDeploymentId)]},
  'SCHEMA_DUPLICATE_ID_UNVERIFIED'],
 [{deployments:[{...item(expectedDeploymentId),entryPoints:null}]},
  'SCHEMA_ENTRY_POINTS_UNVERIFIED'],
 [{deployments:[{...item(expectedDeploymentId),deploymentId:'SHORT'}]},
  'SCHEMA_ID_UNVERIFIED'],
 [{deployments:{private:'PRIVATE_FAKE'}},
  'SCHEMA_LIST_UNVERIFIED'],
 [{deployments:[item(expectedDeploymentId)],nextPageToken:'LOOP'},
  'PAGINATION_UNVERIFIED']
]){
 const t=setup({'':payload,LOOP:{deployments:[],nextPageToken:'LOOP'}});
 await assert.rejects(t.run(),new RegExp('ISSUE507_DEPLOYMENT_INVENTORY_'+reason));
}
for(const payload of [
 {deployments:[item(expectedDeploymentId),item(expectedDeploymentId)]},
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
assert.match(runner,/googleAccessToken:token,verifyDetails:true/,
 'manual main audit must conduct detail GET-only verification');
assert.match(runner,/detailGetUnverifiedCount/);
assert.doesNotMatch(runner,/method:'POST'|method:'PUT'|method:'DELETE'/);
console.log('Issue507 GAS deployment inventory GET-only, pagination, redaction, fail-closed: PASS');
