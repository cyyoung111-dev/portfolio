// Manually resend today's *actual* 38-company morning briefing for verification.
// Separate claim and SENT proof: never touches the regular 07:40 delivery claim.
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {runTelegramMorning,sendTelegram,lateTestWindow,fetchDatedDaily} from './telegram-morning-briefing.mjs';
import {expectedMorningDate} from './telegram-morning-report.mjs';
import {AI_EVENT_WATCH,selectAiEventHighlights} from './briefing-ai-event-watch.mjs';
import {loadCapturedNight} from './nh-capture-artifact.mjs';
import {compactBriefingForDelivery} from './briefing-message-compact.mjs';
import {readNasdaqDailyHistorical} from './briefing-nasdaq-daily-reference.mjs';
import {verifiedSkhyQuote} from './briefing-skhy-adr-parity.mjs';
import {krxSessionStatus} from './krx-session-calendar.mjs';

const REPO='cyyoung111-dev/portfolio';
const ROOT='.telegram-runtime';
const META=ROOT+'/manual-preview-meta.json';
const TEXT=ROOT+'/manual-preview-message.txt';
const SENT=ROOT+'/manual-preview-sent.json';
const COUNT=AI_EVENT_WATCH.length;
const coverageMin=Math.ceil(COUNT*0.6);
function fail(code){throw Error('MORNING_MANUAL_PREVIEW_'+code);}
function clock(now){
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{
  timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',
  hour:'2-digit',minute:'2-digit',hourCycle:'h23'
 }).formatToParts(now).map(x=>[x.type,x.value]));
 return {date:parts.year+'-'+parts.month+'-'+parts.day,
  hhmm:parts.hour+':'+parts.minute};
}
function authorize({now=new Date(),env=process.env}={}){
 const today=clock(now);
 if(env.GITHUB_REPOSITORY!==REPO||env.GITHUB_REF!=='refs/heads/main'
  ||Number(env.GITHUB_RUN_ATTEMPT)!==1
  ||env.TELEGRAM_PREVIEW_AUTHORIZED!=='true'
  ||!['push','workflow_dispatch'].includes(env.GITHUB_EVENT_NAME)
  ||!lateTestWindow(now).allowed||krxSessionStatus(today.date)!=='OPEN')
  fail('AUTH_OR_WINDOW_DENIED');
 return today;
}
async function checkUniqueClaim({date,token,fetchImpl=fetch}={}){
 if(typeof token!=='string'||!token)fail('GITHUB_TOKEN_MISSING');
 const name='telegram-morning-ai-preview-claim-'+date;
 const url='https://api.github.com/repos/'+REPO+'/actions/artifacts?name='+encodeURIComponent(name)+'&per_page=100';
 let response;
 try{response=await fetchImpl(url,{
  headers:{authorization:'Bearer '+token,accept:'application/vnd.github+json'},
  signal:AbortSignal.timeout(12000),redirect:'error'
 });}catch{fail('CLAIM_READ_FAILED');}
 if(!response?.ok)fail('CLAIM_READ_FAILED');
 let data;try{data=await response.json();}catch{fail('CLAIM_READ_FAILED');}
 if(!Number.isSafeInteger(data?.total_count)||!Array.isArray(data.artifacts))
  fail('CLAIM_SCHEMA_INVALID');
 if(data.total_count>0) return {available:false,name};
 return {available:true,name};
}
async function readManualWatch({date,now=new Date(),fetchDaily=fetchDatedDaily,fetchImpl=fetch}={}){
 const expectedUsDate=expectedMorningDate('NVDA',date,now);
 if(!expectedUsDate)fail('US_DATE_INVALID');
 const prices=Array(COUNT).fill(null);
 let cursor=0;
 const shortFetch=(url,options={})=>fetchImpl(url,{
  ...options,signal:AbortSignal.timeout(5000)});
 await Promise.all(Array.from({length:5},async()=>{
  while(cursor<COUNT){
   const i=cursor++,item=AI_EVENT_WATCH[i];
   for(const host of ['query1.finance.yahoo.com','query2.finance.yahoo.com']){
    try{
     const row=await fetchDaily(item.label,item.symbol,date,{
      host,now,fetchImpl:shortFetch,expectedSessionDate:expectedUsDate});
     if(row?.label!==item.label||row.symbol!==item.symbol
      ||row.source!=='Yahoo Finance 일봉'||row.date!==expectedUsDate
      ||!Number.isFinite(row.value)||row.value<=0
      ||!Number.isFinite(row.changePercent))continue;
     prices[i]={symbol:item.symbol,label:item.label,date:row.date,
      value:row.value,changePercent:row.changePercent,unit:'USD',
      source:'YAHOO_DAILY_REFERENCE'};
     break;
    }catch{/* Fail closed on missing provider, without affecting core market. */}
   }
   if(!prices[i]){
    const secondary=await readNasdaqDailyHistorical(item.symbol,expectedUsDate,
      {now,fetchImpl:shortFetch});
    if(secondary)prices[i]={...secondary,label:item.label,unit:'USD'};
   }
  }
 }));
 const verified=prices.filter(Boolean);
 console.log(JSON.stringify({kind:'AI_MANUAL_WATCH_SOURCE_COVERAGE',date,
  yahoo:verified.filter(x=>x.source==='YAHOO_DAILY_REFERENCE').length,
  nasdaq:verified.filter(x=>x.source==='NASDAQ_DAILY_REFERENCE').length,
  verified:verified.length,total:COUNT}));
 const events=verified.length>=coverageMin
  ?selectAiEventHighlights({expectedUsDate,prices:verified}):[];
 return {expectedUsDate,verified:verified.length,total:COUNT,events,
  skhyQuote:verifiedSkhyQuote(verified,expectedUsDate)};
}
export function makeManualPreviewMessage(date,body,watch,now=new Date()){
 if(typeof body!=='string'||!body.startsWith('[한국장 장전 종합 브리핑 | '+date+']'))
  fail('CORE_BODY_INVALID');
 const qc=/■ QC: 기준 거래일과 일치한 일봉 (\d+)\/(\d+) · 야간선물 (확보|미확보)/.exec(body);
 if(!qc||Number(qc[2])!==21||Number(qc[1])<3)fail('CORE_COVERAGE_INSUFFICIENT');
 if(watch?.total!==COUNT||watch.verified<coverageMin
  ||watch.expectedUsDate!==expectedMorningDate('NVDA',date,now))
  fail('AI_COVERAGE_INSUFFICIENT');
 // Verify that the actual production formatter included its selective changes.
 if(watch.events.length && !body.includes('■ AI 밸류체인 주요 변동 ('))
  fail('AI_EVENT_NOT_RENDERED');
 const title='[수동 검증 테스트 · '+date+' · 정규 장전 발송 아님]\n';
 const compact=compactBriefingForDelivery(body,{mode:'morning'});
 const time=clock(now).hhmm;
 const corrected=compact.replace('기준: 07:30 KST · 기준일별 종가 / 외부 참고값만 출처 표시',
   '테스트 재조회: '+time+' KST · 항목별 확정 종가와 기준일은 본문 참조');
 const suffix='\n■ AI 추적 확인: '+watch.verified+'/'+COUNT
  +'개사 · 중요 변동 '+watch.events.length+'건'
  +'\n※ 오늘 오전 07:40 당시 저장본이 아닌 사후 재조회 테스트입니다.';
 const message=title+corrected+suffix;
 if(message.length>4096)fail('MESSAGE_TOO_LONG');
 return message;
}
export async function prepare({now=()=>new Date(),env=process.env,
 fetchImpl=fetch,fetchDaily=fetchDatedDaily,writeFile=fs.writeFileSync,
 mkdir=fs.mkdirSync,readCapture=loadCapturedNight,
 collectCore=runTelegramMorning}={}){
 const current=authorize({now:now(),env});
 const claim=await checkUniqueClaim({date:current.date,token:env.GITHUB_TOKEN,fetchImpl});
 if(!claim.available)return {ready:false,status:'ALREADY_PREVIEW_CLAIMED',date:current.date};
 const watch=await readManualWatch({
  date:current.date,now:now(),fetchImpl,fetchDaily});
 if(watch.verified<coverageMin)fail('AI_COVERAGE_INSUFFICIENT');
 let reference=null;
 try{reference=await readCapture(current.date,{
  token:env.GITHUB_TOKEN,repository:REPO,fetchImpl,now});}catch{}
 let captured=null;
 await collectCore({
  now,fetchImpl,event:'schedule',attempt:1,allowLateTest:true,
  referenceFetch:async()=>reference,watchEvidence:{
   expectedUsDate:watch.expectedUsDate,events:watch.events,
   skhyQuote:watch.skhyQuote},
  send:async(_token,_chat,body)=>{captured=body;}
 });
 const message=makeManualPreviewMessage(current.date,captured,watch,now());
 const late=authorize({now:now(),env});
 if(late.date!==current.date)fail('DATE_CHANGED');
 const metadata={date:current.date,mode:'manual_preview',status:'PREPARED',
  artifactName:claim.name,verifiedAi:watch.verified,totalAi:watch.total,
  highlighted:watch.events.length,runId:String(env.GITHUB_RUN_ID||'')};
 mkdir(ROOT,{recursive:true});
 writeFile(TEXT,message,{flag:'wx',mode:0o600});
 writeFile(META,JSON.stringify(metadata),{flag:'wx',mode:0o600});
 writeFile(ROOT+'/manual-preview-claim.json',JSON.stringify({
  date:current.date,runId:metadata.runId,kind:'AI_MANUAL_PREVIEW'}),
  {flag:'wx',mode:0o600});
 return {ready:true,status:'PREPARED',...metadata};
}
export async function send({now=()=>new Date(),env=process.env,
 readFile=fs.readFileSync,writeFile=fs.writeFileSync,
 sendMessage=sendTelegram}={}){
 const current=authorize({now:now(),env});
 const meta=JSON.parse(readFile(META,'utf8'));
 const message=readFile(TEXT,'utf8');
 if(meta?.mode!=='manual_preview'||meta.status!=='PREPARED'
  ||meta.date!==current.date
  ||meta.artifactName!=='telegram-morning-ai-preview-claim-'+current.date
  ||meta.runId!==String(env.GITHUB_RUN_ID||'')
  ||!Number.isInteger(meta.verifiedAi)||meta.verifiedAi<coverageMin
  ||meta.totalAi!==COUNT
  ||!message.startsWith('[수동 검증 테스트 · '+current.date+' · 정규 장전 발송 아님]\n')
  ||message.length>4096)fail('PREPARED_PAYLOAD_INVALID');
 await sendMessage(env.TELEGRAM_BOT_TOKEN,env.TELEGRAM_CHAT_ID,message);
 const proof={date:current.date,status:'SENT',kind:'AI_MANUAL_PREVIEW',
  workflowRunId:meta.runId,verifiedAi:meta.verifiedAi,totalAi:COUNT,
  highlighted:meta.highlighted};
 writeFile(SENT,JSON.stringify(proof),{flag:'wx',mode:0o600});
 return proof;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const action=process.argv[2];
  if(action==='prepare'){
   const result=await prepare();
   fs.appendFileSync(process.env.GITHUB_OUTPUT,
    'ready='+(result.ready?'true':'false')+'\n'
    +'artifact_name='+(result.artifactName||'')+'\n');
   console.log(JSON.stringify({kind:'AI_MANUAL_MORNING_PREVIEW',
    status:result.status,date:result.date,verified:result.verifiedAi||0,
    total:COUNT,highlighted:result.highlighted||0}));
  }else if(action==='send'){
   const proof=await send();
   console.log(JSON.stringify({kind:'AI_MANUAL_MORNING_PREVIEW',...proof}));
  }else fail('INVALID_MODE');
 }catch(error){
  console.error(String(error?.message||'MORNING_MANUAL_PREVIEW_FAILED'));
  process.exitCode=1;
 }
}
