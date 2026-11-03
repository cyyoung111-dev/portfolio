// One-time isolated Apps Script provisioning. NEVER touches financial GAS project.
// Only a separately created script project with ScriptProperties storage is written.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {fetchGoogleAuditToken} from './audit-published-gas-gate-readonly.mjs';

const API='https://script.googleapis.com/v1/projects';
const HASH_SENTINEL='__PERF_BEARER_SHA256__';
const sourcePath='ops/performance-standalone-gas/Code.gs';
const ALLOW=/^[-a-zA-Z0-9_]{15,160}$/;
function fail(code){throw Error('PERF_STANDALONE_'+code)}
async function rest(url,token,{method='GET',body}={}){
 let r;
 try{r=await fetch(url,{method,headers:{
  Authorization:'Bearer '+token,Accept:'application/json',
  ...(body?{'Content-Type':'application/json'}:{})
 },...(body?{body:JSON.stringify(body)}:{}),
 redirect:'error',signal:AbortSignal.timeout(25000)})}
 catch{fail('NETWORK_UNVERIFIED')}
 if(!r?.ok)fail(method==='POST'?'CREATE_UNVERIFIED':
   method==='PUT'?'UPDATE_UNVERIFIED':'READBACK_UNVERIFIED');
 let raw;try{raw=await r.text()}catch{fail('RESPONSE_UNVERIFIED')}
 if(raw.length>180000)fail('RESPONSE_OVERSIZE');
 try{return JSON.parse(raw)}catch{fail('RESPONSE_SCHEMA')}
}
export function prepareStandaloneSource(financeToken,code){
 if(typeof financeToken!=='string'||financeToken.length<24)fail('FINANCE_TOKEN_UNVERIFIED');
 if(typeof code!=='string'||code.split(HASH_SENTINEL).length!==2 ||
    !code.includes('function doPost(e)')||!code.includes('function doGet(e)')||
    /SpreadsheetApp|DriveApp|GmailApp|CalendarApp|UrlFetchApp/.test(code))
    fail('UNSAFE_STANDALONE_SOURCE');
 const derived=createHash('sha256').update('portfolio-telemetry:v1|'+financeToken).digest('hex');
 return code.replace(HASH_SENTINEL,derived);
}
export async function provision({clasprc,financeToken,source,financialScriptId,existingId=''}={}){
 const authorizedSource=prepareStandaloneSource(financeToken,source);
 const token=await fetchGoogleAuditToken({clasprc});
 let scriptId=String(existingId||'').trim();
 if(scriptId&&(!ALLOW.test(scriptId)||scriptId===financialScriptId))fail('TARGET_ID_UNVERIFIED');
 if(!scriptId){
   const created=await rest(API,token,{method:'POST',
    body:{title:'Portfolio Performance Metrics Only (No Financial Sheets)'}});
   scriptId=String(created.scriptId||'');
   if(!ALLOW.test(scriptId)||scriptId===financialScriptId)fail('NEW_PROJECT_UNVERIFIED');
   console.log(JSON.stringify({stage:'NEW_ISOLATED_PROJECT_CREATED',scriptId,
     financialProjectTouched:false}));
 }
 const manifest={timeZone:'Asia/Seoul',exceptionLogging:'STACKDRIVER',runtimeVersion:'V8',
  webapp:{access:'ANYONE_ANONYMOUS',executeAs:'USER_DEPLOYING'}};
 const files=[
  {name:'Code',type:'SERVER_JS',source:authorizedSource},
  {name:'appsscript',type:'JSON',source:JSON.stringify(manifest)}
 ];
 await rest(API+'/'+encodeURIComponent(scriptId)+'/content',token,{
  method:'PUT',body:{files}
 });
 const actual=await rest(API+'/'+encodeURIComponent(scriptId)+'/content',token);
 const code=actual.files?.find(x=>x.name==='Code'&&x.type==='SERVER_JS')?.source;
 const m=actual.files?.find(x=>x.name==='appsscript'&&x.type==='JSON')?.source;
 if(code!==authorizedSource||m!==JSON.stringify(manifest))fail('SOURCE_READBACK_MISMATCH');
 const version=await rest(API+'/'+encodeURIComponent(scriptId)+'/versions',token,{
  method:'POST',body:{description:'isolated performance-only v1, no financial scopes'}
 });
 if(!Number.isSafeInteger(version.versionNumber)||version.versionNumber<1)
    fail('VERSION_UNVERIFIED');
 const deployment=await rest(API+'/'+encodeURIComponent(scriptId)+'/deployments',token,{
  method:'POST',body:{versionNumber:version.versionNumber,manifestFileName:'appsscript',
    description:'portfolio-performance-only; never finance GAS'}
 });
 const depId=String(deployment.deploymentId||'');
 if(!ALLOW.test(depId))fail('DEPLOYMENT_ID_UNVERIFIED');
 const check=await rest(API+'/'+encodeURIComponent(scriptId)+'/deployments/'+encodeURIComponent(depId),token);
 const points=check.entryPoints||[];
 const endpoint=points.find(x=>x.entryPointType==='WEB_APP')?.webApp;
 const url=String(endpoint?.url||'');
 if(!/^https:\/\/script\.google\.com\/macros\/s\/[-A-Za-z0-9_]+\/exec$/.test(url)||
   endpoint.entryPointConfig?.access!=='ANYONE_ANONYMOUS'||
   endpoint.entryPointConfig?.executeAs!=='USER_DEPLOYING')
   fail('WEBAPP_READBACK_UNVERIFIED');
 return {mode:'PERF_STANDALONE_GAS',status:'CREATED',
  scriptId,deploymentId:depId,url,
  independentFinancialProject:true,financialGASWrites:0,financialSheetWrites:0};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const source=fs.readFileSync(sourcePath,'utf8');
  if(process.argv.includes('--check')){
   const s=prepareStandaloneSource('UNIT_TEST_LONG_FAKE_TOKEN_12345678',source);
   if(s.includes(HASH_SENTINEL)||s.includes('UNIT_TEST_LONG_FAKE_TOKEN_12345678')||
      !s.includes('function doPost(e)'))fail('LOCAL_TEST');
   console.log('PERF_STANDALONE_SOURCE_CHECK_PASS');
  }else{
   const result=await provision({clasprc:process.env.CLASPRC_JSON,
    financeToken:process.env.GAS_ACCESS_TOKEN,source,
    financialScriptId:process.env.GAS_SCRIPT_ID,
    existingId:process.env.PERF_STANDALONE_SCRIPT_ID});
   console.log(JSON.stringify(result));
   if(process.env.GITHUB_STEP_SUMMARY)
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
      '## Isolated performance GAS (NOT financial GAS)\n'+
      '- Status: '+result.status+'\n- Script ID: '+result.scriptId+
      '\n- Web App: '+result.url+'\n- Financial source/sheet writes: 0\n');
  }
 }catch(e){
  const reason=/^PERF_STANDALONE_[A-Z_]+$/.test(e?.message||'')?e.message:'PERF_STANDALONE_UNVERIFIED';
  console.log(JSON.stringify({mode:'PERF_STANDALONE_GAS',status:'BLOCKED',
   reason,financialGASWrites:0,financialSheetWrites:0}));
  process.exitCode=2;
 }
}
