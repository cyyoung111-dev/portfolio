import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import YAML from 'yaml';
import {scanDeploymentReferences,loadTrackedRuntimeSources} from './issue507-deployment-reference-analysis.mjs';
import {inspectGasDeploymentsReadOnly,
 inspectUnreviewedGasSourceSignals} from './issue507-deployment-inventory-readonly.mjs';
import {composeIssue860Gas9291Preview} from './compose-issue860-gas9291-preview.mjs';
import {composeIssue860Gas9292CloseStatePreview} from './compose-issue860-gas9292-close-state-preview.mjs';
import {composeIssue734Gas9293OrphanedClosePreview} from './compose-issue734-gas9293-orphaned-close-preview.mjs';
import {composeIssue734Gas9294OwnerNavPreview} from './compose-issue734-gas9294-owner-nav-preview.mjs';

const scriptId='TEST_SCRIPT_IDENTIFIER_12345';
const expectedDeploymentId='TEST_EXPECTED_DEPLOYMENT_123';
const secret='PRIVATE_TOKEN_NOT_FOR_LOGS_1234';
const item=(id,types=['WEB_APP'])=>({
 deploymentId:id,deploymentConfig:{versionNumber:336},
 entryPoints:types.map(entryPointType=>({entryPointType,
  webApp:{url:'https://example.invalid/PRIVATE_WEBAPP_URL'}})),
 description:'PRIVATE_DEPLOYMENT_DESCRIPTION'
});
function setup(pages,details={},versions={}){
 const calls=[];
 const fetchImpl=async(url,options)=>{
  calls.push({url,options});
  assert.equal(options.method,'GET');
  assert.equal(options.headers.Authorization,'Bearer '+secret);
  assert.equal(options.redirect,'error');
  const parsed=new URL(url),p=parsed.searchParams.get('pageToken')||'';
  const match=parsed.pathname.match(/\/deployments\/([^/]+)$/);
  const value=parsed.pathname.endsWith('/content')
   ?versions[parsed.searchParams.get('versionNumber')]
   :match?details[decodeURIComponent(match[1])]:pages[p];
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
// #860: v335 UI description is a non-authorizing, privacy-safe triage hint.
// A matching LABEL, even with consistent LIST/DETAIL, never proves a URL
// is archived or makes a stateful gate cutover safe.
const archived335=item('ARCHIVED_335_ID_123');
archived335.deploymentConfig={description:'GitHub 878709c0731d · GAS v9.280'};
const archived335Audit=await setup(
 {'':{deployments:[item(expectedDeploymentId),archived335]}},
 {ARCHIVED_335_ID_123:archived335}
).run({verifyDetails:true});
assert.equal(archived335Audit.archivedV335DescriptionHintCount,1);
assert.equal(archived335Audit.archivedV335IdentityVerified,false);
assert.equal(archived335Audit.unverifiedVersionedDeploymentCount,1);
assert.equal(archived335Audit.additionalRoutableDeploymentCount,1);
assert.equal(archived335Audit.reason,'VERSION_METADATA_UNVERIFIED');
assert.equal(archived335Audit.status,'BLOCKED');
assert.equal(archived335Audit.releaseAuthorized,false);
assert.equal(archived335Audit.gasWrites,0);
assert.equal(archived335Audit.financeWrites,0);
assert.ok(!JSON.stringify(archived335Audit).includes('878709c0731d'));
assert.ok(!JSON.stringify(archived335Audit).includes('ARCHIVED_335_ID_123'));
const changedArchiveLabel={...archived335,
 deploymentConfig:{description:'Different archive description'}};
const changedAudit=await setup(
 {'':{deployments:[item(expectedDeploymentId),archived335]}},
 {ARCHIVED_335_ID_123:changedArchiveLabel}
).run({verifyDetails:true});
assert.equal(changedAudit.archivedV335DescriptionHintCount,0);
assert.equal(changedAudit.status,'BLOCKED');
// Missing description, versioned records, and missing DETAIL are never hints.
const unknown335=await setup({'':{deployments:[item(expectedDeploymentId),
 {...archived335,deploymentConfig:{}}]}}).run();
assert.equal(unknown335.archivedV335DescriptionHintCount,0);
assert.equal(unknown335.releaseAuthorized,false);
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
assert.equal(details.webAppSecurityInspectedCount,4);
assert.equal(details.webAppUnknownAccessCount,4);
assert.equal(details.webAppUnknownExecuteAsCount,4);
assert.equal(details.additionalWebAppUnknownSecurityCount,3);
// Access mode and execution principal are independent and must both be
// counted from authenticated GET metadata, not guessed from URL or LIST.
function configuredWebApp(id,access,executeAs){
 const d=item(id);
 d.entryPoints[0].webApp.entryPointConfig={access,executeAs};
 return d;
}
const secureDetails={
 [expectedDeploymentId]:configuredWebApp(expectedDeploymentId,'MYSELF','USER_DEPLOYING'),
 [legacyA]:configuredWebApp(legacyA,'ANYONE_ANONYMOUS','USER_DEPLOYING'),
 [legacyB]:configuredWebApp(legacyB,'DOMAIN','USER_ACCESSING'),
 [legacyC]:configuredWebApp(legacyC,'ANYONE','USER_ACCESSING')
};
const secureAudit=await setup({'':{deployments:listed}},secureDetails)
 .run({verifyDetails:true});
assert.equal(secureAudit.status,'BLOCKED');
assert.equal(secureAudit.reason,'VERSION_METADATA_UNVERIFIED');
assert.equal(secureAudit.webAppSecurityInspectedCount,4);
assert.equal(secureAudit.webAppAccessMyselfCount,1);
assert.equal(secureAudit.webAppAccessDomainCount,1);
assert.equal(secureAudit.webAppAccessSignedInCount,1);
assert.equal(secureAudit.webAppAccessAnonymousCount,1);
assert.equal(secureAudit.webAppExecuteAsDeployerCount,2);
assert.equal(secureAudit.webAppExecuteAsAccessingCount,2);
assert.equal(secureAudit.webAppUnknownAccessCount,0);
assert.equal(secureAudit.webAppUnknownExecuteAsCount,0);
assert.equal(secureAudit.additionalWebAppAnonymousCount,1);
assert.equal(secureAudit.additionalWebAppSignedInCount,1);
assert.equal(secureAudit.additionalWebAppExecuteAsDeployerCount,1);
assert.equal(secureAudit.additionalWebAppAnonymousDeployerCount,1);
assert.equal(secureAudit.additionalWebAppUnknownSecurityCount,0);
assert.equal(secureAudit.releaseAuthorized,false);
// A live Google UI Test deployments ID was independently matched to the API
// versionless 1970 WEB_APP, and only its exact project+ID fingerprint is trusted.
// These synthetic cases must never whitelist other versionless deployments.
const syntheticHeadId='AKfySyntheticHead_0123456789abcdef';
const testHeadFingerprint=createHash('sha256').update(
 scriptId+'/'+syntheticHeadId).digest('hex');
const syntheticHead={deploymentId:syntheticHeadId,
 deploymentConfig:{scriptId,manifestFileName:'appsscript'},
 updateTime:'1970-01-01T00:00:00Z',
 entryPoints:[{entryPointType:'WEB_APP',webApp:{
  url:'https://script.google.com/macros/s/'+syntheticHeadId+'/exec',
  entryPointConfig:{access:'ANYONE_ANONYMOUS',executeAs:'USER_DEPLOYING'}}}]};
const headProofSetup=(listedHead=syntheticHead,detailHead=listedHead)=>setup(
 {'':{deployments:[item(expectedDeploymentId),listedHead]}},
 {[expectedDeploymentId]:configuredWebApp(expectedDeploymentId,'MYSELF','USER_DEPLOYING'),
  [listedHead.deploymentId]:detailHead});
const trustedProof=headProofSetup();
const headProof=await trustedProof.run({
 verifyDetails:true,verifiedHeadFingerprint:testHeadFingerprint});
assert.equal(headProof.status,'INVENTORY_ONLY');
assert.equal(headProof.headDeploymentCount,1);
assert.equal(headProof.verifiedTestHeadCount,1);
assert.equal(headProof.deploymentCount,2);
assert.equal(headProof.webAppEntryCount,2);
assert.equal(headProof.additionalRoutableDeploymentCount,0);
assert.equal(headProof.unverifiedVersionedDeploymentCount,0);
assert.equal(headProof.detailVersionStillUnverifiedCount,0);
assert.equal(headProof.detailVersionRecoveredCount,0);
assert.equal(headProof.additionalWebAppAnonymousDeployerCount,0);
assert.equal(headProof.releaseAuthorized,false);
assert.equal(headProof.gasWrites,0);
assert.equal(headProof.financeWrites,0);
assert.equal(headProof.telegramSends,0);
assert.equal(trustedProof.calls.length,3); // LIST + both DETAILS, no writes
assert.ok(!JSON.stringify(headProof).includes(syntheticHeadId));
assert.equal((await headProofSetup().run({
 verifiedHeadFingerprint:testHeadFingerprint})).reason,
 'VERSION_METADATA_UNVERIFIED'); // Independent DETAIL mandatory
const staleDetail={...syntheticHead,updateTime:'2026-11-06T00:00:00Z'};
assert.equal((await headProofSetup(syntheticHead,staleDetail).run({
 verifyDetails:true,verifiedHeadFingerprint:testHeadFingerprint})).status,'BLOCKED');
const changedVersion={...syntheticHead,deploymentConfig:{
 ...syntheticHead.deploymentConfig,versionNumber:335}};
assert.equal((await headProofSetup(changedVersion).run({
 verifyDetails:true,verifiedHeadFingerprint:testHeadFingerprint})).status,'BLOCKED');
const impostorId='AKfyDifferentHead_1234567890';
const impostor={...syntheticHead,deploymentId:impostorId,
 entryPoints:[{entryPointType:'WEB_APP',webApp:{
  url:'https://script.google.com/macros/s/'+impostorId+'/exec',
  entryPointConfig:{access:'ANYONE_ANONYMOUS',executeAs:'USER_DEPLOYING'}}}]};
assert.equal((await headProofSetup(impostor).run({
 verifyDetails:true,verifiedHeadFingerprint:testHeadFingerprint})).status,'BLOCKED');
const duplicateHead=setup({'':{deployments:[
 item(expectedDeploymentId),{deploymentId:'HEAD'},syntheticHead]}},{
 [expectedDeploymentId]:configuredWebApp(expectedDeploymentId,'MYSELF','USER_DEPLOYING'),
 [syntheticHeadId]:syntheticHead});
const conflict=await duplicateHead.run({
 verifyDetails:true,verifiedHeadFingerprint:testHeadFingerprint});
assert.equal(conflict.status,'BLOCKED');
assert.equal(conflict.reason,'HEAD_IDENTITY_CONFLICT');
// Immutable published versions can be inspected without logging source,
// version identifiers, deployment IDs or authenticating against /exec.
const legacySource=fs.readFileSync('reference/gas-v9.281.gs','utf8');
const approvedFiles={scriptId,files:[
 {name:'Code',type:'SERVER_JS',source:legacySource},
 {name:'appsscript',type:'JSON',source:'{}'}]};
const versioned=setup({'':{deployments:listed}},secureDetails,
 {'336':approvedFiles});
const sourceReport=await versioned.run({verifyDetails:true,verifySource:true});
assert.equal(sourceReport.status,'BLOCKED');
assert.equal(sourceReport.reason,'VERSION_METADATA_UNVERIFIED');
assert.equal(sourceReport.sourceAuditAttempted,true);
assert.equal(sourceReport.sourceDistinctVersionCount,1);
assert.equal(sourceReport.sourceGetCheckedCount,1);
assert.equal(sourceReport.sourceKnownLegacy9281Count,1);
assert.equal(sourceReport.sourceKnownReviewedGate9282Count,0);
assert.equal(sourceReport.sourceGetSkippedUnversionedCount,1);
assert.equal(sourceReport.sourceGetUnverifiedCount,0);
assert.equal(sourceReport.expectedDeploymentSourceClassification,'APPROVED_LEGACY_V9281');
 // Post-v9.282 production source needs its own exact full-file reviewed
 // classification. The old v9.282 gate-only classifier must not falsely
 // report an immutable reviewed 9.284 as an unreviewed writer.
 const reviewedSource=fs.readFileSync('reference/gas-v9.284.gs','utf8');
 const reviewedFiles={scriptId,files:[
  {name:'Code',type:'SERVER_JS',source:reviewedSource},
  {name:'appsscript',type:'JSON',source:'{}'}
 ]};
 const reviewedDetails={
  [expectedDeploymentId]:configuredWebApp(expectedDeploymentId,'MYSELF','USER_DEPLOYING')
 };
 const reviewed=await setup({'':{deployments:[
    item(expectedDeploymentId),{deploymentId:'HEAD'}]}},
  reviewedDetails,{'336':reviewedFiles}).run({verifyDetails:true,verifySource:true});
 assert.equal(reviewed.status,'INVENTORY_ONLY');
 assert.equal(reviewed.reason,'LEGACY_EXECUTION_AND_EXTERNAL_WRITER_ISOLATION_UNVERIFIED');
 assert.equal(reviewed.expectedDeploymentSourceClassification,'REVIEWED_FULL_RELEASE_SOURCE');
 assert.equal(reviewed.sourceKnownReviewedFullReleaseCount,1);
 assert.equal(reviewed.sourceUnreviewedCount,0);
 assert.equal(reviewed.deploymentCount,2);
 assert.equal(reviewed.additionalRoutableDeploymentCount,0);
 assert.equal(reviewed.releaseAuthorized,false);
 assert.equal(reviewed.allActorsAndVersionsTerminatedVerified,false);
 assert.equal(reviewed.externalSheetsWritersExcludedVerified,false);
 // Regression: all recent full-source releases must be recognized ONLY by
 // immutable source pins, including the currently published 9.293 and
 // reviewed (not automatically deployed) 9.294.
 const sourceCases=[
  {name:'9.291',source:composeIssue860Gas9291Preview().source},
  {name:'9.292',source:composeIssue860Gas9292CloseStatePreview().source},
  {name:'9.293',source:composeIssue734Gas9293OrphanedClosePreview().source},
  {name:'9.294',source:composeIssue734Gas9294OwnerNavPreview().source}
 ];
 for(const candidate of sourceCases){
  const files={scriptId,files:[
   {name:'Code',type:'SERVER_JS',source:candidate.source},
   {name:'appsscript',type:'JSON',source:'{}'}
  ]};
  const match=await setup({'':{deployments:[
     item(expectedDeploymentId),{deploymentId:'HEAD'}]}},
   reviewedDetails,{'336':files}).run({verifyDetails:true,verifySource:true});
  assert.equal(match.status,'INVENTORY_ONLY',
    candidate.name+' exact approved blob must pass inventory classification');
  assert.equal(match.expectedDeploymentSourceClassification,'REVIEWED_FULL_RELEASE_SOURCE');
  assert.equal(match.sourceKnownReviewedFullReleaseCount,1);
  assert.equal(match.sourceUnreviewedCount,0);
  assert.equal(match.releaseAuthorized,false,
    'inventory classification does not authorize deployment or writer isolation');
  const tampered={scriptId,files:[
   {name:'Code',type:'SERVER_JS',source:candidate.source+'\n// unreviewed source drift'},
   {name:'appsscript',type:'JSON',source:'{}'}
  ]};
  const mismatch=await setup({'':{deployments:[
     item(expectedDeploymentId),{deploymentId:'HEAD'}]}},
   reviewedDetails,{'336':tampered}).run({verifyDetails:true,verifySource:true});
  assert.equal(mismatch.status,'BLOCKED');
  assert.equal(mismatch.reason,'VERSIONED_SOURCE_UNVERIFIED');
  assert.equal(mismatch.sourceUnreviewedCount,1);
 }
 // Google REST may canonicalize line endings independently of a Git checkout.
 // CRLF is the sole harmless normalization; any changed executable still fails.
 const reviewedCRLF={scriptId,files:[
  {name:'Code',type:'SERVER_JS',source:reviewedSource.replace(/\n/g,'\r\n')},
  {name:'appsscript',type:'JSON',source:'{}'}
 ]};
 const crlfAudit=await setup({'':{deployments:[
    item(expectedDeploymentId),{deploymentId:'HEAD'}]}},
  reviewedDetails,{'336':reviewedCRLF}).run({verifyDetails:true,verifySource:true});
 assert.equal(crlfAudit.status,'INVENTORY_ONLY');
 assert.equal(crlfAudit.sourceKnownReviewedFullReleaseCount,1);
 assert.equal(crlfAudit.releaseAuthorized,false);

 // Version labels or one character edit cannot falsely borrow approval.
 const forged={scriptId,files:[
  {name:'Code',type:'SERVER_JS',source:reviewedSource+'\\n// unauthorized drift'},
  {name:'appsscript',type:'JSON',source:'{}'}
 ]};
 const forgedAudit=await setup({'':{deployments:[
    item(expectedDeploymentId),{deploymentId:'HEAD'}]}},
  reviewedDetails,{'336':forged}).run({verifyDetails:true,verifySource:true});
 assert.equal(forgedAudit.status,'BLOCKED');
 assert.equal(forgedAudit.reason,'VERSIONED_SOURCE_UNVERIFIED');
 assert.equal(forgedAudit.sourceUnreviewedCount,1);
 assert.equal(forgedAudit.sourceKnownReviewedFullReleaseCount,0);
 assert.equal(forgedAudit.releaseAuthorized,false);

assert.equal(sourceReport.additionalDeploymentKnownLegacy9281Count,2);
assert.equal(sourceReport.additionalDeploymentVersionUnverifiedCount,1);
assert.equal(sourceReport.additionalDeploymentUnreviewedSourceCount,0);
assert.equal(sourceReport.additionalDeploymentSourceGetUnverifiedCount,0);
// The distinct *version* count must not obscure the identity of the
// expected production deployment versus three additional anonymous URLs.
const roleList=listed.map(x=>({...x,deploymentConfig:{...x.deploymentConfig}}));
roleList[1].deploymentConfig.versionNumber=337;
const newSource={scriptId,files:[
 {name:'Code',type:'SERVER_JS',source:'u'.repeat(1200)},
 {name:'appsscript',type:'JSON',source:'{}'}]};
const roleDetails={...secureDetails,
 [legacyA]:{...secureDetails[legacyA],deploymentConfig:{versionNumber:337}}};
const role=setup({'':{deployments:roleList}},roleDetails,
 {'336':approvedFiles,'337':newSource});
const byRole=await role.run({verifyDetails:true,verifySource:true});
assert.equal(byRole.status,'BLOCKED');
assert.equal(byRole.releaseAuthorized,false);
assert.equal(byRole.expectedDeploymentSourceClassification,'APPROVED_LEGACY_V9281');
assert.equal(byRole.additionalDeploymentKnownLegacy9281Count,1);
assert.equal(byRole.additionalDeploymentUnreviewedSourceCount,1);
assert.equal(byRole.additionalDeploymentVersionUnverifiedCount,1);
assert.equal(byRole.additionalDeploymentReviewedGate9282Count,0);
assert.equal(byRole.additionalDeploymentSourceGetUnverifiedCount,0);
assert.equal(byRole.additionalRoutableDeploymentCount,3);
assert.equal(byRole.sourceDistinctVersionCount,2);
assert.equal(byRole.sourceGetCheckedCount,2);
assert.equal(byRole.sourceUnreviewedCount,1);
const roleTotal=byRole.additionalDeploymentKnownLegacy9281Count+
 byRole.additionalDeploymentReviewedGate9282Count+
 byRole.additionalDeploymentUnreviewedSourceCount+
 byRole.additionalDeploymentVersionUnverifiedCount+
 byRole.additionalDeploymentSourceGetUnverifiedCount+
 byRole.additionalDeploymentSourceLimitUnverifiedCount+
 byRole.additionalDeploymentSourceNotInspectedCount;
assert.equal(roleTotal,byRole.additionalRoutableDeploymentCount);
// P2 regression: if LIST says 336 (approved legacy) but DETAIL says 337,
// source of 336 must NOT be attributed to this current deployment.
const driftExpectedDetail={
 ...configuredWebApp(expectedDeploymentId,'MYSELF','USER_DEPLOYING'),
 deploymentConfig:{versionNumber:337}
};
const driftExpected=await setup({'':{deployments:[item(expectedDeploymentId)]}},
 {[expectedDeploymentId]:driftExpectedDetail},
 {'336':approvedFiles}).run({verifyDetails:true,verifySource:true});
assert.equal(driftExpected.detailVersionConflictCount,1);
assert.equal(driftExpected.sourceKnownLegacy9281Count,1);
assert.equal(driftExpected.expectedDeploymentSourceClassification,'DETAIL_METADATA_UNVERIFIED');
assert.equal(driftExpected.status,'BLOCKED');
assert.equal(driftExpected.releaseAuthorized,false);
const driftAdditionalDetails={
 ...secureDetails,
 [legacyA]:{...secureDetails[legacyA],deploymentConfig:{versionNumber:337}}
};
const driftAdditional=await setup({'':{deployments:listed}},
 driftAdditionalDetails,{'336':approvedFiles})
 .run({verifyDetails:true,verifySource:true});
assert.equal(driftAdditional.detailVersionConflictCount,1);
assert.equal(driftAdditional.expectedDeploymentSourceClassification,'APPROVED_LEGACY_V9281');
assert.equal(driftAdditional.additionalDeploymentKnownLegacy9281Count,1);
assert.equal(driftAdditional.additionalDeploymentVersionUnverifiedCount,1);
assert.equal(driftAdditional.additionalDeploymentSourceGetUnverifiedCount,1);
assert.equal(driftAdditional.additionalRoutableDeploymentCount,3);
assert.equal(driftAdditional.releaseAuthorized,false);
const changedEntryPoint=await setup({'':{deployments:[item(expectedDeploymentId)]}},
 {[expectedDeploymentId]:{...item(expectedDeploymentId,['EXECUTION_API'])}},
 {'336':approvedFiles}).run({verifyDetails:true,verifySource:true});
assert.equal(changedEntryPoint.detailEntryPointMismatchCount,1);
assert.equal(changedEntryPoint.expectedDeploymentSourceClassification,'DETAIL_METADATA_UNVERIFIED');
assert.equal(changedEntryPoint.releaseAuthorized,false);
const missingDetailWithSource=await setup({'':{deployments:[item(expectedDeploymentId)]}},
 {},{'336':approvedFiles}).run({verifyDetails:true,verifySource:true});
assert.equal(missingDetailWithSource.detailGetUnverifiedCount,1);
assert.equal(missingDetailWithSource.expectedDeploymentSourceClassification,'DETAIL_METADATA_UNVERIFIED');
assert.equal(missingDetailWithSource.releaseAuthorized,false);
for(const sensitive of [expectedDeploymentId,legacyA,legacyB,legacyC,
 'PRIVATE_WEBAPP_URL',secret,'u'.repeat(55)]){
 assert.ok(!JSON.stringify(byRole).includes(sensitive));
}
// If the expected deployment itself is not readable, never claim a
// reviewed legacy source merely because another deployment matches.
const missingExpected=await setup({'':{deployments:[item(expectedDeploymentId)]}},
 {[expectedDeploymentId]:configuredWebApp(expectedDeploymentId,'MYSELF','USER_DEPLOYING')},
 {}).run({verifyDetails:true,verifySource:true});
assert.equal(missingExpected.expectedDeploymentSourceClassification,'SOURCE_GET_UNVERIFIED');
assert.equal(missingExpected.releaseAuthorized,false);
assert.equal(sourceReport.releaseAuthorized,false);
assert.equal(versioned.calls.filter(x=>new URL(x.url).pathname.endsWith('/content')).length,1);
for(const key of [legacySource.slice(1000,1100),expectedDeploymentId,
 legacyA,legacyB,legacyC,secret])
 assert.ok(!JSON.stringify(sourceReport).includes(key));
const unreadableVersion=await setup({'':{deployments:[item(expectedDeploymentId)]}},
 {[expectedDeploymentId]:configuredWebApp(expectedDeploymentId,'MYSELF','USER_DEPLOYING')})
 .run({verifyDetails:true,verifySource:true});
assert.equal(unreadableVersion.status,'BLOCKED');
assert.equal(unreadableVersion.sourceGetUnverifiedCount,1);
assert.equal(unreadableVersion.releaseAuthorized,false);
const unknownContent={scriptId,files:[
 {name:'Code',type:'SERVER_JS',source:'z'.repeat(1200)},
 {name:'appsscript',type:'JSON',source:'{}'}]};
const unreviewed=await setup({'':{deployments:[item(expectedDeploymentId)]}},
 {[expectedDeploymentId]:configuredWebApp(expectedDeploymentId,'MYSELF','USER_DEPLOYING')},
 {'336':unknownContent}).run({verifyDetails:true,verifySource:true});
assert.equal(unreviewed.status,'BLOCKED');
assert.equal(unreviewed.sourceUnreviewedCount,1);
assert.equal(unreviewed.sourceGetCheckedCount,1);
assert.equal(unreviewed.unreviewedSourceStaticScanMethod,'LEXICAL_HINTS_ONLY');
assert.equal(unreviewed.unreviewedSourceStaticVersionsScanned,1);
assert.equal(unreviewed.unreviewedSourceWithNoRecognizedMarkersCount,1);
assert.equal(unreviewed.unreviewedSourceWithSheetWriteMarkerCount,0);
// Pure lexical detection is deliberately neither parsing nor reachability.
// Comments can create false positives and dynamic writers false negatives.
const seeded=('function doGet(e) {return null;} function doPost(e){} '+
 'SpreadsheetApp.getActive().getSheetByName("x").setValues([]);'+
 'PropertiesService.getScriptProperties().setProperty("a","b");'+
 'ScriptApp.newTrigger("x"); UrlFetchApp.fetch("https://example.invalid");'
).padEnd(1250,' ');
const markers=inspectUnreviewedGasSourceSignals(seeded);
assert.deepEqual(markers,{webGet:true,webPost:true,sheetWrite:true,
 propertyWrite:true,triggerMutation:true,outboundFetch:true});
assert.equal(inspectUnreviewedGasSourceSignals('x'.repeat(1200)).webPost,false);
assert.throws(()=>inspectUnreviewedGasSourceSignals('tiny'),
 /ISSUE507_DEPLOYMENT_INVENTORY_SOURCE_SIGNAL_INPUT_UNVERIFIED/);
const signalA='function doPost(e){};sheet.setValues([]);'.padEnd(1200,'a');
const signalB='function doGet(e){};obj.setProperty("x",1);'.padEnd(1200,'b');
const signalListed=[item(expectedDeploymentId),
 item('EXTRA_STATIC_SOURCE_A'),item('EXTRA_STATIC_SOURCE_B')];
signalListed[1].deploymentConfig.versionNumber=337;
signalListed[2].deploymentConfig.versionNumber=338;
const signalDetails={
 [expectedDeploymentId]:item(expectedDeploymentId),
 EXTRA_STATIC_SOURCE_A:{...item('EXTRA_STATIC_SOURCE_A'),
  deploymentConfig:{versionNumber:337}},
 EXTRA_STATIC_SOURCE_B:{...item('EXTRA_STATIC_SOURCE_B'),
  deploymentConfig:{versionNumber:338}}
};
const signalVersions={
 '336':approvedFiles,
 '337':{scriptId,files:[{name:'Code',type:'SERVER_JS',source:signalA},
  {name:'appsscript',type:'JSON',source:'{}'}]},
 '338':{scriptId,files:[{name:'Code',type:'SERVER_JS',source:signalB},
  {name:'appsscript',type:'JSON',source:'{}'}]}
};
const stats=await setup({'':{deployments:signalListed}},signalDetails,
 signalVersions).run({verifyDetails:true,verifySource:true});
assert.equal(stats.status,'BLOCKED');
assert.equal(stats.releaseAuthorized,false);
assert.equal(stats.sourceUnreviewedCount,2);
assert.equal(stats.unreviewedSourceStaticVersionsScanned,2);
assert.equal(stats.unreviewedSourceWithWebPostMarkerCount,1);
assert.equal(stats.unreviewedSourceWithWebGetMarkerCount,1);
assert.equal(stats.unreviewedSourceWithSheetWriteMarkerCount,1);
assert.equal(stats.unreviewedSourceWithPropertyWriteMarkerCount,1);
assert.equal(stats.unreviewedSourceWithNoRecognizedMarkersCount,0);
for(const secretString of [signalA.slice(0,35),signalB.slice(0,35),
 'EXTRA_STATIC_SOURCE_A','EXTRA_STATIC_SOURCE_B',scriptId,secret]){
 assert.ok(!JSON.stringify(stats).includes(secretString));
}
assert.equal(unreviewed.releaseAuthorized,false);
await assert.rejects(
 setup({'':{deployments:[item(expectedDeploymentId)]}}).run({verifySource:true}),
 /ISSUE507_DEPLOYMENT_INVENTORY_SOURCE_REQUIRES_DETAILS/);
for(const id of [expectedDeploymentId,legacyA,legacyB,legacyC])
 assert.ok(!JSON.stringify(secureAudit).includes(id));
// The expected deployment itself needs a verified security config.
// A missing or unknown access/authority field can never imply isolation.
const unknownSec=await setup({'':{deployments:[item(expectedDeploymentId)]}},
 {[expectedDeploymentId]:item(expectedDeploymentId)})
 .run({verifyDetails:true});
assert.equal(unknownSec.status,'BLOCKED');
assert.equal(unknownSec.reason,'DETAIL_METADATA_UNVERIFIED');
assert.equal(unknownSec.webAppUnknownAccessCount,1);
assert.equal(unknownSec.webAppUnknownExecuteAsCount,1);
const invalidSec=await setup({'':{deployments:[item(expectedDeploymentId)]}},
 {[expectedDeploymentId]:configuredWebApp(expectedDeploymentId,
  'UNKNOWN_ACCESS','UNKNOWN_EXECUTE_AS')})
 .run({verifyDetails:true});
assert.equal(invalidSec.status,'BLOCKED');
assert.equal(invalidSec.webAppUnknownAccessCount,1);
assert.equal(invalidSec.releaseAuthorized,false);
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
assert.equal(Object.keys(doc.on).length,2,'only manual dispatch and self-file main push are allowed');
assert.equal(doc.permissions.contents,'read');
assert.equal(doc.jobs.audit.environment,'portfolio-production-gas');
assert.deepEqual(Object.keys(doc.on).sort(),['push','workflow_dispatch']);
assert.deepEqual(doc.on.push.branches,['main']);
assert.deepEqual(doc.on.push.paths,['.github/workflows/issue507-deployment-inventory-readonly.yml']);
assert.equal(doc.jobs.audit.if,
 "github.repository == 'cyyoung111-dev/portfolio' && github.ref == 'refs/heads/main' && (github.event_name == 'workflow_dispatch' || (github.event_name == 'push' && github.run_attempt == 1))");
assert.doesNotMatch(wf,/\n\s+schedule:|\n\s+workflow_run:|\n\s+pull_request:/,
 'inventory must not trigger from periodic or untrusted events');
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
assert.match(runner,/additionalWebAppAnonymousDeployerCount/);
assert.match(runner,/verifyDetails:true,verifySource:true/);
assert.match(runner,/sourceGetSkippedUnversionedCount/);
assert.match(runner,/unreviewedSourceWithSheetWriteMarkerCount/);
assert.match(runner,/unreviewedSourceStaticScanMethod/);
assert.doesNotMatch(runner,/releaseAuthorized:true/);
assert.match(runner,/WEB_ACCESS.has\(config\?\.access\)/);
assert.match(runner,/WEB_EXECUTE_AS.has\(config\?\.executeAs\)/);
assert.doesNotMatch(runner,/method:'POST'|method:'PUT'|method:'DELETE'/);
// Static references count only committed runtime literals, not live callers.
const extraLiteralId='EXTRA_STALE_DEPLOYMENT_A0123';
const staticRefs=[
 {path:'src/web/app/runtime.js',content:'const url="https://script.google.com/macros/s/'+extraLiteralId+'/exec";'},
 {path:'src/web/features/settings/connection.js',content:'localStorage.getItem("gsheet_api_url"); saveGsheetUrl(input);'},
 {path:'.github/workflows/diagnostic.yml',content:'GAS_WEB_APP_URL: ${{ vars.GAS_WEB_APP_URL }}'},
 {path:'scripts/runtime-bridge.mjs',content:'const approved="'+expectedDeploymentId+'";'}
];
const entriesForStatic=[{id:expectedDeploymentId,head:false},{id:extraLiteralId,head:false}];
const statics=scanDeploymentReferences({entries:entriesForStatic,expectedDeploymentId,files:staticRefs});
assert.equal(statics.runtimeSourceFilesScanned,4);
assert.equal(statics.expectedLiteralReferenceFiles,1);
assert.equal(statics.additionalLiteralReferenceFiles,1);
assert.equal(statics.additionalMatchedDeploymentCount,1);
assert.equal(statics.dynamicWorkflowConfigFiles,1);
assert.equal(statics.browserConfigurableEndpointFiles,1);
assert.equal(statics.oldDeploymentUnusedVerified,false);
assert.equal(statics.deploymentRemovalAuthorized,false);
assert.doesNotMatch(JSON.stringify(statics),new RegExp(extraLiteralId+'|'+expectedDeploymentId));
const noMatch=scanDeploymentReferences({
 entries:entriesForStatic,expectedDeploymentId,
 files:[{path:'src/web/app/runtime.js',content:'const api=localStorage.getItem("gsheet_api_url")'}]
});
assert.equal(noMatch.additionalMatchedDeploymentCount,0);
assert.equal(noMatch.oldDeploymentUnusedVerified,false,'no source refs does not prove URL inactive');
assert.throws(()=>scanDeploymentReferences({
 entries:entriesForStatic,expectedDeploymentId,
 files:[{path:'secrets/deploy.txt',content:extraLiteralId}]
}),/ISSUE507_REFERENCE_FILES_UNVERIFIED/);
const fromInventory=await setup({'':{deployments:[item(expectedDeploymentId),item(extraLiteralId)]}})
 .run({referenceFiles:staticRefs});
assert.equal(fromInventory.status,'BLOCKED');
assert.equal(fromInventory.additionalLiteralReferenceFiles,1);
assert.equal(fromInventory.additionalRoutableDeploymentCount,1);
assert.equal(fromInventory.releaseAuthorized,false);
assert.ok(loadTrackedRuntimeSources().length>0,'read-only scan must see checked-out files');
console.log('Issue507 GAS deployment inventory GET-only, pagination, redaction, fail-closed: PASS');
