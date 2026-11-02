import { krxSessionStatus } from './krx-session-calendar.mjs';
import {fetchNhNightFromGas} from './nh-gas-proxy.mjs';
import {readNhMorningIndexes} from './nh-morning-index-source.mjs';
import {readNhStoredMorningStocks} from './nh-morning-stock-history.mjs';
import {MORNING_SERIES, expectedMorningDate, collectMorningSeries, formatFullMorningBriefing} from './telegram-morning-report.mjs';
import domesticIndexEod from '../src/web/domain/market/domestic_index_eod.js';
import {loadMorningMaster,mergeMorningSourceRows,NH_ONLY_INDEX_SYMBOLS} from './telegram-morning-master.mjs';
export async function fetchNightReference(date,options={}) { return fetchNhNightFromGas(date,options); }
export async function loadMorningDomesticDailyIndexes(date,{fetchImpl=fetch,now=()=>new Date()}={}){
 const expected=expectedMorningDate('KOSPI',date);
 const prior=expected?expectedMorningDate('KOSPI',expected):null;
 if(!expected||!prior)return [];
 try{
  const out=await domesticIndexEod.loadSeries(['KOSPI','KOSDAQ','KOSPI200'],prior,expected,{fetchImpl,now});
  return ['KOSPI','KOSDAQ','KOSPI200'].flatMap(id=>{
   const config=MORNING_SERIES.find(x=>x.id===id),data=out.seriesMap[id]||[];
   const current=data.filter(x=>x.date===expected),before=data.filter(x=>x.date===prior);
   if(!config||current.length!==1||before.length!==1||current[0].source!=='FDR_KRX_CACHE'
      ||before[0].source!=='FDR_KRX_CACHE'||current[0].role!=='NON_NH_DAILY_INDEX')
    return [];
   return [{label:config.label,symbol:config.symbol,date:expected,value:current[0].value,
     changePercent:(current[0].value/before[0].value-1)*100,source:'FDR_KRX_CACHE',role:'NON_NH_DAILY_INDEX'}];
  });
 }catch{return [];}
}

// All supported verified daily sources; no abbreviated seven-ticker list.
const SERIES = MORNING_SERIES;
const DAY = 86400000;

