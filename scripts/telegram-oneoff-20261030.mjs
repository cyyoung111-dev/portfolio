import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { formatMorningBriefing, fetchDatedDaily, sendTelegram } from './telegram-morning-briefing.mjs';
import { fetchNhNightFromGas } from './nh-gas-proxy.mjs';
import { krxSessionStatus } from './krx-session-calendar.mjs';

// Explicitly scoped, single-date recovery for the missing scheduled briefing.
// Never enable this file as a recurring schedule.
export const ONEOFF_DATE = '2026-10-30';
export const ONEOFF_CLAIM = 'telegram-morning-claim-' + ONEOFF_DATE;
export const SERIES = Object.freeze([
  ['KOSPI','^KS11'],['KOSDAQ','^KQ11'],['S&P 500','^GSPC'],
  ['NASDAQ','^IXIC'],['반도체지수 SOX','^SOX'],['VIX','^VIX'],['원/달러','KRW=X'],
]);
export function oneoffWindow(instant) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB',{
    timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',
    hour:'2-digit',minute:'2-digit',hourCycle:'h23'
  }).formatToParts(instant).map(p=>[p.type,p.value]));
  const date = parts.year+'-'+parts.month+'-'+parts.day;
  const minutes = Number(parts.hour)*60 + Number(parts.minute);
  return {date,clock:parts.hour+':'+parts.minute,allowed:date===ONEOFF_DATE && minutes>=490 && minutes<630};
}
export async function prepareOneoff({
  now=()=>new Date(),fetchImpl=fetch,gitToken,repository,
  referenceFetch=fetchNhNightFromGas,quoteFetch=fetchDatedDaily
}={}) {
  const w=oneoffWindow(now());
  if (!w.allowed || krxSessionStatus(ONEOFF_DATE)!=='OPEN') throw Error('ONEOFF_DATE_OR_WINDOW_INVALID');
  if (repository!=='cyyoung111-dev/portfolio'||!gitToken) throw Error('ONEOFF_GITHUB_CONFIG_INVALID');
  const response=await fetchImpl('https://api.github.com/repos/'+repository+'/actions/artifacts?name='+ONEOFF_CLAIM+'&per_page=100',{
    headers:{authorization:'Bearer '+gitToken,accept:'application/vnd.github+json'},
    redirect:'error',signal:AbortSignal.timeout(15000),
  });
  if(!response.ok)throw Error('ONEOFF_CLAIM_LOOKUP_FAILED');
  const data=await response.json();
  if(!Number.isSafeInteger(data?.total_count)||!Array.isArray(data.artifacts))throw Error('ONEOFF_CLAIM_SCHEMA');
  if(data.total_count>0) {
    if(!data.artifacts.some(x=>x.name===ONEOFF_CLAIM))throw Error('ONEOFF_CLAIM_SCHEMA');
    return {ready:false,status:'ALREADY_CLAIMED'};
  }
  if(data.artifacts.length)throw Error('ONEOFF_CLAIM_SCHEMA');
  const [candidate,...quotes] = await Promise.all([
    referenceFetch(ONEOFF_DATE,{now,request:fetchImpl}),
    ...SERIES.map(([label,symbol])=>quoteFetch(label,symbol,ONEOFF_DATE,{fetchImpl,now:now()}))
  ]);
  const reference=candidate?.source==='NH'&&candidate?.kind==='REFERENCE'
    &&candidate?.tradingDate===ONEOFF_DATE&&candidate?.officialClose===false
    &&candidate?.sourceUpdatedAt===ONEOFF_DATE+'T06:00:00+09:00'?candidate:null;
  const rows=quotes.filter(Boolean);
  if(!reference && !rows.length)throw Error('ONEOFF_SOURCES_UNAVAILABLE');
  const end=oneoffWindow(now());
  if(!end.allowed)throw Error('ONEOFF_WINDOW_EXPIRED');
  const header='[10월 30일 브리핑 지연 발송]\n예약 누락으로 '+end.clock+
    ' KST에 수동 발송합니다. 장중 실시간 가격은 포함하지 않습니다.\n\n';
  const message=header+formatMorningBriefing(ONEOFF_DATE,reference,rows);
  if(message.length>4000)throw Error('ONEOFF_MESSAGE_TOO_LONG');
  return {ready:true,status:'PREPARED',date:ONEOFF_DATE,claim:ONEOFF_CLAIM,message,quoteCount:rows.length,nhReference:!!reference};
}
export async function deliverOneoff(payload,{now=()=>new Date(),token,chatId,send=sendTelegram}={}) {
  if(!oneoffWindow(now()).allowed||payload?.date!==ONEOFF_DATE||payload?.claim!==ONEOFF_CLAIM
    ||typeof payload.message!=='string'||!payload.message.startsWith('[10월 30일 브리핑 지연 발송]')
    ||payload.message.length>4000)throw Error('ONEOFF_SEND_BLOCKED');
  await send(token,chatId,payload.message);
  return {status:'SENT',date:ONEOFF_DATE,nhReference:payload.nhReference,quoteCount:payload.quoteCount};
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){
  try {
    if(process.env.GITHUB_EVENT_NAME!=='push'||process.env.GITHUB_REF!=='refs/heads/main'
      ||process.env.GITHUB_RUN_ATTEMPT!=='1')throw Error('ONEOFF_EVENT_DENIED');
    if(process.argv[2]==='prepare') {
      const result=await prepareOneoff({gitToken:process.env.GITHUB_TOKEN,repository:process.env.GITHUB_REPOSITORY});
      if(result.ready){
        fs.mkdirSync('.telegram-oneoff-runtime',{recursive:true});
        fs.writeFileSync('.telegram-oneoff-runtime/payload.json',JSON.stringify(result));
        fs.writeFileSync('.telegram-oneoff-runtime/claim.json',JSON.stringify({date:ONEOFF_DATE,runId:process.env.GITHUB_RUN_ID}));
      }
      fs.appendFileSync(process.env.GITHUB_OUTPUT,'ready='+result.ready+'\n');
      console.log(JSON.stringify({status:result.status,date:ONEOFF_DATE,quoteCount:result.quoteCount||0,nhReference:result.nhReference||false}));
    }else if(process.argv[2]==='send'){
      console.log(JSON.stringify(await deliverOneoff(JSON.parse(fs.readFileSync('.telegram-oneoff-runtime/payload.json','utf8')),
        {token:process.env.TELEGRAM_BOT_TOKEN,chatId:process.env.TELEGRAM_CHAT_ID})));
    }else throw Error('ONEOFF_MODE_INVALID');
  } catch(error){console.error(String(error?.message||'ONEOFF_FAILED'));process.exitCode=1;}
}
