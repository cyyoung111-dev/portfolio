import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {scheduledWindow,runTelegramMorning,sendTelegram} from './telegram-morning-briefing.mjs';
import {loadCapturedNight} from './nh-capture-artifact.mjs';
import {deliveryTrigger} from './telegram-delivery-trigger.mjs';
import {deliverAndRecordWeekday} from './telegram-weekday-sent-proof.mjs';

export async function prepareMorning({now=()=>new Date(),fetchImpl=fetch,githubToken,repository,attempt=1,run=runTelegramMorning,loadReference=loadCapturedNight}={}) {
  if(repository!=='cyyoung111-dev/portfolio'||!githubToken||Number(attempt)!==1)throw Error('TELEGRAM_WORKFLOW_CONFIG');
  const window=scheduledWindow(now());
  if(!window.allowed)throw Error('TELEGRAM_SCHEDULE_LATE');
  const artifactName=`telegram-morning-claim-${window.date}`;
  let response;
  try{response=await fetchImpl(`https://api.github.com/repos/${repository}/actions/artifacts?name=${artifactName}&per_page=100`,{
    headers:{authorization:`Bearer ${githubToken}`,accept:'application/vnd.github+json'},redirect:'error',signal:AbortSignal.timeout(15000)});}catch{throw Error('TELEGRAM_CLAIM_LOOKUP_FAILED');}
  if(!response.ok)throw Error('TELEGRAM_CLAIM_LOOKUP_FAILED');
  let data;try{data=await response.json();}catch{throw Error('TELEGRAM_CLAIM_LOOKUP_FAILED');}
  if(!Number.isSafeInteger(data.total_count)||!Array.isArray(data.artifacts))throw Error('TELEGRAM_CLAIM_SCHEMA');
  if(data.total_count===0&&data.artifacts.length)throw Error('TELEGRAM_CLAIM_SCHEMA');
  if(data.total_count>0){
    if(!data.artifacts.some(a=>a.name===artifactName))throw Error('TELEGRAM_CLAIM_SCHEMA');
    return {ready:false,status:'ALREADY_CLAIMED',date:window.date};
  }
  let message;
  const reference=await loadReference(window.date,{token:githubToken,repository,fetchImpl,now});
  const result=await run({now,fetchImpl,event:'schedule',attempt,referenceFetch:async()=>reference,send:async(_token,_chat,text)=>{message=text;}});
  if(!message)return {ready:false,status:result.status,date:window.date};
  const source=['NH'].includes(result.referenceSource)?result.referenceSource:'NONE';
  return {ready:true,status:'PREPARED',date:window.date,artifactName,message,referenceSource:source};
}
export async function deliverPrepared(payload,{now=()=>new Date(),token,chatId,attempt=1,send=sendTelegram}={}) {
  const window=scheduledWindow(now());
  if(Number(attempt)!==1||!window.allowed||payload?.date!==window.date
    ||payload?.artifactName!==`telegram-morning-claim-${window.date}`
    ||typeof payload.message!=='string'||!payload.message.length||payload.message.length>4000)throw Error('TELEGRAM_PREPARED_INVALID');
  await send(token,chatId,payload.message);
  return {status:'SENT',date:window.date};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  if(!['schedule','workflow_run','workflow_dispatch'].includes(process.env.GITHUB_EVENT_NAME))throw Error('TELEGRAM_EVENT_INVALID');
  // Manual workflow_dispatch must be a specifically selected guarded rescue.
  // Never let the connection-test mode (or an omitted mode) send market data.
  if(process.env.GITHUB_EVENT_NAME==='workflow_dispatch'
     &&process.env.TELEGRAM_DISPATCH_MODE!=='rescue')throw Error('TELEGRAM_DISPATCH_MODE_INVALID');
  if(!deliveryTrigger('morning',process.env,JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH,'utf8')),scheduledWindow(new Date()).allowed)){
   if(process.argv[2]==='prepare')fs.appendFileSync(process.env.GITHUB_OUTPUT,'ready=false\n');
   console.log(JSON.stringify({status:'OUTSIDE_DELIVERY_WINDOW'}));
   process.exit(0);
  }
  if(process.argv[2]==='prepare'){
   const result=await prepareMorning({githubToken:process.env.GITHUB_TOKEN,repository:process.env.GITHUB_REPOSITORY,attempt:process.env.GITHUB_RUN_ATTEMPT});
   if(result.ready){
    fs.mkdirSync('.telegram-runtime',{recursive:true});
    fs.writeFileSync('.telegram-runtime/payload.json',JSON.stringify(result));
    fs.writeFileSync('.telegram-runtime/claim.json',JSON.stringify({date:result.date,runId:process.env.GITHUB_RUN_ID}));
   }
   fs.appendFileSync(process.env.GITHUB_OUTPUT,`ready=${result.ready}\nartifact_name=${result.artifactName||''}\n`);
   console.log(JSON.stringify({status:result.status,date:result.date,referenceSource:result.referenceSource||'NONE'}));
  }else if(process.argv[2]==='send'){
   const payload=JSON.parse(fs.readFileSync('.telegram-runtime/payload.json','utf8'));
   const sent=await deliverAndRecordWeekday(payload,{
     kind:'morning',deliver:deliverPrepared,
     token:process.env.TELEGRAM_BOT_TOKEN,chatId:process.env.TELEGRAM_CHAT_ID,
     attempt:process.env.GITHUB_RUN_ATTEMPT,
     path:'.telegram-runtime/sent.json',runId:process.env.GITHUB_RUN_ID||''
   });
   console.log(JSON.stringify(sent));
  }else throw Error('TELEGRAM_WORKFLOW_MODE');
 }catch(e){console.error(/^TELEGRAM_[A-Z_]+$/.test(e?.message||'')?e.message:'TELEGRAM_WORKFLOW_FAILED');process.exitCode=1;}
}
