// One-time Saturday morning TEST. No weekday claim, GAS writes, NH OAuth or portfolio mutations.
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {krxSessionStatus} from './krx-session-calendar.mjs';
import {MORNING_SERIES,collectMorningSeries,hasExpectedMorningDate,formatFullMorningBriefing}
 from './telegram-morning-report.mjs';
import {fetchDatedDaily,loadMorningDomesticDailyIndexes,sendTelegram}
 from './telegram-morning-briefing.mjs';
import {NH_ONLY_INDEX_SYMBOLS,loadMorningMaster,mergeMorningSourceRows}
 from './telegram-morning-master.mjs';

export const DATE='2026-11-07';
export const REPO='cyyoung111-dev/portfolio';
export const CLAIM='telegram-saturday-20261107-morning-claim';
const PREFIX='[토요일 장전 브리핑 테스트 | '+DATE+']';
const ROUTE='.github/workflows/telegram-saturday-test-20261107.yml';
function clock(instant){
 if(!(instant instanceof Date)||!Number.isFinite(instant.getTime()))return null;
 const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{
  timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',
  hour:'2-digit',minute:'2-digit',hourCycle:'h23'
 }).formatToParts(instant).map(x=>[x.type,x.value]));
 return {date:p.year+'-'+p.month+'-'+p.day,minute:Number(p.hour)*60+Number(p.minute)};
}
export function testWindow(instant){
 const p=clock(instant);
 return {allowed:!!p&&p.date===DATE&&p.minute>=360&&p.minute<630,
  date:p?.date||null};
}
export function authorizeSaturday(eventName,event,instant){
 if(eventName!=='push'||event?.repository?.full_name!==REPO
  ||event?.ref!=='refs/heads/main'||!testWindow(instant).allowed)return false;
 // Only the one-use workflow-file push authorizes a Saturday send. GitHub's
 // paths filter enforces this, while the exact-file check narrows further.
 return Array.isArray(event?.commits)&&event.commits.length===1
  &&event.commits[0]?.added?.includes(ROUTE)===true;
}
export function countVerified(date,rows=[],now=new Date()){
 return MORNING_SERIES.filter(item=>
  rows.filter(x=>hasExpectedMorningDate(item,date,x,now)).length===1).length;
}
export async function composeSaturday({now=()=>new Date(),fetchImpl=fetch,
 gasUrl=process.env.GAS_WEB_APP_URL,gasToken=process.env.GAS_ACCESS_TOKEN,
 master=loadMorningMaster,domestic=loadMorningDomesticDailyIndexes,
 collect=collectMorningSeries}={}){
 // Do not invoke getBenchmarks: it can refresh NH OAuth on a weekend.
 // Existing market-master GAS reads and public exact-day daily feeds only.
 const [marketMaster,korean,reference]=await Promise.all([
  master(DATE,{url:gasUrl,token:gasToken,fetchImpl,now:now()}).catch(()=>[]),
  domestic(DATE,{fetchImpl,now}).catch(()=>[]),
  collect(DATE,{fetchDaily:fetchDatedDaily,fetchImpl,now:now(),
   skipSymbols:new Set([...NH_ONLY_INDEX_SYMBOLS,'^KS11','^KQ11','^KS200','BTC-USD'])}).catch(()=>[])
 ]);
 const rows=mergeMorningSourceRows(reference,marketMaster,[],korean);
 const core=formatFullMorningBriefing(DATE,null,rows,{now:now()});
 const header=PREFIX+'\n'
  +'TEST ONLY · 11월 7일(토) 한국장 휴장. 실시간 장전 신호/당일 종가가 아닙니다.\n'
  +'한국장은 11월 6일(금) 확정 종가만, 미국장은 검증된 11월 6일 완료장만 표시합니다.\n'
  +'미확보 지수는 이전 날짜 수치로 대체하지 않습니다.\n'
  +'SEC·DART 06:20 사전수집은 휴장일에 실행하지 않아 재무 패널 실수신은 별도 검증입니다.\n\n';
 const text=header+core;
 if(text.length>4000||!text.startsWith(PREFIX)||!text.includes('■ QC:'))
  throw Error('SATURDAY_TEST_MESSAGE_INVALID');
 return {text,sourceCount:countVerified(DATE,rows,now())};
}
export async function prepareSaturday({now=()=>new Date(),repository,gitToken,
 fetchImpl=fetch,compose=composeSaturday}={}){
 if(!testWindow(now()).allowed)return {ready:false,status:'OUTSIDE_TEST_WINDOW'};
 if(repository!==REPO||typeof gitToken!=='string'||!gitToken)
  throw Error('SATURDAY_TEST_CONFIG_INVALID');
 if(krxSessionStatus(DATE)!=='CLOSED'||krxSessionStatus('2026-11-06')!=='OPEN')
  throw Error('SATURDAY_TEST_CALENDAR_INVALID');
 let response,data;
 try{
  response=await fetchImpl('https://api.github.com/repos/'+REPO+
   '/actions/artifacts?name='+CLAIM+'&per_page=100',{
   headers:{authorization:'Bearer '+gitToken,accept:'application/vnd.github+json'},
   redirect:'error',signal:AbortSignal.timeout(10000)});
  if(!response?.ok)throw Error('CLAIM_HTTP');
  data=await response.json();
 }catch{throw Error('SATURDAY_TEST_CLAIM_LOOKUP_FAILED');}
 if(!Number.isSafeInteger(data?.total_count)||data.total_count<0
  ||!Array.isArray(data.artifacts)||(data.total_count===0&&data.artifacts.length))
  throw Error('SATURDAY_TEST_CLAIM_SCHEMA');
 if(data.total_count>0){
  if(!data.artifacts.some(a=>a?.name===CLAIM))
   throw Error('SATURDAY_TEST_CLAIM_SCHEMA');
  return {ready:false,status:'ALREADY_CLAIMED',date:DATE};
 }
 const result=await compose({now,fetchImpl});
 if(!testWindow(now()).allowed)throw Error('SATURDAY_TEST_WINDOW_EXPIRED');
 if(!result||typeof result.text!=='string'||result.text.length>4000
  ||!result.text.startsWith(PREFIX)||!result.text.includes('■ QC:'))
  throw Error('SATURDAY_TEST_MESSAGE_INVALID');
 return {ready:true,status:'PREPARED',date:DATE,claim:CLAIM,
  message:result.text,sourceCount:result.sourceCount||0};
}
export async function deliverSaturday(payload,{now=()=>new Date(),
 token,chatId,send=sendTelegram}={}){
 if(!testWindow(now()).allowed||payload?.date!==DATE
  ||payload?.claim!==CLAIM||typeof payload?.message!=='string'
  ||!payload.message.startsWith(PREFIX)||!payload.message.includes('■ QC:')
  ||payload.message.length>4000)throw Error('SATURDAY_TEST_SEND_DENIED');
 await send(token,chatId,payload.message);
 return {status:'SENT',testDate:DATE,sourceCount:payload.sourceCount||0};
}
export function saveSentSaturday(sent,payload,{
 path='.saturday-test-runtime/sent.json',runId='',writeFile=fs.writeFileSync
}={}){
 if(sent?.status!=='SENT'||sent.testDate!==DATE||payload?.date!==DATE
  ||payload.claim!==CLAIM||typeof path!=='string'||!path)
  throw Error('SATURDAY_TEST_SENT_PROOF_INVALID');
 const proof={status:'SENT',testDate:DATE,claim:CLAIM,runId:String(runId)};
 writeFile(path,JSON.stringify(proof),{flag:'wx'});
 return proof;
}
export async function deliverAndRecordSaturday(payload,opts={}){
 const sent=await deliverSaturday(payload,opts);
 saveSentSaturday(sent,payload,opts);
 return sent;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const event=JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH,'utf8'));
  if(process.env.GITHUB_REPOSITORY!==REPO
   ||process.env.GITHUB_REF!=='refs/heads/main'
   ||process.env.GITHUB_RUN_ATTEMPT!=='1'
   ||!authorizeSaturday(process.env.GITHUB_EVENT_NAME,event,new Date()))
   throw Error('SATURDAY_TEST_EVENT_DENIED');
  if(process.argv[2]==='prepare'){
   const prepared=await prepareSaturday({repository:REPO,gitToken:process.env.GITHUB_TOKEN});
   if(prepared.ready){
    fs.mkdirSync('.saturday-test-runtime',{recursive:true});
    fs.writeFileSync('.saturday-test-runtime/payload.json',JSON.stringify(prepared),{flag:'wx'});
    fs.writeFileSync('.saturday-test-runtime/claim.json',JSON.stringify({
     date:DATE,claim:CLAIM,runId:process.env.GITHUB_RUN_ID}),{flag:'wx'});
   }
   fs.appendFileSync(process.env.GITHUB_OUTPUT,
    'ready='+prepared.ready+'\nclaim='+(prepared.claim||'')+'\n');
   console.log(JSON.stringify({status:prepared.status,date:DATE,
    sourceCount:prepared.sourceCount||0,financialWrites:0}));
  }else if(process.argv[2]==='send'){
   const payload=JSON.parse(fs.readFileSync('.saturday-test-runtime/payload.json','utf8'));
   const sent=await deliverAndRecordSaturday(payload,{
    token:process.env.TELEGRAM_BOT_TOKEN,chatId:process.env.TELEGRAM_CHAT_ID,
    runId:process.env.GITHUB_RUN_ID||''});
   console.log(JSON.stringify(sent));
  }else throw Error('SATURDAY_TEST_MODE_INVALID');
 }catch(e){
  console.error(/^SATURDAY_TEST_[A-Z_]+$/.test(e?.message||'')
   ?e.message:'SATURDAY_TEST_FAILED');
  process.exitCode=1;
 }
}
