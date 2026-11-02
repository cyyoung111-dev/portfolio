import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {validateGasEndpoint,fetchNhNightProbeFromGas} from './nh-gas-proxy.mjs';

// One-off, non-mutating diagnosis. Never print the code master, prices,
// endpoint, credentials, raw provider responses, account data or error text.
const TARGET_CODES=Object.freeze(['NVDA','MU']);
const DAY='2026-11-03';
const REPO='cyyoung111-dev/portfolio';

export function classifyTargetMaster(reply){
 if(reply?.status!=='ok'||reply?.readOnly!==true||!Array.isArray(reply?.codes)
   ||reply.codes.length>20000)return {status:'MASTER_RESPONSE_UNVERIFIED'};
 return {status:'MASTER_READ_OK',items:TARGET_CODES.map(code=>{
   const matches=reply.codes.filter(item=>
     typeof item?.code==='string'&&item.code.trim().toUpperCase()===code);
   if(matches.length===0)return {code,state:'NOT_REGISTERED'};
   if(matches.length!==1)return {code,state:'DUPLICATE_REGISTRATION'};
   if(matches[0].currency!=='USD')return {code,state:'REGISTERED_NON_USD'};
   return {code,state:'REGISTERED_USD'};
 })};
}

function kstClock(date){
 const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{
   timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',
   hour:'2-digit',minute:'2-digit',hourCycle:'h23'
 }).formatToParts(date).map(x=>[x.type,x.value]));
 return {date:p.year+'-'+p.month+'-'+p.day,
   minute:Number(p.hour)*60+Number(p.minute)};
}

async function inspect(){
 if(process.env.GITHUB_REPOSITORY!==REPO||
   process.env.GITHUB_REF!=='refs/heads/main'||
   process.env.GITHUB_EVENT_NAME!=='push'||process.env.GITHUB_RUN_ATTEMPT!=='1')
   throw Error('MASTER_NIGHT_MAIN_ONLY');
 const p=kstClock(new Date());
 if(p.date!==DAY||p.minute<480||p.minute>=780)
   throw Error('MASTER_NIGHT_DIAGNOSTIC_WINDOW_EXPIRED');
 const url=validateGasEndpoint(process.env.GAS_WEB_APP_URL);
 const token=process.env.GAS_ACCESS_TOKEN;
 if(typeof token!=='string'||token.length<12)throw Error('MASTER_NIGHT_ACCESS_UNAVAILABLE');
 const body=new URLSearchParams({action:'getCodeListReadOnly',accessToken:token});
 let master={status:'MASTER_FETCH_FAILED'};
 try{
   const response=await fetch(url,{method:'POST',
     headers:{'content-type':'application/x-www-form-urlencoded;charset=UTF-8'},
     body,redirect:'follow',signal:AbortSignal.timeout(60000)});
   if(!response.ok)master={status:'MASTER_HTTP_UNAVAILABLE'};
   else{
     try{master=classifyTargetMaster(await response.json());}
     catch{master={status:'MASTER_JSON_UNAVAILABLE'};}
   }
 }catch(error){
   master={status:error?.name==='TimeoutError'?'MASTER_TIMEOUT_60S':'MASTER_FETCH_FAILED'};
 }
 console.log(JSON.stringify({kind:'NH_US_MASTER_PRESENCE_20261103',...master}));
 const nightErrors=[];
 let ref=null;
 try{ref=await fetchNhNightProbeFromGas(DAY,{
   now:()=>new Date(),
   url,token,
   onError:code=>{if(/^NH_(?:NIGHT|PROXY)_[A-Z0-9_]{1,70}$/.test(code))
     nightErrors.push(code);}
 });}catch{}
 console.log(JSON.stringify({kind:'NH_NIGHT_0600_REFERENCE_20261103',
   state:ref?'VERIFIED_READONLY_REFERENCE':'REFERENCE_UNVERIFIED',
   diagnosticReason:ref?null:nightErrors[0]||'NO_VALID_REFERENCE',
   tokenIssuanceRequested:false,providerDirectCalls:false,financialWrites:false}));
}

function selfTest(){
 assert.deepEqual(classifyTargetMaster({status:'ok',readOnly:true,codes:[
   {code:'nvda',currency:'USD'}, {code:'MU',currency:'USD'}]}),
   {status:'MASTER_READ_OK',items:[
     {code:'NVDA',state:'REGISTERED_USD'},{code:'MU',state:'REGISTERED_USD'}]});
 assert.deepEqual(classifyTargetMaster({status:'ok',readOnly:true,codes:[
   {code:'MU',currency:'KRW'}, {code:'MU',currency:'USD'}]}).items,
   [{code:'NVDA',state:'NOT_REGISTERED'},{code:'MU',state:'DUPLICATE_REGISTRATION'}]);
 assert.equal(classifyTargetMaster({status:'ok',codes:[]}).status,
   'MASTER_RESPONSE_UNVERIFIED');
 assert.equal(classifyTargetMaster({status:'error',readOnly:true,codes:[]}).status,
   'MASTER_RESPONSE_UNVERIFIED');
 assert.equal(classifyTargetMaster({status:'ok',readOnly:true,codes:[
   {code:'NVDA',currency:'KRW'}]}).items[0].state,'REGISTERED_NON_USD');
 assert.deepEqual(kstClock(new Date('2026-11-02T23:30:00Z')),
   {date:DAY,minute:510});
 console.log('NH_MASTER_NIGHT_READONLY_SELFTEST_PASS');
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 if(process.argv.includes('--self-test'))selfTest();
 else inspect().catch(error=>{
   console.error(/^MASTER_NIGHT_[A-Z_]+$/.test(error?.message||'')?
     error.message:'MASTER_NIGHT_DIAGNOSTIC_FAILED');
   process.exitCode=1;
 });
}
