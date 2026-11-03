// READ-ONLY live health of the SEPARATE performance Apps Script deployment.
// Does not touch financial GAS or write any telemetry entries.
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';

const DEFAULT_URL='https://script.google.com/macros/s/AKfycbxv2UEdFW5ipjFxddbUyW7F3h6xj3cPkZVlLfSqGglabtjVdGuCJ0QsEHYHxwOasC7n7Q/exec';
function fail(code){throw Error('PERF_STANDALONE_PROBE_'+code)}
function derived(token){
 if(typeof token!=='string'||token.length<24)fail('FINANCE_TOKEN_UNVERIFIED');
 return createHash('sha256').update('portfolio-telemetry:v1|'+token).digest('hex');
}
export async function probeStandalone({financeToken,url=DEFAULT_URL,fetchImpl=fetch}={}){
 if(!/^https:\/\/script\.google\.com\/macros\/s\/[-a-zA-Z0-9_]+\/exec$/.test(url))
  fail('ENDPOINT_UNVERIFIED');
 const auth=derived(financeToken);
 const call=async(token)=>{
  const p=new URLSearchParams({action:'getPerformanceSummary',accessToken:token});
  let res;
  try{res=await fetchImpl(url,{method:'POST',headers:{
    'Content-Type':'application/x-www-form-urlencoded'},body:p.toString(),
    redirect:'follow',signal:AbortSignal.timeout(14000)})}
  catch{fail('NETWORK_UNVERIFIED')}
  if(!res?.ok)fail('HTTP_UNVERIFIED');
  let text;
  try{text=await res.text()}catch{fail('BODY_UNVERIFIED')}
  if(text.length>80000)fail('BODY_LIMIT');
  let data;try{data=JSON.parse(text)}catch{fail('JSON_UNVERIFIED')}
  return data;
 };
 const invalid=await call('definitely-invalid-auth');
 if(invalid?.status!=='error'||invalid.message!=='AUTH_REQUIRED')
  fail('UNAUTHENTICATED_DENIAL_UNVERIFIED');
 const valid=await call(auth);
 if(valid?.status!=='ok'||valid.enabled!==true||valid.windowDays!==7||
   !Array.isArray(valid.groups)||!Number.isInteger(valid.sampleCount)||valid.sampleCount<0)
   fail('AUTHORIZED_SUMMARY_UNVERIFIED');
 return {mode:'PERF_STANDALONE_LIVE_READONLY',status:'VERIFIED',
  unauthorizedRejected:true,readOnlySummary:true,windowDays:7,
  sampleCount:valid.sampleCount,financialGASWrites:0,financialSheetWrites:0};
}
export async function selfTest(){
 const x=await probeStandalone({financeToken:'FAKE_FINANCE_TOKEN_FOR_TESTS_123456',
   fetchImpl:async(url,o)=>{
    if(o.method!=='POST'||!o.body.startsWith('action=getPerformanceSummary'))throw Error('bad request');
    const tok=new URLSearchParams(o.body).get('accessToken');
    const isValid=tok===derived('FAKE_FINANCE_TOKEN_FOR_TESTS_123456');
    return {ok:true,text:async()=>JSON.stringify(isValid?
      {status:'ok',enabled:true,windowDays:7,sampleCount:3,groups:[]}:
      {status:'error',message:'AUTH_REQUIRED'})};
   }});
 if(x.status!=='VERIFIED'||x.sampleCount!==3)fail('LOCAL_TEST');
 console.log('PASS isolated GAS read-only live probe contract, denied/authorized cases');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  if(process.argv.includes('--self-test'))await selfTest();
  else console.log(JSON.stringify(await probeStandalone({financeToken:process.env.GAS_ACCESS_TOKEN})));
 }catch(e){
  const reason=/^PERF_STANDALONE_PROBE_[A-Z_]+$/.test(e?.message||'')?e.message:'PROBE_UNVERIFIED';
  console.log(JSON.stringify({mode:'PERF_STANDALONE_LIVE_READONLY',
    status:'BLOCKED',reason,financialGASWrites:0,financialSheetWrites:0}));
  process.exitCode=2;
 }
}
