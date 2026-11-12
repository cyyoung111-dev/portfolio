#!/usr/bin/env node
// Reproduce the actual 2026-11-10 01:14 KST postdeploy outcome:
// published GAS 9.288, 2/2 current NH prices confirmed, then optional
// GAS diagnostic request timed out. Do not relabel an accepted deployment
// a failure, and do not fake full close coverage.
import assert from 'node:assert/strict';
import {activateNhRuntime} from './activate-nh-gas-runtime.mjs';

const url='https://script.google.com/macros/s/TEST_DEPLOYMENT_ID/exec';
const token='mock-private-gas-access-token';
const key='mock-private-nh-app-key',secret='mock-private-nh-secret';
async function simulate({deep='timeout',provider='NH',priceCount=2,
  authEnforced=true}={}) {
 const actions=[],reports=[];
 const request=async(requestUrl,opts)=>{
  assert.equal(requestUrl,url);
  assert.equal(opts.method,'POST');
  const action=opts.body.get('action');
  const auth=opts.body.get('accessToken');
  actions.push(action);
  if(auth!==token){
   assert.equal(action,'getSettings');
   return {ok:true,json:async()=>({status:authEnforced?'error':'ok'})};
  }
  if(action==='getSettings')return {ok:true,json:async()=>({
   status:'ok',gasVersion:'9.288',
   settings:{apiKeyStatus:{nh:{enabled:true}}}
  })};
  if(action==='retireLegacyMarketData')return {ok:true,json:async()=>({
   status:'ok',retired:true
  })};
  if(action==='getCodeListReadOnly')return {ok:true,json:async()=>({
   status:'ok',readOnly:true,gasVersion:'9.288',
   codes:[{code:'005930',type:'주식',currency:'KRW'},
    {code:'000660',type:'주식',currency:'KRW'}]
  })};
  if(action==='getPrices')return {ok:true,json:async()=>({
   status:'ok',priceLookup:{currentProvider:provider,tossResultCount:priceCount},
   prices:{'005930':76000,'000660':220000}
  })};
  if(action==='diagnoseNhMarketData'){
   if(deep==='timeout')throw Error('simulated secondary GAS timeout');
   if(deep==='invalid')return {ok:true,json:async()=>({status:'error'})};
   return {ok:true,json:async()=>({
    status:'ok',readOnly:true,quotesConnected:true,closeSampleComplete:true
   })};
  }
  throw Error('Unexpected GAS operation '+action);
 };
 let result,error;
 try {
  result=await activateNhRuntime({url,token,key,secret,request,
   report:report=>reports.push(report)});
 }catch(e){error=e;}
 return {result,error,actions,reports};
}
const timeout=await simulate();
assert.equal(timeout.error,undefined);
assert.equal(timeout.result.status,'NH_ACTIVE_SAMPLE_READBACK_CONFIRMED_DIAGNOSTIC_PENDING');
assert.equal(timeout.result.gasVersion,'9.288');
assert.equal(timeout.result.sampleCount,2);
assert.equal(timeout.result.deepDiagnosticVerified,false);
assert.equal(timeout.result.fullCoverageVerified,false);
assert.equal(timeout.result.closeVerified,false);
assert.deepEqual(timeout.actions,[
 'getSettings','getSettings','retireLegacyMarketData',
 'getCodeListReadOnly','getPrices','diagnoseNhMarketData'
]);
assert.equal(timeout.reports.at(-2).providerConfirmed,true);
assert.equal(timeout.reports.at(-2).positiveReturned,2);
assert.equal(timeout.reports.at(-1).status,'NH_RUNTIME_DEEP_DIAGNOSTIC_UNAVAILABLE');
assert.equal(timeout.reports.at(-1).closeSampleComplete,false);
for(const forbidden of [token,key,secret,url])
 assert(!JSON.stringify({result:timeout.result,reports:timeout.reports}).includes(forbidden));
