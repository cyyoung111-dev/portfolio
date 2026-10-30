import {pathToFileURL} from 'node:url';
import {callNhGasProxy,fetchNhNightProbeFromGas} from './nh-gas-proxy.mjs';

const PROBE_DAY='2026-10-30';
export function centralProbeWindow(now){
 const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{
  timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',
  hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now).map(x=>[x.type,x.value]));
 const date=p.year+'-'+p.month+'-'+p.day,minute=Number(p.hour)*60+Number(p.minute);
 return {date,allowed:date===PROBE_DAY&&minute>=480&&minute<780};
}
export async function readbackOnce({now=()=>new Date(),request=fetch,
 url=process.env.GAS_WEB_APP_URL,token=process.env.GAS_ACCESS_TOKEN,
 report=console.log}={}){
 const clock=centralProbeWindow(now());
 if(!clock.allowed){
   report(JSON.stringify({status:'NH_CENTRAL_PROBE_WINDOW_CLOSED',date:clock.date,noNhRequest:true}));
   return {skipped:true};
 }
 // Token check MUST NOT issue OAuth, and the proxy refuses a diagnostic
 // if GAS has no cached, unexpired token. Never print access tokens.
 let auth;
 try{auth=await callNhGasProxy('getNhAuthStatusProxy',{url,token,request});}
 catch{report(JSON.stringify({status:'NH_CENTRAL_STATUS_UNAVAILABLE'}));return {ok:false};}
 if(auth.tokenIssued!==false||auth.enabled!==true||auth.tokenCached!==true){
   report(JSON.stringify({status:'NH_CENTRAL_CACHED_TOKEN_ABSENT',issued:false,querySkipped:true}));
   return {ok:false};
 }
 report(JSON.stringify({status:'NH_CENTRAL_CACHED_TOKEN_READY',issued:false}));
 const reference=await fetchNhNightProbeFromGas(clock.date,{now,url,token,request});
 if(!reference){
   report(JSON.stringify({status:'NH_CENTRAL_0600_REFERENCE_UNVERIFIED',issued:false}));
   return {ok:false};
 }
 const result={status:'NH_CENTRAL_0600_REFERENCE_VERIFIED',date:reference.tradingDate,
   contract:reference.contract,contractMonth:reference.contractMonth,
   value:reference.value,sourceUpdatedAt:reference.sourceUpdatedAt,
   receivedAt:reference.receivedAt,officialClose:false,issued:false};
 report(JSON.stringify(result));
 return {ok:true,reference};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  if(process.env.GITHUB_EVENT_NAME!=='workflow_run'||process.env.GITHUB_REF!=='refs/heads/main')
   throw Error('NH_CENTRAL_PROBE_EVENT_DENIED');
  const result=await readbackOnce();
  if(result.ok!==true && result.skipped!==true)process.exitCode=1;
 }catch{console.error('NH_CENTRAL_PROBE_FAILED');process.exitCode=1;}
}
