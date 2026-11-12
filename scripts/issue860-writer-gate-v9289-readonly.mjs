#!/usr/bin/env node
// #860 independent live Writer Gate diagnostic for reviewed deployed 9.289 / 9.291 / 9.292.
// Does not change Script Properties or infer terminal execution ownership.
import {pathToFileURL} from 'node:url';
import {validateWebAppUrl} from './diagnose-krx-operational.mjs';

const fail=code=>{throw Error('ISSUE860_9289_WRITER_GATE_'+code);};
export async function readIssue860WriterGate({
 url,token,fetchImpl=fetch
}={}){
 const endpoint=validateWebAppUrl(url);
 if(typeof token!=='string'||token.length<12)fail('AUTH_MISSING');
 const target=new URL(endpoint);
 target.searchParams.set('action','getWriterGateStatus');
 target.searchParams.set('accessToken',token);
 let response;
 try{response=await fetchImpl(target.toString(),{
  method:'GET',redirect:'follow',signal:AbortSignal.timeout(30000)
 });}catch{fail('NETWORK_OR_TIMEOUT');}
 if(response?.ok!==true)fail('HTTP_UNVERIFIED');
 let payload;
 try{payload=await response.json();}catch{fail('JSON_UNVERIFIED');}
 const g=payload?.writerGate;
 if(payload?.status!=='ok'||!['9.289','9.291','9.292'].includes(payload.gasVersion)||
  !g||!['OPEN','DRAINING'].includes(g.mode)||
  !Number.isSafeInteger(g.activeCount)||g.activeCount<0||
  g.activeCount>10000||g.repairAuthorized!==false)
  fail('RESPONSE_UNVERIFIED');
 const v9292=payload.gasVersion==='9.292';
 const safeOwners=[];
 if(v9292) {
  if(!Array.isArray(g.activeOwners)||g.activeOwners.length!==g.activeCount
    ||!Number.isSafeInteger(g.timeoutRetirementCandidates)
    ||g.timeoutRetirementCandidates<0||g.timeoutRetirementCandidates>g.activeCount
    ||!Number.isSafeInteger(g.expiredUnconfirmedCount)||g.expiredUnconfirmedCount<0)
   fail('OWNER_SCHEMA_UNVERIFIED');
  for(const item of g.activeOwners) {
   if(!item||typeof item.functionName!=='string'||!item.functionName
     ||item.functionName.length>100
     ||!/^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$/.test(item.startedKst)
     ||!Number.isSafeInteger(item.ageMinutes)||item.ageMinutes<0
     ||typeof item.terminalReceiptPresent!=='boolean'
     ||typeof item.retirementEligible!=='boolean')
    fail('OWNER_SCHEMA_UNVERIFIED');
   safeOwners.push({functionName:item.functionName,startedKst:item.startedKst,
    ageMinutes:item.ageMinutes,terminalReceiptPresent:item.terminalReceiptPresent,
    retirementEligible:item.retirementEligible});
  }
 }
 return {kind:'ISSUE860_9289_WRITER_GATE_READONLY',
  gasVersion:payload.gasVersion,gateMode:g.mode,recordedActive:g.activeCount,
  recordedIdle:g.mode==='OPEN'&&g.activeCount===0,
  activeOwners:safeOwners,timeoutRetirementCandidates:v9292?g.timeoutRetirementCandidates:null,
  expiredUnconfirmedCount:v9292?g.expiredUnconfirmedCount:null,
  opaqueOwnerTokensExposed:false,
  processTerminalVerified:false,externalWriterExcluded:false,
  snapshotIntegrityVerified:false,
  readyForGAS9290Deploy:false,
  readCount:1,financeWrites:0,gasDeployments:0,
  scriptPropertyWrites:0,telegramSends:0};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{console.log(JSON.stringify(await readIssue860WriterGate({
  url:process.env.GAS_WEB_APP_URL,token:process.env.GAS_ACCESS_TOKEN
 })));}catch(e){
  const s=String(e?.message||'');
  console.error(/^ISSUE860_9289_WRITER_GATE_[A-Z0-9_]+$/.test(s)
   ?s:'ISSUE860_9289_WRITER_GATE_UNVERIFIED');process.exitCode=1;
 }
}
