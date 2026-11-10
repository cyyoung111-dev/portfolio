#!/usr/bin/env node
// Issue #860: exact, independent, production READ-ONLY deployment readiness.
// Does not dispatch, update Apps Script content, edit Script Properties,
// send Telegram, issue NH tokens, or touch financial sheets.
import {pathToFileURL} from 'node:url';
import {fetchGoogleAuditToken}
  from './audit-published-gas-gate-readonly.mjs';
import {assertGasReleaseReady,gasSourceBlobSha,selectServerFile,
  assertGasProjectFileSet,deploymentIdFromWebAppUrl} from './deploy-gas.mjs';
import {inspectGateStatus} from './issue734-gate-status-v9288-readonly.mjs';
import {verifyIssue8609289TradeV2LiveGate}
  from './issue860-v9289-trade-v2-live-gate.mjs';

const API='https://script.googleapis.com/v1';
const PUBLISHED_SHA='9e8584032daf896c5cffedb02041b604ee82ed07';
const ID=/^[-A-Za-z0-9_]{10,160}$/;
const SESSION_DATE='2026-11-10';

function fail(code){throw Error('ISSUE860_9289_PREFLIGHT_'+code);}
async function getJson(url,oauth,fetchImpl){
 let r;
 try{r=await fetchImpl(url,{method:'GET',redirect:'error',
  headers:{authorization:'Bearer '+oauth,accept:'application/json'},
  signal:AbortSignal.timeout(23000)});}
 catch{fail('GOOGLE_API_NETWORK');}
 if(!r?.ok)fail('GOOGLE_API_HTTP');
 let payload;
 try{payload=await r.json();}catch{fail('GOOGLE_API_JSON');}
 if(!payload||typeof payload!=='object'||Array.isArray(payload))
  fail('GOOGLE_API_SCHEMA');
 return payload;
}
export function classifyProjectFiles({head,published,preferredName=''}) {
 if(!Array.isArray(head)||!Array.isArray(published))
  fail('FILE_LIST_MISSING');
 let released;
 try{released=selectServerFile(published,preferredName);}
 catch{fail('PUBLISHED_SOURCE_AMBIGUOUS');}
 if(!released||released.type!=='SERVER_JS'||typeof released.source!=='string')
  fail('PUBLISHED_SOURCE_INVALID');
 let publishedVersion;
 try{publishedVersion=assertGasReleaseReady(released.source);}
 catch{fail('PUBLISHED_SOURCE_NOT_REVIEWED');}
 const publisherValid=publishedVersion==='9.288'
  &&gasSourceBlobSha(released.source)===PUBLISHED_SHA;
 const current=head.filter(f=>f.type==='SERVER_JS'&&f.name===released.name);
 const coreMatches=current.length===1&&
   gasSourceBlobSha(String(current[0].source??''))===PUBLISHED_SHA;
 let exactFiles=false;
 try{exactFiles=assertGasProjectFileSet(head,released.name,published)===true;}
 catch{exactFiles=false;}
 const temporaryFiles=head.filter(f=>f?.type==='SERVER_JS'&&
  /^Issue734_(?:Recovery|OneClick)$/i.test(f.name)).length;
 const extraFiles=Math.max(0,head.length-2);
 const status=!publisherValid?'PUBLISHED_VERSION_OR_SHA_DRIFT'
  :!coreMatches?'HEAD_PRIMARY_SOURCE_DRIFT'
  :!exactFiles?'UNREVIEWED_EXTRA_OR_MANIFEST_FILES'
  :'REVIEWED_9288_READY';
 return {status,publishedVersion,expectedPublishedShaMatch:publisherValid,
  headPrimaryShaMatch:coreMatches,fileSetExact:exactFiles,
  actualFileCount:head.length,expectedFileCount:2,
  unreviewedExtraFileCount:extraFiles,
  temporaryMaintenanceFileCount:temporaryFiles,
  // Never expose OAuth tokens, raw GAS sources, appscript manifest or IDs.
  deploymentPerformed:false,financialWrites:0,propertyWrites:0};
}
export function resolveDeploymentId({deploymentId='',webAppUrl}={}) {
 let derived;
 try{derived=deploymentIdFromWebAppUrl(webAppUrl);}
 catch{fail('WEBAPP_DEPLOYMENT_ID_UNVERIFIED');}
 if(!ID.test(derived))fail('WEBAPP_DEPLOYMENT_ID_INVALID');
 if(deploymentId && deploymentId!==derived)
  fail('DEPLOYMENT_ID_URL_MISMATCH');
 return derived;
}
export function judgeReadiness({files,gate,trades}) {
 if(files?.status!=='REVIEWED_9288_READY')
  return {status:'BLOCKED_HEAD_FILE_SET',ready:false};
 if(gate?.status!=='GATE_OPEN_NO_RECORDED_ACTIVE'||gate.mode!=='OPEN'||
    gate.activeCount!==0)
  return {status:'BLOCKED_WRITER_GATE',ready:false};
 if(trades?.status!=='VERIFIED'||trades.gasVersion!=='9.288'||
    trades.v2Protocol!==2||trades.uniqueTradeRows!==338)
  return {status:'BLOCKED_LIVE_TRADE_V2',ready:false};
 return {status:'READY_FOR_MANUAL_9289_DRY_RUN',ready:true};
}
export async function runReadiness({
 scriptId,deploymentId,serverName='',webAppUrl,gasToken,
 googleOauth,fetchImpl=fetch,gateInspector=inspectGateStatus,
 tradeInspector=verifyIssue8609289TradeV2LiveGate,report=()=>{}
}={}){
 const resolvedDeploymentId=resolveDeploymentId({deploymentId,webAppUrl});
 if(!ID.test(String(scriptId??'')))fail('SCRIPT_ID_INVALID');
 if(typeof googleOauth!=='string'||googleOauth.length<20)
  fail('OAUTH_NOT_AUTHORIZED');
 if(typeof webAppUrl!=='string'||!webAppUrl.startsWith('https://script.google.com/macros/s/'))
  fail('WEBAPP_URL_UNVERIFIED');
 const root=API+'/projects/'+encodeURIComponent(scriptId);
 const deployed=await getJson(root+'/deployments/'+encodeURIComponent(resolvedDeploymentId),
  googleOauth,fetchImpl);
 const vn=deployed?.deploymentConfig?.versionNumber;
 if(!Number.isSafeInteger(vn)||vn<1||
   !Array.isArray(deployed.entryPoints)||!deployed.entryPoints.some(x=>
    x.entryPointType==='WEB_APP'||x.webApp))
  fail('DEPLOYMENT_NOT_WEBAPP');
 const [head,published]=await Promise.all([
  getJson(root+'/content',googleOauth,fetchImpl),
  getJson(root+'/content?versionNumber='+vn,googleOauth,fetchImpl)
 ]);
 const files=classifyProjectFiles({head:head.files,published:published.files,
  preferredName:serverName});
 report({kind:'ISSUE860_9289_PROJECT_FILE_READBACK',...files,
  sourceDate:SESSION_DATE,deployedVersionNumber:vn});
 // Only the exact published 9.288 verified route may be interrogated.
 if(!files.expectedPublishedShaMatch)
  return {status:'BLOCKED_UNVERIFIED_PUBLICATION',ready:false};
 const gate=await gateInspector({url:webAppUrl,token:gasToken});
 report({kind:'ISSUE860_9289_GATE_READBACK',
  status:gate.status,gasVersion:gate.observedGasVersion,
  mode:gate.mode,activeCount:gate.activeCount,propertyWrites:0,
  financialWrites:0});
 let trades=null;
 if(gate.mode==='OPEN'&&gate.activeCount===0){
  // Observe only the fixed operation name and bounded elapsed time.
  // Credentials, private trades, raw URL/body and response text never log.
  const observedFetch=async (url,opts)=>{
   const action=new URLSearchParams(opts?.body||'').get('action');
   if(!['getAutomationStatus','getTrades'].includes(action))
    fail('LIVE_TRADE_ACTION_UNEXPECTED');
   const began=Date.now();
   report({kind:'ISSUE860_9289_LIVE_READ_STAGE',action,status:'STARTED',
    financialWrites:0,gasDeployments:0});
   try{
    const response=await fetchImpl(url,opts);
    report({kind:'ISSUE860_9289_LIVE_READ_STAGE',action,
     status:response?.ok?'HTTP_OK':'HTTP_UNVERIFIED',
     elapsedSeconds:Math.min(120,Math.ceil((Date.now()-began)/1000)),
     financialWrites:0,gasDeployments:0});
    return response;
   }catch{
    report({kind:'ISSUE860_9289_LIVE_READ_STAGE',action,
     status:'NETWORK_OR_TIMEOUT',
     elapsedSeconds:Math.min(120,Math.ceil((Date.now()-began)/1000)),
     financialWrites:0,gasDeployments:0});
    throw Error('ISSUE860_9289_PREFLIGHT_LIVE_NETWORK_OR_TIMEOUT');
   }
  };
  try{
   trades=await tradeInspector({url:webAppUrl,token:gasToken,
    fetchImpl:observedFetch});
   report({kind:'ISSUE860_9289_TRADE_PROTOCOL_READBACK',
     status:trades.status,gasVersion:trades.gasVersion,
     tradeProtocol:trades.v2Protocol,uniqueTradeRows:trades.uniqueTradeRows,
     propertyWrites:0,financialWrites:0});
  }catch(e){
   const reason=String(e?.message??'');
   report({kind:'ISSUE860_9289_TRADE_PROTOCOL_READBACK',status:'UNVERIFIED',
     reason:/^ISSUE860_9289_GATE_[A-Z_]+$/.test(reason)?reason:'UNVERIFIED',
     financialWrites:0});
  }
 }
 const result=judgeReadiness({files,gate,trades});
 report({kind:'ISSUE860_9289_DEPLOYMENT_READINESS',...result,
  publicationVersion:files.publishedVersion,
  deployedVersionNumber:vn,
  actor:'READ_ONLY',deploymentPerformed:false,
  financialWrites:0,scriptPropertyWrites:0,telegramSends:0});
 return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const oauth=await fetchGoogleAuditToken({clasprc:process.env.CLASPRC_JSON});
  const result=await runReadiness({
   scriptId:process.env.GAS_SCRIPT_ID,
   deploymentId:process.env.GAS_DEPLOYMENT_ID,
   serverName:process.env.GAS_SERVER_FILE_NAME??'',
   webAppUrl:process.env.GAS_WEB_APP_URL,
   gasToken:process.env.GAS_ACCESS_TOKEN,
   googleOauth:oauth,
   report:r=>console.log(JSON.stringify(r))
  });
  if(!result.ready)process.exitCode=2;
 }catch(e){
  const reason=String(e?.message??'');
  console.error(/^ISSUE860_9289_PREFLIGHT_[A-Z_]+$/.test(reason)?
    reason:'ISSUE860_9289_PREFLIGHT_UNVERIFIED');
  process.exitCode=2;
 }
}
