import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {scheduledWindow,lateTestWindow,runTelegramMorning,sendTelegram,fetchNightReference} from './telegram-morning-briefing.mjs';
import {loadCapturedNight} from './nh-capture-artifact.mjs';
import {deliveryTrigger} from './telegram-delivery-trigger.mjs';
import {deliverAndRecordWeekday} from './telegram-weekday-sent-proof.mjs';

export async function prepareMorning({now=()=>new Date(),fetchImpl=fetch,githubToken,repository,attempt=1,mode='rescue',run=runTelegramMorning,loadReference=loadCapturedNight,recoverReference=fetchNightReference,
  gasUrl=process.env.GAS_WEB_APP_URL,gasToken=process.env.GAS_ACCESS_TOKEN}={}) {
  if(repository!=='cyyoung111-dev/portfolio'||!githubToken||Number(attempt)!==1)throw Error('TELEGRAM_WORKFLOW_CONFIG');
  if(!['rescue','late_test'].includes(mode))throw Error('TELEGRAM_DISPATCH_MODE_INVALID');
  const lateTest=mode==='late_test';
  const window=lateTest?lateTestWindow(now()):scheduledWindow(now());
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
  let reference=await loadReference(window.date,{token:githubToken,repository,fetchImpl,now});
  let referenceOrigin=reference?'CAPTURE_ARTIFACT':'NONE';
  // Only when the pre-captured artifact is absent: one bounded, read-only
  // request through the existing GAS NH 06:00 proxy (no GitHub NH OAuth).
  // Never create an after-the-fact 06:00 observation or extend the 08:00 cutoff.
  const recoveryCutoff=Date.parse(window.date+'T08:00:00+09:00');
  const recoveryStart=Date.parse(window.date+'T07:40:00+09:00');
  const recoveryAt=now().getTime();
  if(!reference&&!lateTest&&gasUrl&&gasToken
    &&recoveryAt>=recoveryStart&&recoveryAt<recoveryCutoff){
    try{
      const recovered=await recoverReference(window.date,{
        now,url:gasUrl,token:gasToken,request:fetchImpl
      });
      if(recovered?.source==='NH'&&recovered.tradingDate===window.date
        &&recovered.sourceUpdatedAt===window.date+'T06:00:00+09:00'
        &&Number.isFinite(Date.parse(recovered.receivedAt))
        &&Date.parse(recovered.receivedAt)>=Date.parse(window.date+'T06:45:00+09:00')
        &&Date.parse(recovered.receivedAt)<recoveryCutoff
        &&now().getTime()<recoveryCutoff){
        reference=recovered;
        referenceOrigin='GAS_RECOVERY';
      }
    }catch{/* Preserve missing reference: never invent or reuse a stale tick. */}
  }
  const result=await run({now,fetchImpl,event:'schedule',attempt,allowLateTest:lateTest,referenceFetch:async()=>reference,send:async(_token,_chat,text)=>{message=text;}});
  if(!message)return {ready:false,status:result.status,date:window.date};
  const source=['NH'].includes(result.referenceSource)?result.referenceSource:'NONE';
  if(lateTest){
    // Do not count an all-unavailable message as a successful end-to-end market briefing test.
    // The formatter's QC count is the final authority after its source/date filters.
    const qc=/■ QC: 기준 거래일과 일치한 일봉 (\d+)\/(\d+) · NH 야선 (확보|미확보)/.exec(message||'');
    if(!qc||Number(qc[2])<1||Number(qc[1])>Number(qc[2])
      ||(Number(qc[1])===0&&qc[3]==='미확보'))throw Error('TELEGRAM_TEST_DATA_UNAVAILABLE');
    message=`[수동 지연 발송 테스트 · ${window.date} · 정규 장전 발송 아님]\n${message}`;
  }
  if(message.length>4000)throw Error('TELEGRAM_PREPARED_INVALID');
  return {ready:true,status:'PREPARED',date:window.date,artifactName,message,referenceSource:source,
    referenceOrigin:source==='NH'?referenceOrigin:'NONE',...(lateTest?{mode:'late_test'}:{})};
}
export async function deliverPrepared(payload,{now=()=>new Date(),token,chatId,attempt=1,mode='',send=sendTelegram}={}) {
  const lateTest=payload?.mode==='late_test';
  if((lateTest&&mode!=='late_test')||(!lateTest&&mode==='late_test')||(payload?.mode&& !lateTest))throw Error('TELEGRAM_PREPARED_INVALID');
  const window=lateTest?lateTestWindow(now()):scheduledWindow(now());
  if(Number(attempt)!==1||!window.allowed||payload?.date!==window.date
    ||payload?.artifactName!==`telegram-morning-claim-${window.date}`
    ||typeof payload.message!=='string'||!payload.message.length||payload.message.length>4000
    ||(lateTest&&!payload.message.startsWith(`[수동 지연 발송 테스트 · ${window.date} · 정규 장전 발송 아님]\n`)))throw Error('TELEGRAM_PREPARED_INVALID');
  await send(token,chatId,payload.message);
  return {status:'SENT',date:window.date};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  if(!['schedule','workflow_run','workflow_dispatch'].includes(process.env.GITHUB_EVENT_NAME))throw Error('TELEGRAM_EVENT_INVALID');
  // Manual workflow_dispatch must be a specifically selected guarded rescue.
  // Never let the connection-test mode (or an omitted mode) send market data.
  if(process.env.GITHUB_EVENT_NAME==='workflow_dispatch'
     &&!['rescue','late_test'].includes(process.env.TELEGRAM_DISPATCH_MODE))throw Error('TELEGRAM_DISPATCH_MODE_INVALID');
  if(!deliveryTrigger('morning',process.env,JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH,'utf8')),scheduledWindow(new Date()).allowed)){
   if(process.argv[2]==='prepare')fs.appendFileSync(process.env.GITHUB_OUTPUT,'ready=false\n');
   console.log(JSON.stringify({status:'OUTSIDE_DELIVERY_WINDOW'}));
   process.exit(0);
  }
  if(process.argv[2]==='prepare'){
   const result=await prepareMorning({githubToken:process.env.GITHUB_TOKEN,repository:process.env.GITHUB_REPOSITORY,attempt:process.env.GITHUB_RUN_ATTEMPT,mode:process.env.TELEGRAM_DISPATCH_MODE||'rescue'});
   if(result.ready){
    fs.mkdirSync('.telegram-runtime',{recursive:true});
    fs.writeFileSync('.telegram-runtime/payload.json',JSON.stringify(result));
    fs.writeFileSync('.telegram-runtime/claim.json',JSON.stringify({date:result.date,runId:process.env.GITHUB_RUN_ID}));
   }
   fs.appendFileSync(process.env.GITHUB_OUTPUT,`ready=${result.ready}\nartifact_name=${result.artifactName||''}\n`);
   console.log(JSON.stringify({status:result.status,date:result.date,referenceSource:result.referenceSource||'NONE',referenceOrigin:result.referenceOrigin||'NONE'}));
  }else if(process.argv[2]==='send'){
   const payload=JSON.parse(fs.readFileSync('.telegram-runtime/payload.json','utf8'));
   const sent=await deliverAndRecordWeekday(payload,{
     kind:'morning',deliver:(payload,options)=>deliverPrepared(payload,{...options,mode:process.env.TELEGRAM_DISPATCH_MODE||''}),
     token:process.env.TELEGRAM_BOT_TOKEN,chatId:process.env.TELEGRAM_CHAT_ID,
     attempt:process.env.GITHUB_RUN_ATTEMPT,
     path:'.telegram-runtime/sent.json',runId:process.env.GITHUB_RUN_ID||''
   });
   console.log(JSON.stringify(sent));
  }else throw Error('TELEGRAM_WORKFLOW_MODE');
 }catch(e){console.error(/^TELEGRAM_[A-Z_]+$/.test(e?.message||'')?e.message:'TELEGRAM_WORKFLOW_FAILED');process.exitCode=1;}
}