function kstParts(instant) {
  const parts = new Intl.DateTimeFormat('en-GB', {timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(instant);
  return Object.fromEntries(parts.map(part=>[part.type,part.value]));
}
export function scheduledWindow(instant) {
  const p=kstParts(instant), date=`${p.year}-${p.month}-${p.day}`, minutes=Number(p.hour)*60+Number(p.minute);
  return {date,allowed:minutes>=460 && minutes<490};
}
// Explicit manual full-briefing verification; never expands the scheduled delivery gate.
// Local weekday 08:10–11:59 KST only. Calendar validity is checked again before generation.
export function lateTestWindow(instant) {
  const p=kstParts(instant),date=`${p.year}-${p.month}-${p.day}`;
  const minutes=Number(p.hour)*60+Number(p.minute);
  const weekday=new Date(date+'T00:00:00Z').getUTCDay();
  return {date,allowed:weekday>=1&&weekday<=5&&minutes>=490&&minutes<720};
}
function dateInZone(instant, zone) {
  const parts=new Intl.DateTimeFormat('en-GB',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(instant);
  const p=Object.fromEntries(parts.map(part=>[part.type,part.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
export async function fetchDatedDaily(label,symbol,tradingDate,{fetchImpl=fetch,now=new Date(),host='query1.finance.yahoo.com'}={}) {
  try {
    if(!['query1.finance.yahoo.com','query2.finance.yahoo.com'].includes(host))return null;
    const url=new URL(`https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}`);
    const end=Date.parse(`${tradingDate}T00:00:00Z`);
    url.searchParams.set('period1',String(Math.floor((end-14*DAY)/1000)));
    url.searchParams.set('period2',String(Math.floor((end+DAY)/1000)));
    url.searchParams.set('interval','1d');
    const response=await fetchImpl(url.toString(),{headers:{accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(12000)});
    if(!response.ok)return null;
    const chart=(await response.json())?.chart?.result?.[0];
    if(chart?.meta?.symbol!==symbol || !chart.meta.exchangeTimezoneName || !Array.isArray(chart.timestamp) || !Array.isArray(chart.indicators?.quote?.[0]?.close))return null;
    const rows=new Map(),closes=chart.indicators.quote[0].close;
    for(let i=0;i<Math.min(chart.timestamp.length,closes.length);i++){
      const epoch=Number(chart.timestamp[i]), value=Number(closes[i]);
      if(!Number.isFinite(epoch)||epoch<=0||!Number.isFinite(value)||value<=0||epoch*1000>now.getTime())continue;
      const date=dateInZone(new Date(epoch*1000),chart.meta.exchangeTimezoneName);
      // Daily candles from the briefing date may be incomplete; never call them a close.
      if(date>=tradingDate || date<new Date(end-8*DAY).toISOString().slice(0,10))continue;
      // BTC-USD is 24/7: Yahoo's current UTC daily candle is incomplete
      // until 00:00 UTC (09:00 KST), even if its timestamp is already past.
      if(symbol==='BTC-USD'&&date>=now.toISOString().slice(0,10))continue;
      rows.set(date,value);
    }
    const list=[...rows].sort((a,b)=>a[0].localeCompare(b[0]));
    if(!list.length)return null;
    const [date,value]=list.at(-1), prior=list.length>1?list.at(-2)[1]:null;
    return {label,symbol,date,value,changePercent:prior>0?(value/prior-1)*100:null,source:'Yahoo Finance 일봉'};
  } catch { return null; }
}
export function formatMorningBriefing(tradingDate, reference, rows,options={}) {
  return formatFullMorningBriefing(tradingDate, reference, rows,options);
}

export async function sendTelegram(token,chatId,message,{fetchImpl=fetch}={}) {
  if(!/^\d+:[A-Za-z0-9_-]{20,}$/.test(String(token||''))||! /^-?\d+$/.test(String(chatId||'')))throw new Error('TELEGRAM_CONFIG_INVALID');
  try {
    const response=await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chat_id:String(chatId),text:message,disable_web_page_preview:true}),redirect:'error',signal:AbortSignal.timeout(15000)});
    if(!response.ok || (await response.json())?.ok!==true)throw new Error('FAILED');
  } catch { throw new Error('TELEGRAM_SEND_UNCONFIRMED_DO_NOT_RETRY'); }
  return true;
}
export async function runTelegramMorning({now=()=>new Date(),fetchImpl=fetch,token,chatId,event='schedule',attempt=1,allowLateTest=false,referenceFetch=async()=>null,send=sendTelegram}={}) {
  if(Number(attempt)!==1)throw new Error('TELEGRAM_RETRY_BLOCKED');
  if(event==='test') { await send(token,chatId,'텔레그램 브리핑 연결 시험입니다. 실제 시장 브리핑은 아닙니다.',{fetchImpl}); return {status:'TEST_SENT'}; }
  if(event!=='schedule')throw new Error('TELEGRAM_EVENT_INVALID');
  const first=allowLateTest?lateTestWindow(now()):scheduledWindow(now());
  if(!first.allowed)throw new Error('TELEGRAM_SCHEDULE_LATE');
  const calendar=krxSessionStatus(first.date);
  if(calendar==='CLOSED')return {status:'MARKET_CLOSED'};
  if(calendar!=='OPEN')throw new Error('TELEGRAM_CALENDAR_UNKNOWN');
  // Bounded concurrency reduces Yahoo rate limiting; the message still
  // identifies missing inputs rather than inferring or reusing stale prices.
  // NH-supported indices never fall back to Yahoo or unverified GAS master.
  // Other independently labeled reference series retain their existing policy.
  const [candidate,masterRows,nhRows,domesticRows,nhStockRows]=await Promise.all([
    referenceFetch(first.date,{fetchImpl,now}),
    loadMorningMaster(first.date,{url:process.env.GAS_WEB_APP_URL,
      token:process.env.GAS_ACCESS_TOKEN,fetchImpl,now:now()}),
    readNhMorningIndexes(first.date,{url:process.env.GAS_WEB_APP_URL,
      token:process.env.GAS_ACCESS_TOKEN,fetchImpl,now:now()}),
    loadMorningDomesticDailyIndexes(first.date,{fetchImpl,now}),
    readNhStoredMorningStocks(first.date,{url:process.env.GAS_WEB_APP_URL,
      token:process.env.GAS_ACCESS_TOKEN,fetchImpl}),
  ]);
  const quotes=await collectMorningSeries(first.date,{fetchDaily:fetchDatedDaily,
    now:now(),fetchImpl,skipSymbols:new Set([...NH_ONLY_INDEX_SYMBOLS,'^KS11','^KQ11','^KS200',...nhRows.map(row=>row.symbol),...nhStockRows.map(row=>row.symbol)])});
  const values=mergeMorningSourceRows(quotes,masterRows,nhRows,domesticRows,nhStockRows);
  const last=allowLateTest?lateTestWindow(now()):scheduledWindow(now());
  if(last.date!==first.date||!last.allowed)throw new Error('TELEGRAM_SCHEDULE_LATE');
  const reference=candidate && candidate.source==='NH' && /^K[A-Z0-9]{8}$/.test(candidate.contract||'') && candidate.kind==='REFERENCE'
    && candidate.tradingDate===first.date && candidate.officialClose===false
    && Number.isFinite(candidate.value) && candidate.value>0
    && Number.isFinite(Date.parse(candidate.receivedAt)) && Date.parse(candidate.receivedAt)<=now().getTime()
    && candidate.sourceUpdatedAt===`${first.date}T06:00:00+09:00` ? candidate : null;
  const message=formatMorningBriefing(first.date,reference,values,{now:now()});
  await send(token,chatId,message,{fetchImpl});
  return {status:reference?'SENT_REFERENCE':'SENT_SOURCE_MISSING',seriesCount:values.length,
    referenceSource:reference?.source||'NONE',referenceDate:reference?.tradingDate||null,
    referenceTime:reference?.sourceUpdatedAt||null,referenceContract:reference?.contract||null};
}
if(process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  try {
    const event=process.env.GITHUB_EVENT_NAME==='schedule'?'schedule':process.env.TELEGRAM_MANUAL_TEST==='true'?'test':'invalid';
    const result=await runTelegramMorning({event,attempt:process.env.GITHUB_RUN_ATTEMPT,token:process.env.TELEGRAM_BOT_TOKEN,chatId:process.env.TELEGRAM_CHAT_ID});
    console.log(JSON.stringify(result));
  } catch(error) { console.error(String(error?.message||'TELEGRAM_BRIEFING_FAILED')); process.exitCode=1; }
}
