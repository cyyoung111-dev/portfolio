#!/usr/bin/env node
// #734: metadata-only gate status GET through the already-published v9.288
// web app. Does not use the script.processes OAuth scope (403 in #42753249586).
// This DOES NOT authorize cleanup, a migration, or a writer exclusion claim.
import {pathToFileURL} from 'node:url';
import {validateWebAppUrl} from './diagnose-krx-operational.mjs';
import {composeGas9288TradeV2From9287Preview} from './compose-gas9288-trade-v2-from-9287-preview.mjs';

const PIN='9e8584032daf896c5cffedb02041b604ee82ed07';
function fail(reason){throw Error('ISSUE734_GATE_STATUS_'+reason);}
export function verifySafePublishedGateSource(){
 const {candidate,manifest}=composeGas9288TradeV2From9287Preview();
 if(manifest.candidateSourceGitBlob!==PIN||manifest.candidateVersion!=='9.288')
  fail('SOURCE_PIN_DRIFT');
 // Exact-pinned v9.288 source must bypass writer admission for this one
 // authenticated metadata request (no receipt creation or finance calls).
 const route="args[0].parameter.action==='getWriterGateStatus'";
 if(!candidate.includes(route)||!candidate.includes('return _issue507GateStatusRequest_(args[0].parameter);'))
  fail('STATUS_ROUTE_UNVERIFIED');
 const name='function _issue507GateStatusRequest_(params) {';
 const a=candidate.indexOf(name);
 if(a<0||candidate.indexOf(name,a+1)>=0)fail('HANDLER_UNVERIFIED');
 const b=candidate.indexOf('\n}',a);
 if(b<0)fail('HANDLER_UNVERIFIED');
 const handler=candidate.slice(a,b+2);
 if(!handler.includes('if(!_isAuthorizedRequest(params))')||
    !handler.includes('activeCount:Object.keys(s.active).length')||
    /\.setProperty\(|\.deleteProperty\(|\.copyTo\(|\.setValues\(/.test(handler))
  fail('HANDLER_MUTATION_OR_SCHEMA');
 return true;
}
export async function inspectGateStatus({
 url,token,fetchImpl=fetch,sourceCheck=verifySafePublishedGateSource
}={}){
 sourceCheck();
 const endpoint=validateWebAppUrl(url);
 if(typeof token!=='string'||token.length<12)fail('AUTH_MISSING');
 const target=new URL(endpoint);
 target.searchParams.set('action','getWriterGateStatus');
 target.searchParams.set('accessToken',token);
 let response;
 try{response=await fetchImpl(target.toString(),{
  method:'GET',redirect:'follow',signal:AbortSignal.timeout(25000)
 });}catch{fail('NETWORK_OR_TIMEOUT');}
 if(response?.ok!==true)fail('HTTP_UNVERIFIED');
 let payload;
 try{payload=await response.json();}catch{fail('JSON_UNVERIFIED');}
 if(!payload||payload.status!=='ok'||payload.gasVersion!=='9.288'||
    !payload.writerGate||!['OPEN','DRAINING'].includes(payload.writerGate.mode)||
    !Number.isSafeInteger(payload.writerGate.activeCount)||
    payload.writerGate.activeCount<0||
    payload.writerGate.repairAuthorized!==false)
  fail('LIVE_GATE_UNVERIFIED');
 const activeCount=payload.writerGate.activeCount;
 return {kind:'ISSUE734_PINNED_9288_WRITER_GATE_METADATA',
  status:payload.writerGate.mode==='OPEN'&&activeCount===0?
   'GATE_OPEN_NO_RECORDED_ACTIVE':'GATE_BLOCKED',
  observedGasVersion:'9.288',mode:payload.writerGate.mode,activeCount,
  observedActiveIsNotExecutionProof:true,terminalExecutionProof:false,
  externalWriterIsolated:false,approvedToCleanup:false,
  approvedToMigrate:false,financeWrites:0,scriptPropertyWrites:0,
  gasDeployments:0,telegramSends:0};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  console.log(JSON.stringify(await inspectGateStatus({
   url:process.env.GAS_WEB_APP_URL,token:process.env.GAS_ACCESS_TOKEN
  })));
 }catch(e){
  const m=String(e?.message||'');
  console.error(/^ISSUE734_GATE_STATUS_[A-Z0-9_]+$/.test(m)?
   m:'ISSUE734_GATE_STATUS_UNVERIFIED');
  process.exitCode=2;
 }
}
