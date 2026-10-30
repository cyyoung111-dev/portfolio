import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {formatMorningBriefing,fetchDatedDaily,sendTelegram} from './telegram-morning-briefing.mjs';
import {collectMorningSeries} from './telegram-morning-report.mjs';
import {fetchNhNightFromGas} from './nh-gas-proxy.mjs';
import {krxSessionStatus} from './krx-session-calendar.mjs';

export const DATE='2026-10-30';
export const CLAIM='telegram-morning-correction-claim-'+DATE;
const REPO='cyyoung111-dev/portfolio';
function clock(now){
  const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now).map(x=>[x.type,x.value]));
  return {date:p.year+'-'+p.month+'-'+p.day,hhmm:p.hour+':'+p.minute,minute:Number(p.hour)*60+Number(p.minute)};
}
export function validWindow(now){
  const t=clock(now);return t.date===DATE&&t.minute>=560&&t.minute<660;
}
export async function prepareCorrection({now=()=>new Date(),fetchImpl=fetch,token,repository=REPO,
  referenceFetch=fetchNhNightFromGas,quoteFetch=fetchDatedDaily}={}){
  if(!validWindow(now())||krxSessionStatus(DATE)!=='OPEN')throw Error('CORRECTION_WINDOW');
  if(repository!==REPO||!token)throw Error('CORRECTION_CONFIG');
  const response=await fetchImpl('https://api.github.com/repos/'+REPO+'/actions/artifacts?name='+CLAIM+'&per_page=100',{
    headers:{authorization:'Bearer '+token,accept:'application/vnd.github+json'},redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw Error('CORRECTION_CLAIM_LOOKUP_FAILED');
  const data=await response.json();
  if(!Number.isSafeInteger(data?.total_count)||!Array.isArray(data?.artifacts))throw Error('CORRECTION_CLAIM_SCHEMA');
  if(data.total_count>0){
    if(!data.artifacts.some(a=>a.name===CLAIM))throw Error('CORRECTION_CLAIM_SCHEMA');
    return {ready:false,status:'ALREADY_CLAIMED',date:DATE};
  }
  if(data.artifacts.length)throw Error('CORRECTION_CLAIM_SCHEMA');
  const [reference,rows]=await Promise.all([
    referenceFetch(DATE,{now,request:fetchImpl}),
    collectMorningSeries(DATE,{fetchDaily:quoteFetch,now:now(),fetchImpl}),
  ]);
  const hasRef=reference?.source==='NH'&&reference?.kind==='REFERENCE'
    &&reference?.tradingDate===DATE&&reference?.officialClose===false
    &&reference?.sourceUpdatedAt===DATE+'T06:00:00+09:00'
    &&Number.isFinite(reference.value)&&reference.value>0;
  const core=new Set(['^KS11','^KQ11','^GSPC','^SOX','^VIX','KRW=X']);
  if(rows.filter(r=>core.has(r.symbol)).length<4)throw Error('CORRECTION_CORE_DATA_INSUFFICIENT');
  if(!validWindow(now()))throw Error('CORRECTION_WINDOW_EXPIRED');
  const message='[10월 30일 장전 브리핑 정정본]\n앞서 발송한 축약본 대신 종합 시장 브리핑을 제공합니다. 기준일·데이터 공백을 확인하세요.\n\n'
    +formatMorningBriefing(DATE,hasRef?reference:null,rows);
  if(message.length>3900)throw Error('CORRECTION_MESSAGE_OVERLONG');
  return {ready:true,status:'PREPARED',date:DATE,claim:CLAIM,message,referenceSource:hasRef?'NH':'NONE',seriesCount:rows.length};
}
export async function sendCorrection(payload,{now=()=>new Date(),token,chatId,send=sendTelegram}={}){
  if(!validWindow(now())||payload?.date!==DATE||payload?.claim!==CLAIM
    ||typeof payload.message!=='string'||!payload.message.startsWith('[10월 30일 장전 브리핑 정정본]')
    ||payload.message.length>3900)throw Error('CORRECTION_SEND_DENIED');
  await send(token,chatId,payload.message);
  return {status:'SENT',date:DATE,seriesCount:payload.seriesCount,referenceSource:payload.referenceSource};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
   if(process.env.GITHUB_EVENT_NAME!=='push'||process.env.GITHUB_REF!=='refs/heads/main'
     ||process.env.GITHUB_RUN_ATTEMPT!=='1')throw Error('CORRECTION_EVENT_DENIED');
   if(process.argv[2]==='prepare'){
     const result=await prepareCorrection({token:process.env.GITHUB_TOKEN,repository:process.env.GITHUB_REPOSITORY});
     if(result.ready){
       fs.mkdirSync('.telegram-correction-runtime',{recursive:true});
       fs.writeFileSync('.telegram-correction-runtime/payload.json',JSON.stringify(result));
       fs.writeFileSync('.telegram-correction-runtime/claim.json',JSON.stringify({date:DATE,run:process.env.GITHUB_RUN_ID}));
     }
     fs.appendFileSync(process.env.GITHUB_OUTPUT,'ready='+result.ready+'\n');
     console.log(JSON.stringify({status:result.status,seriesCount:result.seriesCount||0,referenceSource:result.referenceSource||'NONE'}));
   }else if(process.argv[2]==='send'){
     console.log(JSON.stringify(await sendCorrection(JSON.parse(fs.readFileSync('.telegram-correction-runtime/payload.json','utf8')),
       {token:process.env.TELEGRAM_BOT_TOKEN,chatId:process.env.TELEGRAM_CHAT_ID})));
   }else throw Error('CORRECTION_MODE');
 }catch(e){console.error(String(e?.message||'CORRECTION_FAILED'));process.exitCode=1;}
}
