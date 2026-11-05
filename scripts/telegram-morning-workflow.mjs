import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {scheduledWindow,lateTestWindow,runTelegramMorning,sendTelegram,fetchNightReference} from './telegram-morning-briefing.mjs';
import {loadCapturedNight} from './nh-capture-artifact.mjs';
import {loadPrefetchedNight} from './telegram-morning-prefetch.mjs';
import {deliveryTrigger} from './telegram-delivery-trigger.mjs';
import {deliverAndRecordWeekday} from './telegram-weekday-sent-proof.mjs';
import {inspectMorningMessage} from './telegram-morning-source-coverage.mjs';
import {fearGreedDisplayStatus} from './briefing-fear-greed.mjs';

export async function prepareMorning({now=()=>new Date(),fetchImpl=fetch,githubToken,repository,attempt=1,mode='rescue',run=runTelegramMorning,loadReference=loadCapturedNight,
  loadPrefetch=loadPrefetchedNight,recoverReference=fetchNightReference,
  onRecoveryDiagnostic=()=>{},gasUrl=process.env.GAS_WEB_APP_URL,
  gasToken=process.env.GAS_ACCESS_TOKEN}={}) {
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
  const hadCapture=Boolean(reference);
  let referenceOrigin=reference?'CAPTURE_ARTIFACT':'NONE',recoveryDiagnostic='NOT_ATTEMPTED';
  if(!reference&&!lateTest){
    reference=await loadPrefetch(window.date,{now});
    if(reference)referenceOrigin='GAS_PREFETCH_0730';
  }
  // Only when the pre-captured artifact is absent: one bounded, read-only
  // request through the existing GAS NH 06:00 proxy (no GitHub NH OAuth).
  // Never create an after-the-fact 06:00 observation or extend the 08:00 cutoff.
  const recoveryCutoff=Date.parse(window.date+'T08:00:00+09:00');
  const recoveryStart=Date.parse(window.date+'T07:40:00+09:00');
  const recoveryAt=now().getTime();
  if(!reference&&!lateTest&&gasUrl&&gasToken
    &&recoveryAt>=recoveryStart&&recoveryAt<recoveryCutoff){
    let recovered=null,reason='RECOVERY_NO_VALID_REFERENCE';
    recoveryDiagnostic='RECOVERY_NO_VALID_REFERENCE';
    try{
      recovered=await recoverReference(window.date,{
        now,url:gasUrl,token:gasToken,request:fetchImpl,
        // Only preapproved fixed diagnostic enums; never log raw NH/GAS
        // errors, prices, credentials, account data or source payloads.
        onError:code=>{
          if(typeof code==='string'&&/^NH_(?:PROXY|NIGHT)_[A-Z0-9_]{1,70}$/.test(code))
            reason=code;
        }
      });
    }catch{reason='RECOVERY_CALL_FAILED';}
    const accepted=recovered?.source==='NH'&&recovered.tradingDate===window.date
      &&recovered.sourceUpdatedAt===window.date+'T06:00:00+09:00'
      &&Number.isFinite(Date.parse(recovered.receivedAt))
      &&Date.parse(recovered.receivedAt)>=Date.parse(window.date+'T07:30:00+09:00')
      &&Date.parse(recovered.receivedAt)<recoveryCutoff
      &&now().getTime()<recoveryCutoff;
    if(accepted){
      reference=recovered;
      referenceOrigin='GAS_RECOVERY';
    }else if(recovered){reason='RECOVERY_METADATA_REJECTED';}
    recoveryDiagnostic=accepted?'RECOVERY_VERIFIED':(
      /^NH_(?:NIGHT|PROXY)_[A-Z0-9_]{1,70}$/.test(reason)?reason
      :['RECOVERY_NO_VALID_REFERENCE','RECOVERY_CALL_FAILED',
        'RECOVERY_METADATA_REJECTED'].includes(reason)?reason:'RECOVERY_FAILED');
    try{onRecoveryDiagnostic({status:accepted?'VERIFIED':'NOT_VERIFIED',
      reason:accepted?null:recoveryDiagnostic});}catch{};
  }
  // The one-off punctual worker invokes prepareMorning directly and does not
  // provide onRecoveryDiagnostic. Always log this restricted provenance
  // summary so a missing 06:00 reference is not silently indistinguishable
  // from a missing NH token. Never log price, contract, endpoint or credential.
  if(!lateTest)console.log(JSON.stringify({kind:'NH_NIGHT_REFERENCE_CHAIN',
    date:window.date,capture:hadCapture?'VERIFIED':'UNAVAILABLE',
    source:referenceOrigin,recovery:recoveryDiagnostic}));
  const result=await run({now,fetchImpl,event:'schedule',attempt,allowLateTest:lateTest,
    referenceFetch:async()=>reference,send:async(_token,_chat,text)=>{message=text;},
    onSourceDiagnostic:entry=>{
      const allowed=['CONFIG_MISSING','ENDPOINT_INVALID','EXPECTED_DATE_INVALID','HTTP_UNAVAILABLE',
        'GAS_RESPONSE_INVALID','ALL_VERIFIED','PARTIAL_OR_MISSING','NETWORK_OR_PARSE_FAILED'];
      const reasons=['PROVENANCE_OR_SERIES_INVALID','SERIES_LENGTH_INVALID',
        'ROW_SCHEMA_OR_DUPLICATE','EXPECTED_CLOSE_UNAVAILABLE','PRIOR_CLOSE_UNAVAILABLE'];
      const ids=['SPX','NASDAQ','NDX'];
      if(!entry||entry.kind!=='NH_MORNING_INDEX_READ'||!allowed.includes(entry.status))return;
      const missing=Array.isArray(entry.missing)?entry.missing.filter(x=>ids.includes(x?.id)
        &&reasons.includes(x?.reason)).map(x=>({id:x.id,reason:x.reason})):[];
      const verified=Array.isArray(entry.verified)?entry.verified.filter(id=>ids.includes(id)):[];
      console.log(JSON.stringify({kind:'NH_MORNING_INDEX_READ',status:entry.status,
        missing,verified,expectedDate:entry.expectedDate||null}));
    }});

  if(!message)return {ready:false,status:result.status,date:window.date};
  const source=['NH'].includes(result.referenceSource)?result.referenceSource:'NONE';
  if(lateTest){
    // Do not count an all-unavailable message as a successful end-to-end market briefing test.
    // The formatter's QC count is the final authority after its source/date filters.
    const qc=/■ QC: 기준 거래일과 일치한 일봉 (\d+)\/(\d+) · 야간선물 (확보|미확보)/.exec(message||'');
    if(!qc||Number(qc[2])<1||Number(qc[1])>Number(qc[2])
      ||(Number(qc[1])===0&&qc[3]==='미확보'))throw Error('TELEGRAM_TEST_DATA_UNAVAILABLE');
    message=`[수동 지연 발송 테스트 · ${window.date} · 정규 장전 발송 아님]\n${message}`;
  }
  if(message.length>4000)throw Error('TELEGRAM_PREPARED_INVALID');
  const coverage=inspectMorningMessage(window.date,message,{now:now()});
  return {ready:true,status:'PREPARED',date:window.date,artifactName,message,coverage,referenceSource:source,
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
  // Diagnostic only after Telegram send confirmation; no score or payload log.
  console.log(JSON.stringify({kind:'CNN_FEAR_GREED_DELIVERY',briefing:'morning',
    date:window.date,status:fearGreedDisplayStatus(payload.message)}));
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
   const result=await prepareMorning({githubToken:process.env.GITHUB_TOKEN,repository:process.env.GITHUB_REPOSITORY,attempt:process.env.GITHUB_RUN_ATTEMPT,mode:process.env.TELEGRAM_DISPATCH_MODE||'rescue',
      onRecoveryDiagnostic:details=>console.log(JSON.stringify({kind:'NH_MORNING_REFERENCE_RECOVERY',...details}))});
   if(result.ready){
    fs.mkdirSync('.telegram-runtime',{recursive:true});
    fs.writeFileSync('.telegram-runtime/payload.json',JSON.stringify(result));
    fs.writeFileSync('.telegram-runtime/claim.json',JSON.stringify({date:result.date,runId:process.env.GITHUB_RUN_ID}));
   }
   fs.appendFileSync(process.env.GITHUB_OUTPUT,`ready=${result.ready}\nartifact_name=${result.artifactName||''}\n`);
   console.log(JSON.stringify({status:result.status,date:result.date,referenceSource:result.referenceSource||'NONE',referenceOrigin:result.referenceOrigin||'NONE',coverage:result.coverage||null}));
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
