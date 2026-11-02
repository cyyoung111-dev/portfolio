// Production GAS evidence: Apps Script REST GET-only source/version readback,
// followed by one authenticated GAS metadata-only GET *only* when the exact
// published v9.282 blob proves getWriterGateStatus cannot perform a write.
// No deploy, script/financial data modification, trigger installation or NH API.
import {pathToFileURL} from 'node:url';
import {parseClaspCredentials,gasSourceBlobSha,extractExpectedGasVersion,
  selectServerFile,deploymentIdFromWebAppUrl} from './deploy-gas.mjs';

const API='https://script.googleapis.com/v1';
const OAUTH='https://oauth2.googleapis.com/token';
const APPROVED_GATE_BLOB='9c1a5f31d1abc4b44f7da9af7a50fe3f15967134';
const SHA=/^[a-f0-9]{40}$/;
const ALLOWED_ERROR=/^GAS_PUBLISHED_AUDIT_[A-Z_]+$/;

function assertId(id,kind){
 if(typeof id!=='string'||!id||id.length>160||!/^[-A-Za-z0-9_]+$/.test(id))
  throw Error('GAS_PUBLISHED_AUDIT_'+kind+'_INVALID');
 return id;
}
async function jsonFrom(response,limit=1450000){
 if(!response?.ok)throw Error('GAS_PUBLISHED_AUDIT_HTTP_UNVERIFIED');
 const value=await response.text();
 if(typeof value!=='string'||value.length>limit)throw Error('GAS_PUBLISHED_AUDIT_RESPONSE_TOO_LARGE');
 try {return JSON.parse(value);}catch{throw Error('GAS_PUBLISHED_AUDIT_NON_JSON');}
}
async function getJson(url,oauth,fetchImpl){
 return jsonFrom(await fetchImpl(url,{method:'GET',
  headers:{Authorization:'Bearer '+oauth,Accept:'application/json'},
  redirect:'error',signal:AbortSignal.timeout(16000)}));
}
function fileSource(files,name){
 if(!Array.isArray(files)||files.length!==2
   ||files.filter(x=>x?.type==='SERVER_JS').length!==1
   ||files.filter(x=>x?.type==='JSON'&&x.name==='appsscript').length!==1)
  throw Error('GAS_PUBLISHED_AUDIT_PROJECT_FILES_INVALID');
 const file=selectServerFile(files,name);
 if(typeof file?.source!=='string'||file.source.length<100000
  ||file.source.length>1400000)
  throw Error('GAS_PUBLISHED_AUDIT_SOURCE_INVALID');
 return {source:file.source,name:file.name};
}
// Contract examined in pinned v9.282: doGet's inline admission redirects
// action=getWriterGateStatus to _issue507GateStatusRequest_ before any
// writer receipt; that handler checks auth and reads Script Properties under
// ScriptLock, but calls no setProperty or create/update API.
export function classifyPublishedGateSource(source){
 try{
  const version=extractExpectedGasVersion(source);
  const blob=gasSourceBlobSha(source);
  if(!SHA.test(blob))throw Error('invalid');
  return {version,blob,gateReadAllowed:version==='9.282'
   &&blob===APPROVED_GATE_BLOB};
 }catch{
  return {version:'UNKNOWN',blob:'UNKNOWN',gateReadAllowed:false};
 }
}
export async function inspectPublishedGasReadOnly({
 scriptId,deploymentId,webAppUrl,googleAccessToken,gasAccessToken,
 serverName='',fetchImpl=fetch
}={}){
 const script=assertId(scriptId,'SCRIPT_ID');
 const deployment=assertId(deploymentId,'DEPLOYMENT_ID');
 if(typeof googleAccessToken!=='string'||googleAccessToken.length<20)
  throw Error('GAS_PUBLISHED_AUDIT_OAUTH_MISSING');
 if(typeof webAppUrl!=='string'||!webAppUrl.startsWith('https://script.google.com/macros/s/')
   ||deploymentIdFromWebAppUrl(webAppUrl)!==deployment)
  throw Error('GAS_PUBLISHED_AUDIT_WEBAPP_MISMATCH');
 const root=API+'/projects/'+encodeURIComponent(script);
 const item=await getJson(root+'/deployments/'+encodeURIComponent(deployment),googleAccessToken,fetchImpl);
 const versionNumber=item?.deploymentConfig?.versionNumber;
 if(!Number.isSafeInteger(versionNumber)||versionNumber<1||
   !Array.isArray(item.entryPoints)||!item.entryPoints.some(x=>x?.webApp||x?.entryPointType==='WEB_APP'))
  throw Error('GAS_PUBLISHED_AUDIT_DEPLOYMENT_UNVERIFIED');
 const [published,head]=await Promise.all([
  getJson(root+'/content?versionNumber='+versionNumber,googleAccessToken,fetchImpl),
  getJson(root+'/content',googleAccessToken,fetchImpl)
 ]);
 const publishedSource=fileSource(published.files,serverName);
 const headSource=fileSource(head.files,publishedSource.name);
 const p=classifyPublishedGateSource(publishedSource.source);
 const h=classifyPublishedGateSource(headSource.source);
 const state={
  mode:'GAS_PUBLISHED_READONLY_AUDIT',status:'BLOCKED',
  publishedVersion:p.version,publishedBlob:p.blob,
  headVersion:h.version,headBlob:h.blob,headEqualsPublished:p.blob===h.blob,
  gateMode:'NOT_QUERIED',activeCount:null,approvalPresent:null,
  publishedSourceApproved:p.gateReadAllowed,releaseAuthorized:false,
  deploymentVersionNumber:versionNumber,
  gasWrites:0,financeWrites:0,telegramSends:0,nhOAuthRequests:0
 };
 // Do not call the runtime on v9.281/unknown v9.283. Without the exact
 // reviewed v9.282 code, getWriterGateStatus may fall through to a writer.
 if(!p.gateReadAllowed)return state;
 if(typeof gasAccessToken!=='string'||gasAccessToken.length<12)
  throw Error('GAS_PUBLISHED_AUDIT_GAS_TOKEN_MISSING');
 const u=new URL(webAppUrl);
 u.searchParams.set('action','getWriterGateStatus');
 u.searchParams.set('accessToken',gasAccessToken);
 // Host Actions will not echo URL/body. The URL is never added to the result.
 let data;
 try{
  data=await jsonFrom(await fetchImpl(u.toString(),{method:'GET',
   redirect:'follow',signal:AbortSignal.timeout(16000)}),25000);
 }catch{throw Error('GAS_PUBLISHED_AUDIT_RUNTIME_UNVERIFIED');}
 if(data?.status!=='ok'||data?.gasVersion!=='9.282'||!data.writerGate
  ||!['OPEN','DRAINING','UNINITIALIZED'].includes(data.writerGate.mode)
  ||data.writerGate.repairAuthorized!==false
  ||(data.writerGate.mode==='OPEN'&&typeof data.writerGate.approvalPresent!=='boolean'))
  throw Error('GAS_PUBLISHED_AUDIT_GATE_UNVERIFIED');
 state.gateMode=data.writerGate.mode;
 state.approvalPresent=data.writerGate.approvalPresent===true;
 state.activeCount=Number.isSafeInteger(data.writerGate.activeCount)
  &&data.writerGate.activeCount>=0 ?data.writerGate.activeCount:null;
 if(data.writerGate.mode==='OPEN'&&state.approvalPresent===false
    &&state.activeCount!==null)
  state.status='LIVE_V9282_GATE_OPEN_CONFIRMED';
 return state;
}
export async function fetchGoogleAuditToken({clasprc,fetchImpl=fetch}={}){
 const {clientId,clientSecret,refreshToken}=parseClaspCredentials(clasprc);
 const body=new URLSearchParams({client_id:clientId,client_secret:clientSecret,
  refresh_token:refreshToken,grant_type:'refresh_token'});
 const result=await jsonFrom(await fetchImpl(OAUTH,{method:'POST',
  headers:{'content-type':'application/x-www-form-urlencoded'},
  body:body.toString(),redirect:'error',signal:AbortSignal.timeout(16000)}),10000);
 if(typeof result?.access_token!=='string'||result.access_token.length<20)
  throw Error('GAS_PUBLISHED_AUDIT_OAUTH_UNVERIFIED');
 return result.access_token;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const token=await fetchGoogleAuditToken({clasprc:process.env.CLASPRC_JSON});
  const result=await inspectPublishedGasReadOnly({
   scriptId:process.env.GAS_SCRIPT_ID,
   deploymentId:process.env.GAS_DEPLOYMENT_ID||
    deploymentIdFromWebAppUrl(process.env.GAS_WEB_APP_URL||''),
   webAppUrl:process.env.GAS_WEB_APP_URL,
   googleAccessToken:token,gasAccessToken:process.env.GAS_ACCESS_TOKEN,
   serverName:process.env.GAS_SERVER_FILE_NAME||''
  });
  console.log(JSON.stringify(result));
  if(result.status!=='LIVE_V9282_GATE_OPEN_CONFIRMED')process.exitCode=2;
 }catch(error){
  // Never echo untrusted OAuth/GAS error text, URLs or credentials.
  const reason=ALLOWED_ERROR.test(error?.message||'')
   ?error.message:'GAS_PUBLISHED_AUDIT_UNVERIFIED';
  console.log(JSON.stringify({mode:'GAS_PUBLISHED_READONLY_AUDIT',
   status:'UNVERIFIED',reason,gasWrites:0,financeWrites:0,telegramSends:0}));
  process.exitCode=2;
 }
}
