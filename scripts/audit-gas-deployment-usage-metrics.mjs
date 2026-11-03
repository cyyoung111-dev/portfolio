// Authorized read-only GAS deployment usage audit. No deployment/Script/Sheets writes.
// Output: redacted roles and counts only; absence of 7-day traffic is NOT retirement approval.
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {fetchGoogleAuditToken} from './audit-published-gas-gate-readonly.mjs';
import {deploymentIdFromWebAppUrl} from './deploy-gas.mjs';

const API='https://script.googleapis.com/v1/projects/';
const MAX=25;
const NUMBER=/^(?:0|[1-9][0-9]{0,10})$/;
function fail(code){throw Error('GAS_USAGE_AUDIT_'+code)}
async function read(url,token,fetchImpl){
 let res;
 try{res=await fetchImpl(url,{method:'GET',headers:{
  Authorization:'Bearer '+token,Accept:'application/json'
 },redirect:'error',signal:AbortSignal.timeout(16000)})}
 catch{fail('NETWORK_UNVERIFIED')}
 if(res.status===403)return {denied:true};
 if(res.status===401)return {unauthorized:true};
 if(!res.ok)fail('HTTP_UNVERIFIED');
 let text;try{text=await res.text()}catch{fail('BODY_UNVERIFIED')}
 if(text.length>100000)fail('BODY_TOO_LARGE');
 try{return JSON.parse(text)}catch{fail('JSON_UNVERIFIED')}
}
export function countMetrics(payload){
 if(!payload||typeof payload!=='object'||Array.isArray(payload))fail('METRICS_SCHEMA');
 const sum=key=>{
   const items=payload[key]??[];
   if(!Array.isArray(items)||items.length>10)fail('METRICS_ARRAY_SCHEMA');
   return items.reduce((n,item)=>{
     if(!item||typeof item!=='object'||!NUMBER.test(String(item.value)) ||
       typeof item.startTime!=='string'||!Number.isFinite(Date.parse(item.startTime))||
       typeof item.endTime!=='string'||!Number.isFinite(Date.parse(item.endTime)))
       fail('METRICS_ROW_SCHEMA');
     return n+Number(item.value);
   },0);
 };
 const out={executions:sum('totalExecutions'),failures:sum('failedExecutions'),
   activeUserDaySum:sum('activeUsers')};
 if(out.failures>out.executions)fail('METRICS_COUNTS_INVALID');
 return out;
}
export async function auditDeploymentUsage({scriptId,expectedDeploymentId,token,fetchImpl=fetch}={}){
 if(!/^[A-Za-z0-9_-]{12,160}$/.test(String(scriptId||''))||
    !/^[A-Za-z0-9_-]{8,160}$/.test(String(expectedDeploymentId||''))||
    typeof token!=='string'||token.length<20)fail('CONFIG_UNVERIFIED');
 const root=API+encodeURIComponent(scriptId);
 const list=await read(root+'/deployments?pageSize=50',token,fetchImpl);
 if(list.denied||list.unauthorized)return {mode:'GAS_USAGE_METRICS_READ_ONLY',
   status:'BLOCKED',reason:'DEPLOYMENTS_ACCESS_DENIED',releaseAuthorized:false};
 if(!Array.isArray(list.deployments)||list.deployments.length>MAX||list.nextPageToken)
   fail('DEPLOYMENTS_INCOMPLETE');
 const deployments=list.deployments.filter(d=>d?.deploymentId!=='HEAD');
 if(deployments.length<1||deployments.length>MAX||
   !deployments.every(d=>typeof d?.deploymentId==='string'&&/^[A-Za-z0-9_-]{8,160}$/.test(d.deploymentId)))
   fail('DEPLOYMENTS_SCHEMA');
 if(deployments.filter(d=>d.deploymentId===expectedDeploymentId).length!==1)
   fail('EXPECTED_DEPLOYMENT_UNVERIFIED');
 const rows=[];
 for(const d of deployments){
   const url=new URL(root+'/metrics');
   url.searchParams.set('metricsGranularity','DAILY');
   url.searchParams.set('metricsFilter.deploymentId',d.deploymentId);
   const value=await read(url.toString(),token,fetchImpl);
   const role=d.deploymentId===expectedDeploymentId?'expected':'extra';
   if(value.denied){rows.push({role,availability:'SCOPE_DENIED'});continue}
   if(value.unauthorized){rows.push({role,availability:'AUTH_DENIED'});continue}
   const c=countMetrics(value);
   rows.push({role,availability:'OBSERVED',...c});
 }
 const extras=rows.filter(x=>x.role==='extra');
 const expected=rows.find(x=>x.role==='expected');
 const extraObserved=extras.filter(x=>x.availability==='OBSERVED');
 const extraExecutions=extraObserved.reduce((a,b)=>a+b.executions,0);
 return {mode:'GAS_USAGE_METRICS_READ_ONLY',
  status:'BLOCKED',reason:rows.some(x=>x.availability!=='OBSERVED')?
     'METRICS_PERMISSION_UNVERIFIED':'LEGACY_CALLERS_AND_WRITERS_NOT_ISOLATED',
  totalDeployments:rows.length,additionalDeployments:extras.length,
  metricsWindow:'DAILY_7_DAYS',
  expectedUsage:expected,
  extraMetricsReadCount:extraObserved.length,
  extraMetricsDeniedCount:extras.length-extraObserved.length,
  extraExecutionCount:extraExecutions,
  extraWithActivityCount:extraObserved.filter(x=>x.executions>0).length,
  extraZeroObservedCount:extraObserved.filter(x=>x.executions===0).length,
  // No deployment IDs, project IDs, credentials, URLs, code or user identities.
  absenceProvesNoCalls:false,oldDeploymentsMayBeRetired:false,
  releaseAuthorized:false,gasWrites:0,financeWrites:0,telegramSends:0};
}
export async function selfTest(){
 const token='FAKE_BEARER_TOKEN_TEST_1234';
 const scriptId='FAKE_SCRIPT_ID_12345',expectedDeploymentId='KNOWN_MAIN_DEPLOYMENT';
 const extra='ADDITIONAL_PRIVATE_ID_456';
 const requests=[];
 const response=(value,status=200)=>({status,ok:status>=200&&status<300,
  text:async()=>JSON.stringify(value)});
 const f=async (url,opts)=>{
   requests.push({url,opts});
   assert.equal(opts.method,'GET');
   assert.equal(opts.headers.Authorization,'Bearer '+token);
   if(url.includes('/metrics'))return response(
     url.includes(expectedDeploymentId)?{
       totalExecutions:[{value:'5',startTime:'2026-11-01T00:00:00Z',endTime:'2026-11-02T00:00:00Z'}],
       failedExecutions:[{value:'1',startTime:'2026-11-01T00:00:00Z',endTime:'2026-11-02T00:00:00Z'}]
     }:{totalExecutions:[]});
   return response({deployments:[{deploymentId:expectedDeploymentId},{deploymentId:extra}]});
 };
 const x=await auditDeploymentUsage({scriptId,expectedDeploymentId,token,fetchImpl:f});
 assert.equal(x.extraZeroObservedCount,1);
 assert.equal(x.extraExecutionCount,0);
 assert.equal(x.status,'BLOCKED');
 assert.equal(x.absenceProvesNoCalls,false);
 assert.equal(x.releaseAuthorized,false);
 assert.equal(requests.length,3);
 assert.ok(requests.every(x=>!['POST','PUT','DELETE','PATCH'].includes(x.opts.method)));
 assert.ok(!JSON.stringify(x).includes(extra));
 assert.ok(!JSON.stringify(x).includes(scriptId));
 assert.throws(()=>countMetrics({totalExecutions:[{value:'1.5',startTime:'2026-11-01T00:00:00Z',endTime:'2026-11-02T00:00:00Z'}]}),/SCHEMA/);
 const denied=await auditDeploymentUsage({scriptId,expectedDeploymentId,token,
  fetchImpl:async(url)=>url.includes('metrics')?response({},403):
    response({deployments:[{deploymentId:expectedDeploymentId},{deploymentId:extra}]})});
 assert.equal(denied.extraMetricsDeniedCount,1);
 assert.equal(denied.releaseAuthorized,false);
 console.log('PASS GAS usage metric audit: GET-only, 7-day zero not proof, redacted/denied fail-closed');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 if(process.argv.includes('--self-test'))await selfTest();
 else{
  try{
   const token=await fetchGoogleAuditToken({clasprc:process.env.CLASPRC_JSON});
   const result=await auditDeploymentUsage({
    scriptId:process.env.GAS_SCRIPT_ID,
    expectedDeploymentId:process.env.GAS_DEPLOYMENT_ID||
       deploymentIdFromWebAppUrl(process.env.GAS_WEB_APP_URL||''),
    token});
   console.log(JSON.stringify(result));
   // Audit is informational, never a release decision or approval.
  }catch(e){
   console.log(JSON.stringify({mode:'GAS_USAGE_METRICS_READ_ONLY',status:'BLOCKED',
     reason:/^GAS_USAGE_AUDIT_[A-Z_]+$/.test(e.message)?e.message:'METRICS_UNVERIFIED',
     releaseAuthorized:false,gasWrites:0,financeWrites:0,telegramSends:0}));
   process.exitCode=2;
  }
 }
}
