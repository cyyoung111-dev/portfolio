// Issue #507: inventory ALL deployments of one GAS project, using REST GET only.
// This intentionally does NOT prove that old deployments, processes or other
// project accounts have stopped. No deployment/content/run/Sheet mutation.
import {pathToFileURL} from 'node:url';
import {fetchGoogleAuditToken} from './audit-published-gas-gate-readonly.mjs';
import {deploymentIdFromWebAppUrl} from './deploy-gas.mjs';

const ROOT='https://script.googleapis.com/v1/projects/';
const ERROR=/^ISSUE507_DEPLOYMENT_INVENTORY_[A-Z_]+$/;
const ID=/^[-A-Za-z0-9_]{8,160}$/;
const MAX_PAGES=10;
const PAGE_SIZE=50;
const KNOWN_TYPES=new Set(['WEB_APP','EXECUTION_API','ADD_ON']);
const validId=value=>typeof value==='string'&&ID.test(value);
function fail(reason){throw Error('ISSUE507_DEPLOYMENT_INVENTORY_'+reason);}
function classify(entry){
 const type=entry?.entryPointType;
 return typeof type==='string'&&KNOWN_TYPES.has(type)?type:'OTHER';
}
async function fetchPage(url,token,fetchImpl){
 let res;
 try{res=await fetchImpl(url,{method:'GET',headers:{
  Authorization:'Bearer '+token,Accept:'application/json'
 },redirect:'error',signal:AbortSignal.timeout(16000)});}
 catch{fail('NETWORK_UNVERIFIED');}
 if(res?.status===401||res?.status===403)fail('PERMISSION_UNVERIFIED');
 if(!res?.ok)fail('HTTP_UNVERIFIED');
 let raw;
 try{raw=await res.text();}catch{fail('RESPONSE_UNVERIFIED');}
 if(typeof raw!=='string'||raw.length>250000)fail('RESPONSE_UNVERIFIED');
 try{return JSON.parse(raw);}catch{fail('SCHEMA_UNVERIFIED');}
}
export async function inspectGasDeploymentsReadOnly({
 scriptId,expectedDeploymentId,googleAccessToken,fetchImpl=fetch
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
  if(!payload||!Array.isArray(payload.deployments)||
    payload.deployments.length>PAGE_SIZE)fail('SCHEMA_UNVERIFIED');
  for(const d of payload.deployments){
   const id=d?.deploymentId,config=d?.deploymentConfig;
   if(!validId(id)||found.has(id)||!Number.isSafeInteger(config?.versionNumber)||
    config.versionNumber<1||!Array.isArray(d.entryPoints)||
    d.entryPoints.length>10)fail('SCHEMA_UNVERIFIED');
   found.add(id);
   const types=d.entryPoints.map(classify);
   entries.push({expected:id===expectedDeploymentId,types});
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
 const counts={WEB_APP:0,EXECUTION_API:0,ADD_ON:0,OTHER:0};
 for(const e of entries)for(const type of e.types)counts[type]++;
 const expectedRows=entries.filter(e=>e.expected);
 const unknown=entries.some(e=>e.types.length===0||e.types.includes('OTHER'));
 const extraRoutable=entries.filter(e=>!e.expected&&e.types.length>0).length;
 const status=expectedRows.length!==1||unknown||extraRoutable>0?'BLOCKED':'INVENTORY_ONLY';
 const reason=expectedRows.length!==1?'EXPECTED_DEPLOYMENT_NOT_PROVEN':
  unknown?'UNKNOWN_ENTRY_POINTS':
  extraRoutable>0?'ADDITIONAL_DEPLOYMENTS_REQUIRE_ISOLATION':
  'LEGACY_EXECUTION_AND_EXTERNAL_WRITER_ISOLATION_UNVERIFIED';
 // No deployment IDs, source, URL, principal or token may enter logs.
 return {mode:'GAS_DEPLOYMENT_INVENTORY_READ_ONLY',status,reason,
  deploymentCount:entries.length,webAppEntryCount:counts.WEB_APP,
  executionApiEntryCount:counts.EXECUTION_API,
  addonEntryCount:counts.ADD_ON,unknownEntryCount:counts.OTHER,
  additionalRoutableDeploymentCount:extraRoutable,
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
   googleAccessToken:token
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
