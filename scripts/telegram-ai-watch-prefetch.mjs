// Optional read-only AI event scan while the early-arm runner is waiting.
// Never writes GAS, market history, snapshots, GitHub or Telegram.
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {fetchDatedDaily} from './telegram-morning-briefing.mjs';
import {expectedMorningDate} from './telegram-morning-report.mjs';
import {krxSessionStatus} from './krx-session-calendar.mjs';
import {AI_EVENT_WATCH,selectAiEventHighlights} from './briefing-ai-event-watch.mjs';
import {readNasdaqDailyHistorical} from './briefing-nasdaq-daily-reference.mjs';
import {verifiedSkhyQuote} from './briefing-skhy-adr-parity.mjs';

export const WATCH_PATH='.telegram-runtime/ai-watch-morning.json';
function kstClock(now){
 const obj=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{
  timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',
  hour:'2-digit',minute:'2-digit',hourCycle:'h23'
 }).formatToParts(now).map(x=>[x.type,x.value]));
 return {date:obj.year+'-'+obj.month+'-'+obj.day,
  minutes:Number(obj.hour)*60+Number(obj.minute)};
}
function usMarketComplete(date,now){
 if(!date||!Number.isFinite(now.getTime()))return false;
 const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{
  timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',
  hour:'2-digit',minute:'2-digit',hourCycle:'h23'
 }).formatToParts(now).map(x=>[x.type,x.value]));
 const nyDate=p.year+'-'+p.month+'-'+p.day;
 return nyDate>date||(nyDate===date&&Number(p.hour)*60+Number(p.minute)>=975);
}
export async function collectEarlyAiWatch({now=()=>new Date(),fetchDaily=fetchDatedDaily,
 fetchImpl=fetch,writeFile=fs.writeFileSync,mkdir=fs.mkdirSync,path=WATCH_PATH}={}){
 const instant=now(),clock=kstClock(instant);
 // A late job must never postpone NH 07:30 prefetch or 07:40 send.
 if(clock.minutes<440||clock.minutes>=448
  ||krxSessionStatus(clock.date)!=='OPEN')return {status:'WATCH_WINDOW_SKIPPED'};
 const usDate=expectedMorningDate('NVDA',clock.date);
 if(!usMarketComplete(usDate,instant))return {status:'WATCH_US_SESSION_UNVERIFIED'};
 const prices=Array(AI_EVENT_WATCH.length).fill(null);
 let cursor=0;
 const limitedFetch=(url,options={})=>fetchImpl(url,{
  ...options,signal:AbortSignal.timeout(4500)});
 await Promise.all(Array.from({length:5},async()=>{
  while(cursor<AI_EVENT_WATCH.length){
   const index=cursor++,item=AI_EVENT_WATCH[index];
   for(const host of ['query1.finance.yahoo.com','query2.finance.yahoo.com']){
    try{
     const row=await fetchDaily(item.label,item.symbol,clock.date,
      {host,fetchImpl:limitedFetch,now:instant,expectedSessionDate:usDate});
     if(row?.label!==item.label||row.symbol!==item.symbol
      ||row.date!==usDate||row.source!=='Yahoo Finance 일봉'
      ||!Number.isFinite(row.value)||row.value<=0||!Number.isFinite(row.changePercent))continue;
     prices[index]={symbol:item.symbol,label:item.label,date:row.date,
      value:row.value,changePercent:row.changePercent,unit:'USD',
      source:'YAHOO_DAILY_REFERENCE'};
     break;
    }catch{/* optional source unavailable */}
   }
   if(!prices[index]){
    const row=await readNasdaqDailyHistorical(item.symbol,usDate,
      {now:instant,fetchImpl:limitedFetch});
    if(row)prices[index]={...row,label:item.label,unit:'USD'};
   }
  }
 }));
 const verified=prices.filter(Boolean);
 // A thin or provider-biased partial sample is not a valid Top-3 ranking.
 const enoughCoverage=verified.length>=Math.ceil(AI_EVENT_WATCH.length*0.6);
 const events=enoughCoverage
  ?selectAiEventHighlights({expectedUsDate:usDate,prices:verified}):[];
 const payload={schemaVersion:1,date:clock.date,expectedUsDate:usDate,
  verified:verified.length,total:AI_EVENT_WATCH.length,events,
  skhyQuote:verifiedSkhyQuote(verified,usDate)};
 try{
  mkdir('.telegram-runtime',{recursive:true});
  writeFile(path,JSON.stringify(payload),{flag:'wx',mode:0o600});
  return {status:'WATCH_VERIFIED_OPTIONAL',verified:verified.length,
   total:AI_EVENT_WATCH.length,selected:events.length};
 }catch{return {status:'WATCH_FILE_UNAVAILABLE'};}
}
export function loadEarlyAiWatch(date,{path=WATCH_PATH,now=()=>new Date(),
 readFile=fs.readFileSync}={}){
 try{
  const clock=kstClock(now()),raw=readFile(path,'utf8');
  if(clock.date!==date||clock.minutes<460||clock.minutes>=490
   ||typeof raw!=='string'||raw.length>5000)return null;
  const value=JSON.parse(raw),usDate=expectedMorningDate('NVDA',date);
  if(value?.schemaVersion!==1||value.date!==date||value.expectedUsDate!==usDate
   ||!Array.isArray(value.events)||value.events.length>3
   ||!Number.isInteger(value.verified)||!Number.isInteger(value.total)
   ||value.total!==AI_EVENT_WATCH.length||value.verified<0||value.verified>value.total
   ||value.events.some(x=>x?.date!==usDate||
    !AI_EVENT_WATCH.some(item=>item.symbol===x.symbol&&item.label===x.label))
   ||(value.skhyQuote!=null&&!verifiedSkhyQuote([value.skhyQuote],usDate)))
   return null;
  return {expectedUsDate:usDate,events:value.events,
   skhyQuote:value.skhyQuote||null};
 }catch{return null;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const result=await collectEarlyAiWatch();
  console.log(JSON.stringify({kind:'AI_WATCH_OPTIONAL',...result}));
 }catch{
  console.log(JSON.stringify({kind:'AI_WATCH_OPTIONAL',status:'WATCH_UNAVAILABLE'}));
 }
}
