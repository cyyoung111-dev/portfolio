#!/usr/bin/env node
// Issue #860: exact pre-v9.289 candidate-readiness audit after #734 migration.
// Google Apps Script API GET only, plus pinned metadata-only GAS gate GET and
// two v9.288 authenticated read-only actions. No deployment or financial writes.
// Intended to diagnose temporary editor files BEFORE any production release.
import {pathToFileURL} from 'node:url';
import {fetchGoogleAuditToken} from './audit-published-gas-gate-readonly.mjs';
import {parseClaspCredentials,selectServerFile,gasSourceBlobSha,
  assertGasProjectFileSet,deploymentIdFromWebAppUrl}
  from './deploy-gas.mjs';
import {inspectGateStatus} from './issue734-gate-status-v9288-readonly.mjs';
import {verifyIssue8609289TradeV2LiveGate}
  from './issue860-v9289-trade-v2-live-gate.mjs';

const BASE='https://script.googleapis.com/v1/projects/';
const PIN='9e8584032daf896c5cffedb02041b604ee82ed07';
const ID=/^[-A-Za-z0-9_]{8,160}$/;
const safe=source=>gasSourceBlobSha(source)===PIN;
function requireId(input,code){
 if(typeof input!=='string'||!ID.test(input))throw Error('ISSUE860_EDITOR_'+code);
 return input;
}
async function request(url,token,fetchImpl){
 let response;
 try{response=await fetchImpl(url,{method:'GET',
  headers:{Authorization:'Bearer '+token,Accept:'application/json'},
  redirect:'error',signal:AbortSignal.timeout(18000)})}
 catch{throw Error('ISSUE860_EDITOR_NETWORK_OR_TIMEOUT');}
 if(!response?.ok)throw Error('ISSUE860_EDITOR_API_HTTP');
 let value;
 try{value=await response.json()}catch{throw Error('ISSUE860_EDITOR_API_JSON');}
 if(!value||typeof value!=='object'||Array.isArray(value))
  throw Error('ISSUE860_EDITOR_API_SCHEMA');
 return value;
}
export async function inspectEditorReadiness({
 scriptId,deploymentId,serverName='',oauthToken,gasToken,webAppUrl,
 fetchImpl=fetch,gateInspect=inspectGateStatus,
 tradeInspect=verifyIssue8609289TradeV2LiveGate
}={}){
 const id=requireId(scriptId,'SCRIPT_ID');
 const deployment=requireId(deploymentId,'DEPLOYMENT_ID');
 if(typeof oauthToken!=='string'||oauthToken.length<20)
  throw Error('ISSUE860_EDITOR_OAUTH_UNAVAILABLE');
 if(typeof gasToken!=='string'||gasToken.length<12)
  throw Error('ISSUE860_EDITOR_GAS_AUTH_UNAVAILABLE');
 if(deploymentIdFromWebAppUrl(webAppUrl)!==deployment)
  throw Error('ISSUE860_EDITOR_DEPLOYMENT_URL_MISMATCH');
 const root=BASE+encodeURIComponent(id);
 const metadata=await request(root+'/deployments/'+encodeURIComponent(deployment),oauthToken,fetchImpl);
 const version=metadata?.deploymentConfig?.versionNumber;
 if(!Number.isSafeInteger(version)||version<1||
   !Array.isArray(metadata.entryPoints)||
   !metadata.entryPoints.some(x=>x?.webApp||x?.entryPointType==='WEB_APP'))
   throw Error('ISSUE860_EDITOR_PUBLISHED_DEPLOYMENT_UNVERIFIED');
 const [current,published]=await Promise.all([
  request(root+'/content',oauthToken,fetchImpl),
  request(root+'/content?versionNumber='+version,oauthToken,fetchImpl)
 ]);
 // Fail closed on every additional executable file, including temporary
 // #734 repair and one-click helpers. No Google content PUT, ever.
 const pubTarget=selectServerFile(published.files,serverName);
 if(!safe(pubTarget.source))
   throw Error('ISSUE860_EDITOR_PUBLISHED_PIN_DRIFT');
 const headTarget=selectServerFile(current.files,pubTarget.name);
 const result={kind:'ISSUE860_POSTMIGRATION_EDITOR_READINESS',
   status:'BLOCKED',gasVersion:'9.288',editorFileCount:Array.isArray(current.files)?current.files.length:null,
   publishedFileCount:Array.isArray(published.files)?published.files.length:null,
   editorMatchesPublished: safe(headTarget.source)&&headTarget.source===pubTarget.source,
   editorFilesApproved:false,writerGate:'NOT_CHECKED',activeWriters:null,
   tradeRowsVerified:null,publishedDeploymentVerified:true,
   financeWrites:0,gasWrites:0,gasDeployments:0,telegramSends:0};
 try{assertGasProjectFileSet(current.files,pubTarget.name,published.files);}
 catch{result.reason='EXTRA_EDITOR_FILES_OR_MANIFEST_DRIFT';return result;}
 result.editorFilesApproved=true;
 if(!result.editorMatchesPublished){result.reason='EDITOR_CODE_NOT_PINNED_9288';return result;}
 const gate=await gateInspect({url:webAppUrl,token:gasToken,fetchImpl});
 result.writerGate=gate.mode;result.activeWriters=gate.activeCount;
 if(gate.status!=='GATE_OPEN_NO_RECORDED_ACTIVE'){
  result.reason='GATE_NOT_IDLE';return result;
 }
 const ledger=await tradeInspect({url:webAppUrl,token:gasToken,fetchImpl});
 if(ledger.status!=='VERIFIED'||ledger.uniqueTradeRows!==338){
  result.reason='TRADE_V2_NOT_VERIFIED';return result;
 }
 result.tradeRowsVerified=338;result.status='READY_FOR_SEPARATELY_APPROVED_DRY_RUN';
 result.reason='NONE';
 return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const googleToken=await fetchGoogleAuditToken({clasprc:process.env.CLASPRC_JSON});
  const r=await inspectEditorReadiness({
   scriptId:process.env.GAS_SCRIPT_ID,
   deploymentId:process.env.GAS_DEPLOYMENT_ID ||
    deploymentIdFromWebAppUrl(process.env.GAS_WEB_APP_URL||''),
   serverName:process.env.GAS_SERVER_FILE_NAME||'',
   oauthToken:googleToken,gasToken:process.env.GAS_ACCESS_TOKEN,
   webAppUrl:process.env.GAS_WEB_APP_URL
  });
  console.log(JSON.stringify(r));
  if(r.status!=='READY_FOR_SEPARATELY_APPROVED_DRY_RUN')process.exitCode=2;
 }catch(e){
  const value=String(e?.message||'');
  const reason=/^ISSUE860_EDITOR_[A-Z0-9_]+$/.test(value)?value:
    /^ISSUE734_GATE_STATUS_[A-Z0-9_]+$/.test(value)?value:
    /^ISSUE860_9289_GATE_[A-Z0-9_]+$/.test(value)?value:'UNVERIFIED';
  console.log(JSON.stringify({kind:'ISSUE860_POSTMIGRATION_EDITOR_READINESS',
   status:'BLOCKED',reason,financeWrites:0,gasWrites:0,gasDeployments:0,telegramSends:0}));
  process.exitCode=2;
 }
}
