#!/usr/bin/env node
// #860 independent live Writer Gate diagnostic for deployed 9.289.
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
 if(payload?.status!=='ok'||payload.gasVersion!=='9.289'||
  !g||!['OPEN','DRAINING'].includes(g.mode)||
  !Number.isSafeInteger(g.activeCount)||g.activeCount<0||
  g.activeCount>10000||g.repairAuthorized!==false)
  fail('RESPONSE_UNVERIFIED');
 return {kind:'ISSUE860_9289_WRITER_GATE_READONLY',
  gasVersion:'9.289',gateMode:g.mode,recordedActive:g.activeCount,
  recordedIdle:g.mode==='OPEN'&&g.activeCount===0,
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