const good=await simulate({deep:'ok'});
assert.equal(good.error,undefined);
assert.equal(good.result.status,'NH_ACTIVE_SAMPLE_READBACK_CONFIRMED');
assert.equal(good.result.deepDiagnosticVerified,true);
const invalid=await simulate({deep:'invalid'});
assert.equal(invalid.error,undefined);
assert.equal(invalid.result.status,'NH_ACTIVE_SAMPLE_READBACK_CONFIRMED_DIAGNOSTIC_PENDING');
assert.equal(invalid.result.deepDiagnosticVerified,false);
for(const [bad,expected] of [
 [{provider:'UNKNOWN'},'NH_RUNTIME_READBACK_PROVIDER_MISMATCH'],
 [{priceCount:1},'NH_RUNTIME_READBACK_NH_PRICES_MISSING'],
 [{authEnforced:false},'NH_RUNTIME_GAS_AUTH_NOT_ENFORCED']
]){
 const result=await simulate(bad);
 assert.equal(result.result,undefined);
 assert.equal(result.error?.message,expected);
}
// Separate transient GET errors from postdeployment mutation failures.
// All reports remain fixed enums; neither bearer nor NH credentials escape.
for(const [phase,kind] of [
 ['AUTH_PROBE','NETWORK_OR_TIMEOUT'],
 ['SETTINGS','HTTP_UNVERIFIED'],
 ['CONFIG_WRITE','JSON_UNVERIFIED'],
 ['LEGACY_CLEANUP','NETWORK_OR_TIMEOUT'],
 ['CODE_MASTER','HTTP_UNVERIFIED']
]){
 const sourceError='PRIVATE_NH_AND_GAS_ACCESS_SECRET';
 const bad=async(_requestUrl,opts)=>{
   const action=opts.body.get('action');
   const denied=opts.body.get('accessToken')!==token;
   const currentPhase=action==='getSettings'?(denied?'AUTH_PROBE':'SETTINGS')
     :({saveNhConfig:'CONFIG_WRITE',retireLegacyMarketData:'LEGACY_CLEANUP',
       getCodeListReadOnly:'CODE_MASTER'}[action]||'UNKNOWN');
   if(currentPhase===phase){
     if(kind==='NETWORK_OR_TIMEOUT')throw Error(sourceError);
     if(kind==='HTTP_UNVERIFIED')return {ok:false,status:503};
     return {ok:true,json:async()=>{throw Error(sourceError)}};
   }
   let payload={status:'ok'};
   if(denied)payload={status:'error'};
   else if(action==='getSettings')payload={status:'ok',gasVersion:'9.293',
     settings:{apiKeyStatus:{nh:{enabled:phase!=='CONFIG_WRITE'}}}};
   else if(action==='saveNhConfig')payload={status:'ok',nh:{enabled:true}};
   else if(action==='retireLegacyMarketData')payload={status:'ok',retired:true};
   else if(action==='getCodeListReadOnly')payload={status:'ok',readOnly:true,
     gasVersion:'9.293',codes:[{code:'005930',type:'주식',currency:'KRW'}]};
   else if(action==='getPrices')payload={status:'ok',
     priceLookup:{currentProvider:'NH',tossResultCount:1},
     prices:{'005930':76000}};
   else throw Error('UNEXPECTED_STAGE');
   return {ok:true,json:async()=>payload};
 };
 let code='';
 try{await activateNhRuntime({url,token,key,secret,request:bad});}
 catch(e){code=e.message;}
 assert.equal(code,'NH_RUNTIME_'+phase+'_'+kind,
   'NH failure must identify only its exact phase and transport classification');
 assert(!code.includes(sourceError)&&!code.includes(token)&&!code.includes(secret));
}
console.log(JSON.stringify({kind:'NH_POSTDEPLOY_SAMPLE_VERIFIED_OPTIONAL_DIAGNOSTIC_PENDING_PASS',
 scenarios:6,primaryNHFailuresStillBlock:true,
 deepTimeoutPreservesIncompleteStatus:true,
 financeWrites:0,gasDeployments:0,telegramSends:0}));
