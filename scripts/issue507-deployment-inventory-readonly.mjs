// Issue #507: inventory ALL deployments of one GAS project, using REST GET only.
// This intentionally does NOT prove that old deployments, processes or other
// project accounts have stopped. No deployment/content/run/Sheet mutation.
import {pathToFileURL} from 'node:url';
import {fetchGoogleAuditToken} from './audit-published-gas-gate-readonly.mjs';
import {deploymentIdFromWebAppUrl} from './deploy-gas.mjs';
import {classifyPublishedGateSource} from './audit-published-gas-gate-readonly.mjs';

const ROOT='https://script.googleapis.com/v1/projects/';
const ERROR=/^ISSUE507_DEPLOYMENT_INVENTORY_[A-Z_]+$/;
const ID=/^[-A-Za-z0-9_]{8,160}$/;
// Apps Script creates one special HEAD deployment, which does not refer
// to an immutable positive versionNumber. It is not a release approval.
const HEAD_ID='HEAD';
const MAX_PAGES=10;
const PAGE_SIZE=50;
const KNOWN_TYPES=new Set(['WEB_APP','EXECUTION_API','ADD_ON']);
const WEB_ACCESS=new Set(['MYSELF','DOMAIN','ANYONE','ANYONE_ANONYMOUS']);
const WEB_EXECUTE_AS=new Set(['USER_ACCESSING','USER_DEPLOYING']);
const validId=value=>typeof value==='string'&&ID.test(value);
function fail(reason){throw Error('ISSUE507_DEPLOYMENT_INVENTORY_'+reason);}
function classify(entry){
 const type=entry?.entryPointType;
 return typeof type==='string'&&KNOWN_TYPES.has(type)?type:'OTHER';
}
async function fetchPage(url,token,fetchImpl,maxChars=250000){
 let res;
 try{res=await fetchImpl(url,{method:'GET',headers:{
  Authorization:'Bearer '+token,Accept:'application/json'
 },redirect:'error',signal:AbortSignal.timeout(16000)});}
 catch{fail('NETWORK_UNVERIFIED');}
 if(res?.status===401||res?.status===403)fail('PERMISSION_UNVERIFIED');
 if(!res?.ok)fail('HTTP_UNVERIFIED');
 let raw;
 try{raw=await res.text();}catch{fail('RESPONSE_UNVERIFIED');}
 if(typeof raw!=='string'||raw.length>maxChars)fail('RESPONSE_UNVERIFIED');
 try{return JSON.parse(raw);}catch{fail('SCHEMA_UNVERIFIED');}
}
export async function inspectGasDeploymentsReadOnly({
 scriptId,expectedDeploymentId,googleAccessToken,fetchImpl=fetch,
 verifyDetails=false,verifySource=false
}={}){
 if(!validId(scriptId)||!validId(expectedDeploymentId)||
  typeof googleAccessToken!=='string'||googleAccessToken.length<20)
  fail('CONFIG_UNVERIFIED');
 const found=new Set(),tokens=new Set(),entries=[];
 let next='',complete=false,pages=0;
 while(pages<MAX_PAGES){
  const url=new URL(ROOT+encodeURIComponent(scriptId)+'/deployments');
  url.searchParams.set('pageSize',String(PAGE_SIZE));
  if(next)url.searchParams.set('pageToken',next);
  const payload=await fetchPage(url.toString(),googleAccessToken,fetchImpl);
  if(!payload||typeof payload!=='object'||Array.isArray(payload))
   fail('SCHEMA_RESPONSE_UNVERIFIED');
  // The REST API can omit a repeated field when it is empty. This must
  // still end BLOCKED when the expected deployment is missing.
  const deployments=payload.deployments===undefined?[]:payload.deployments;
  if(!Array.isArray(deployments)||deployments.length>PAGE_SIZE)
   fail('SCHEMA_LIST_UNVERIFIED');
  for(const d of deployments){
   const id=d?.deploymentId,config=d?.deploymentConfig;
   if((id!==HEAD_ID&&!validId(id))||typeof id!=='string')
    fail('SCHEMA_ID_UNVERIFIED');
   if(found.has(id))fail('SCHEMA_DUPLICATE_ID_UNVERIFIED');
   const head=id===HEAD_ID;
   // Google may omit a non-HEAD versionNumber in list metadata (e.g.
   // an archived/legacy deployment). Count it, but NEVER treat it as a
   // verified immutable version or as permission for a writer cutover.
   const versionVerified=head||(
    Number.isSafeInteger(config?.versionNumber)&&config.versionNumber>=1);
   if(head&&config?.versionNumber!==undefined&&
      (!Number.isSafeInteger(config.versionNumber)||config.versionNumber<0))
    fail('SCHEMA_HEAD_VERSION_UNVERIFIED');
   // HEAD may have no public entry points and no version number.
   const points=head&&d?.entryPoints===undefined?[]:d?.entryPoints;
   if(!Array.isArray(points)||points.length>10)
    fail('SCHEMA_ENTRY_POINTS_UNVERIFIED');
   found.add(id);
   const types=points.map(classify);
   // IDs and versions remain private in-memory; never return or log them.
   entries.push({id,expected:id===expectedDeploymentId,head,types,
    versionVerified,versionNumber:versionVerified&&!head?config.versionNumber:null});
  }
  pages++;
  if(payload.nextPageToken===undefined||payload.nextPageToken===''){
   complete=true;break;
  }
  if(typeof payload.nextPageToken!=='string'||payload.nextPageToken.length>256||
    tokens.has(payload.nextPageToken))fail('PAGINATION_UNVERIFIED');
  tokens.add(payload.nextPageToken);next=payload.nextPageToken;
 }
 if(!complete)fail('PAGINATION_UNVERIFIED');
 // Independent metadata-only GET for each versioned deployment. The list
 // remains authoritative for quarantine: a GET can never erase its blockers.
 // Never log IDs, URLs, config description or the upstream body/errors.
 const detail={requested:0,checked:0,lookupUnverified:0,
  recoveredVersion:0,stillUnversioned:0,versionConflict:0,
  entryPointMismatch:0};
 // Only anonymous aggregate counts appear in logs. No deployment ID, URL,
 // principal, configuration source or per-deployment details are returned.
 const exposure={observed:0,restricted:0,domain:0,
  signedIn:0,anonymous:0,unknownAccess:0,
  executingAsDeployer:0,executingAsAccessing:0,unknownExecuteAs:0,
  additionalAnonymous:0,additionalSignedIn:0,
  additionalRunsAsDeployer:0,additionalAnonymousDeployer:0,
  additionalUnknownSecurity:0};
 if(verifyDetails){
  for(const entry of entries.filter(e=>!e.head)){
   detail.requested++;
   let record;
   try{
    record=await fetchPage(
     ROOT+encodeURIComponent(scriptId)+'/deployments/'+encodeURIComponent(entry.id),
     googleAccessToken,fetchImpl);
   }catch{
    detail.lookupUnverified++;continue;
   }
   if(!record||typeof record!=='object'||Array.isArray(record)||
     record.deploymentId!==entry.id||!Array.isArray(record.entryPoints)||
     record.entryPoints.length>10){
    detail.lookupUnverified++;continue;
   }
   detail.checked++;
   const types=record.entryPoints.map(classify);
   if(JSON.stringify([...types].sort())!==JSON.stringify([...entry.types].sort()))
    detail.entryPointMismatch++;
   for(const point of record.entryPoints.filter(p=>classify(p)==='WEB_APP')){
    const config=point.webApp?.entryPointConfig;
    const access=WEB_ACCESS.has(config?.access)?config.access:null;
    const as=WEB_EXECUTE_AS.has(config?.executeAs)?config.executeAs:null;
    exposure.observed++;
    if(access==='MYSELF')exposure.restricted++;
    else if(access==='DOMAIN')exposure.domain++;
    else if(access==='ANYONE')exposure.signedIn++;
    else if(access==='ANYONE_ANONYMOUS')exposure.anonymous++;
    else exposure.unknownAccess++;
    if(as==='USER_DEPLOYING')exposure.executingAsDeployer++;
    else if(as==='USER_ACCESSING')exposure.executingAsAccessing++;
    else exposure.unknownExecuteAs++;
    if(!entry.expected){
     if(access==='ANYONE_ANONYMOUS')exposure.additionalAnonymous++;
     if(access==='ANYONE')exposure.additionalSignedIn++;
     if(as==='USER_DEPLOYING')exposure.additionalRunsAsDeployer++;
     if(access==='ANYONE_ANONYMOUS'&&as==='USER_DEPLOYING')
      exposure.additionalAnonymousDeployer++;
     if(!access||!as)exposure.additionalUnknownSecurity++;
    }
   }
   const version=record.deploymentConfig?.versionNumber;
   if(!Number.isSafeInteger(version)||version<1)detail.stillUnversioned++;
   else if(!entry.versionVerified)detail.recoveredVersion++;
   else if(entry.versionNumber!==version)detail.versionConflict++;
  }
 }
 // Immutable version source is inspected only in memory. Never print source,
 // manifest, author, version number, deployment IDs, or response JSON.
 // This is a fingerprint comparison, NOT a penetration test or proof of
 // complete writer isolation. HEAD/unknown version is never fetched as source.
 const sourceAudit={attempted:false,distinctVersions:0,successful:0,
  failed:0,skippedUnversioned:0,skippedOverLimit:0,
  knownLegacy9281:0,knownReviewedGate9282:0,unreviewedSource:0};
 if(verifySource){
  if(!verifyDetails)fail('SOURCE_REQUIRES_DETAILS');
  sourceAudit.attempted=true;
  const uniq=new Set();
  for(const entry of entries.filter(e=>!e.head)){
   if(!entry.versionVerified){sourceAudit.skippedUnversioned++;continue;}
   uniq.add(entry.versionNumber);
  }
  const LIMIT=12;
  sourceAudit.distinctVersions=uniq.size;
  for(const version of uniq){
   if(sourceAudit.successful+sourceAudit.failed>=LIMIT){
    sourceAudit.skippedOverLimit++;continue;
   }
   try{
    const u=new URL(ROOT+encodeURIComponent(scriptId)+'/content');
    u.searchParams.set('versionNumber',String(version));
    const payload=await fetchPage(u.toString(),googleAccessToken,fetchImpl,1600000);
    if(payload?.scriptId!==scriptId||!Array.isArray(payload.files)||
      payload.files.filter(x=>x?.type==='JSON'&&x.name==='appsscript').length!==1)
     throw Error('schema');
    const code=payload.files.filter(x=>x?.type==='SERVER_JS');
    if(code.length!==1||typeof code[0].source!=='string'||
      code[0].source.length<1000||code[0].source.length>1400000)
     throw Error('source');
    const classified=classifyPublishedGateSource(code[0].source);
    sourceAudit.successful++;
    if(classified.knownLegacyBaseline)sourceAudit.knownLegacy9281++;
    else if(classified.gateReadAllowed)sourceAudit.knownReviewedGate9282++;
    else sourceAudit.unreviewedSource++;
   }catch{
    sourceAudit.failed++;
   }
  }
 }
 const counts={WEB_APP:0,EXECUTION_API:0,ADD_ON:0,OTHER:0};
 for(const e of entries)for(const type of e.types)counts[type]++;
 const expectedRows=entries.filter(e=>e.expected);
 const unknown=entries.some(e=>(!e.head&&e.types.length===0)||e.types.includes('OTHER'));
 const extraRoutable=entries.filter(e=>!e.expected&&e.types.length>0).length;
 const unverifiedVersions=entries.filter(e=>!e.versionVerified).length;
 const sourceProblems=verifySource&&(sourceAudit.failed>0||
  sourceAudit.skippedUnversioned>0||sourceAudit.skippedOverLimit>0||
  sourceAudit.unreviewedSource>0||sourceAudit.knownLegacy9281>0);
 const detailProblems=verifyDetails&&(
  detail.lookupUnverified>0||detail.versionConflict>0||detail.entryPointMismatch>0||
  detail.stillUnversioned>0||detail.recoveredVersion>0||
  exposure.unknownAccess>0||exposure.unknownExecuteAs>0);
 const status=expectedRows.length!==1||unverifiedVersions>0||unknown||extraRoutable>0||detailProblems||sourceProblems
  ?'BLOCKED':'INVENTORY_ONLY';
 const reason=expectedRows.length!==1?'EXPECTED_DEPLOYMENT_NOT_PROVEN':
  unverifiedVersions>0?'VERSION_METADATA_UNVERIFIED':
  unknown?'UNKNOWN_ENTRY_POINTS':
  extraRoutable>0?'ADDITIONAL_DEPLOYMENTS_REQUIRE_ISOLATION':
  detailProblems?'DETAIL_METADATA_UNVERIFIED':
  sourceProblems?'VERSIONED_SOURCE_UNVERIFIED':
  'LEGACY_EXECUTION_AND_EXTERNAL_WRITER_ISOLATION_UNVERIFIED';
 // No deployment IDs, source, URL, principal or token may enter logs.
 return {mode:'GAS_DEPLOYMENT_INVENTORY_READ_ONLY',status,reason,
  deploymentCount:entries.length,headDeploymentCount:entries.filter(e=>e.head).length,
  unverifiedVersionedDeploymentCount:unverifiedVersions,
  webAppEntryCount:counts.WEB_APP,
  executionApiEntryCount:counts.EXECUTION_API,
  addonEntryCount:counts.ADD_ON,unknownEntryCount:counts.OTHER,
  additionalRoutableDeploymentCount:extraRoutable,
  detailVerificationAttempted:verifyDetails===true,
  detailGetRequestedCount:detail.requested,
  detailGetCheckedCount:detail.checked,
  detailGetUnverifiedCount:detail.lookupUnverified,
  detailVersionRecoveredCount:detail.recoveredVersion,
  detailVersionStillUnverifiedCount:detail.stillUnversioned,
  detailVersionConflictCount:detail.versionConflict,
  detailEntryPointMismatchCount:detail.entryPointMismatch,
  webAppSecurityInspectedCount:exposure.observed,
  webAppAccessMyselfCount:exposure.restricted,
  webAppAccessDomainCount:exposure.domain,
  webAppAccessSignedInCount:exposure.signedIn,
  webAppAccessAnonymousCount:exposure.anonymous,
  webAppUnknownAccessCount:exposure.unknownAccess,
  webAppExecuteAsDeployerCount:exposure.executingAsDeployer,
  webAppExecuteAsAccessingCount:exposure.executingAsAccessing,
  webAppUnknownExecuteAsCount:exposure.unknownExecuteAs,
  additionalWebAppAnonymousCount:exposure.additionalAnonymous,
  additionalWebAppSignedInCount:exposure.additionalSignedIn,
  additionalWebAppExecuteAsDeployerCount:exposure.additionalRunsAsDeployer,
  additionalWebAppAnonymousDeployerCount:exposure.additionalAnonymousDeployer,
  additionalWebAppUnknownSecurityCount:exposure.additionalUnknownSecurity,
  sourceAuditAttempted:sourceAudit.attempted,
  sourceDistinctVersionCount:sourceAudit.distinctVersions,
  sourceGetCheckedCount:sourceAudit.successful,
  sourceGetUnverifiedCount:sourceAudit.failed,
  sourceGetSkippedUnversionedCount:sourceAudit.skippedUnversioned,
  sourceGetSkippedOverLimitCount:sourceAudit.skippedOverLimit,
  sourceKnownLegacy9281Count:sourceAudit.knownLegacy9281,
  sourceKnownReviewedGate9282Count:sourceAudit.knownReviewedGate9282,
  sourceUnreviewedCount:sourceAudit.unreviewedSource,
  expectedDeploymentFound:expectedRows.length===1,
  pagesRead:pages,inventoryComplete:true,
  allActorsAndVersionsTerminatedVerified:false,
  externalSheetsWritersExcludedVerified:false,
  editorSessionsExcludedVerified:false,
  releaseAuthorized:false,gasWrites:0,financeWrites:0,telegramSends:0};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const token=await fetchGoogleAuditToken({clasprc:process.env.CLASPRC_JSON});
  const expected=process.env.GAS_DEPLOYMENT_ID||
   deploymentIdFromWebAppUrl(process.env.GAS_WEB_APP_URL||'');
  const result=await inspectGasDeploymentsReadOnly({
   scriptId:process.env.GAS_SCRIPT_ID,expectedDeploymentId:expected,
   googleAccessToken:token,verifyDetails:true,verifySource:true
  });
  console.log(JSON.stringify(result));
  if(result.status==='BLOCKED')process.exitCode=2;
 }catch(error){
  console.log(JSON.stringify({mode:'GAS_DEPLOYMENT_INVENTORY_READ_ONLY',
   status:'UNVERIFIED',reason:ERROR.test(error?.message||'')
    ?error.message:'ISSUE507_DEPLOYMENT_INVENTORY_UNVERIFIED',
   releaseAuthorized:false,gasWrites:0,financeWrites:0,telegramSends:0}));
  process.exitCode=2;
 }
}
