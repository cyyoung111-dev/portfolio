import { krxSessionStatus } from './krx-session-calendar.mjs';
import {fetchNhNightFromGas} from './nh-gas-proxy.mjs';
import {readNhMorningIndexes} from './nh-morning-index-source.mjs';
import {readNhStoredMorningStocks} from './nh-morning-stock-history.mjs';
import {readFearGreed} from './briefing-fear-greed.mjs';
import {formatKofiaLiquidity} from './briefing-kofia-liquidity.mjs';
import {readMorningSupplements,formatMorningFutures,formatMorningTreasury,
 formatMorningVkospi,formatMorningTurnover,formatMorningBreadth} from './telegram-morning-supplements.mjs';
import {MORNING_SERIES, expectedMorningDate, collectMorningSeries, formatFullMorningBriefing} from './telegram-morning-report.mjs';
import {verifiedYahoo52WeekRange} from './briefing-yahoo-52week-range.mjs';
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
export async function fetchDatedDaily(label,symbol,tradingDate,{fetchImpl=fetch,
 now=new Date(),host='query1.finance.yahoo.com',
 include52Week=false,expectedSessionDate=null}={}) {
 try {
  if(!['query1.finance.yahoo.com','query2.finance.yahoo.com'].includes(host)
    ||!(now instanceof Date)||!Number.isFinite(now.getTime()))return null;
  const url=new URL(`https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}`);
  const end=Date.parse(`${tradingDate}T00:00:00Z`);
  if(!Number.isFinite(end))return null;
  // No new HTTP requests: selected morning Yahoo series reuse their existing
  // daily chart call, asking for sufficient history for a validated 52w range.
  // Other consumers retain the original two-week request.
  url.searchParams.set('period1',String(Math.floor((end-(include52Week?378:14)*DAY)/1000)));
  url.searchParams.set('period2',String(Math.floor((end+DAY)/1000)));
  url.searchParams.set('interval','1d');
  const response=await fetchImpl(url.toString(),{
   headers:{accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(12000)});
  if(!response.ok)return null;
  const chart=(await response.json())?.chart?.result?.[0];
  const quote=chart?.indicators?.quote?.[0];
  if(chart?.meta?.symbol!==symbol||!chart.meta.exchangeTimezoneName
    ||!Array.isArray(chart.timestamp)||!Array.isArray(quote?.close))return null;
  const rows=new Map(),annual=[];
  const closes=quote.close, highs=quote.high, lows=quote.low;
  // Never hide a missing OHLC candle when computing a 52-week extreme:
  // keep invalid historical rows so the range validator rejects the entire
  // optional range, while allowing independently valid recent closes through.
  let completeOhlcShape=chart.timestamp.length===closes.length
   &&Array.isArray(highs)&&highs.length===closes.length
   &&Array.isArray(lows)&&lows.length===closes.length;
  for(let i=0;i<chart.timestamp.length;i++){
   const epoch=Number(chart.timestamp[i]);
   if(!Number.isFinite(epoch)||epoch<=0){
    completeOhlcShape=false;continue;
   }
   if(epoch*1000>now.getTime())continue;
   const date=dateInZone(new Date(epoch*1000),chart.meta.exchangeTimezoneName);
   if(date>=tradingDate)continue; // today is an unfinished candle
   if(symbol==='BTC-USD'&&date>=now.toISOString().slice(0,10))continue;
   const value=closes[i];
   if(include52Week)annual.push({date,close:value,
    high:Array.isArray(highs)?highs[i]:null,
    low:Array.isArray(lows)?lows[i]:null});
   if(typeof value!=='number'||!Number.isFinite(value)||value<=0)continue;
   if(date<new Date(end-8*DAY).toISOString().slice(0,10))continue;
   rows.set(date,value);
  }
  const list=[...rows].sort((a,b)=>a[0].localeCompare(b[0]));
  if(!list.length)return null;
  // Yahoo KRW=X can include an extra Sunday FX candle before Monday's
  // 07:40 briefing. The latest chart bar then masks the already-completed
  // Friday candle. Select the EXACT expected session where provided; never
  // relabel the extra FX bar or accept an arbitrarily stale close.
  const selectedIndex=symbol==='KRW=X'&&expectedSessionDate
    ?list.findIndex(row=>row[0]===expectedSessionDate):list.length-1;
  if(selectedIndex<0)return null;
  const [date,value]=list[selectedIndex],prior=selectedIndex>0?list[selectedIndex-1][1]:null;
  const result={label,symbol,date,value,changePercent:prior>0
    ?(value/prior-1)*100:null,source:'Yahoo Finance 일봉'};
  if(include52Week&&completeOhlcShape&&expectedSessionDate===date){
   const range=verifiedYahoo52WeekRange(annual,date);
   if(range)result.range52w=range;
  }
  return result;
 }catch{return null;}
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
export async function runTelegramMorning({now=()=>new Date(),fetchImpl=fetch,token,chatId,event='schedule',attempt=1,allowLateTest=false,referenceFetch=async()=>null,send=sendTelegram,onSourceDiagnostic=()=>{},financialEvidence=null,financialEvidenceNow=null}={}) {
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
  const [candidate,masterRows,nhRows,domesticRows,nhStockRows,fearGreed]=await Promise.all([
    referenceFetch(first.date,{fetchImpl,now}),
    loadMorningMaster(first.date,{url:process.env.GAS_WEB_APP_URL,
      token:process.env.GAS_ACCESS_TOKEN,fetchImpl,now:now()}),
    readNhMorningIndexes(first.date,{url:process.env.GAS_WEB_APP_URL,
      token:process.env.GAS_ACCESS_TOKEN,fetchImpl,now:now(),onDiagnostic:onSourceDiagnostic}),
    loadMorningDomesticDailyIndexes(first.date,{fetchImpl,now}),
    readNhStoredMorningStocks(first.date,{url:process.env.GAS_WEB_APP_URL,
      token:process.env.GAS_ACCESS_TOKEN,fetchImpl}),
    readFearGreed({fetchImpl,now}),
  ]);
  const dailyReadStatuses=[];
  const [quotes,supplementRows]=await Promise.all([
    collectMorningSeries(first.date,{fetchDaily:fetchDatedDaily,
      now:now(),fetchImpl,skipSymbols:new Set([...NH_ONLY_INDEX_SYMBOLS,'^KS11','^KQ11','^KS200',...nhRows.map(row=>row.symbol),...nhStockRows.map(row=>row.symbol)]),
      onDiagnostic:entry=>dailyReadStatuses.push(entry)}),
    readMorningSupplements(first.date,{fetchImpl,now,fetchDaily:fetchDatedDaily,nhRows}).catch(()=>({}))
  ]);
  // Status-only data from attempted Yahoo rows, never the quote body.
  // External telemetry errors may not delay the actual Telegram delivery.
  try{onSourceDiagnostic({kind:'YAHOO_MORNING_DAILY_COVERAGE',
    statuses:dailyReadStatuses});}catch{}
  const values=mergeMorningSourceRows(quotes,masterRows,nhRows,domesticRows,nhStockRows);
  const supplements={
    usReferences:supplementRows.usReferences||[],
    futures:supplementRows.futures?.length
      ?formatMorningFutures(first.date,supplementRows.futures,now()):'',
    treasury:supplementRows.treasury?.length
      ?formatMorningTreasury(first.date,supplementRows.treasury):'',
    vkospi:supplementRows.vkospi?.length
      ?formatMorningVkospi(supplementRows.vkospi):'',
    turnover:supplementRows.turnover?.length
      ?formatMorningTurnover(supplementRows.turnoverDate||expectedMorningDate('KOSPI',first.date),
       supplementRows.turnover):'',
    breadth:supplementRows.breadth?.length
      ?formatMorningBreadth(first.date,supplementRows.breadth):'',
    liquidity:formatKofiaLiquidity(supplementRows.liquidity)
  };
  // Optional-source diagnostics are counts only: they must not conflate the
  // 21 confirmed daily rows with disconnected reference and liquidity feeds.
  try{onSourceDiagnostic({kind:'MORNING_OPTIONAL_COVERAGE',coverage:{
    futures:(supplementRows.futures||[]).length,
    treasury:(supplementRows.treasury||[]).length,
    vkospi:(supplementRows.vkospi||[]).length,
    turnover:(supplementRows.turnover||[]).length,
    breadth:(supplementRows.breadth||[]).length,
    kofiaDeposits:Boolean(supplementRows.liquidity?.deposits),
    kofiaMargin:Boolean(supplementRows.liquidity?.margin)
  }});}catch{}
  const last=allowLateTest?lateTestWindow(now()):scheduledWindow(now());
  if(last.date!==first.date||!last.allowed)throw new Error('TELEGRAM_SCHEDULE_LATE');
  const reference=candidate && candidate.source==='NH' && /^K[A-Z0-9]{8}$/.test(candidate.contract||'') && candidate.kind==='REFERENCE'
    && candidate.tradingDate===first.date && candidate.officialClose===false
    && Number.isFinite(candidate.value) && candidate.value>0
    && Number.isFinite(Date.parse(candidate.receivedAt)) && Date.parse(candidate.receivedAt)<=now().getTime()
    && candidate.sourceUpdatedAt===`${first.date}T06:00:00+09:00` ? candidate : null;
  const currentEvidence=typeof financialEvidenceNow==='function'
    ?financialEvidenceNow():financialEvidence;
  const message=formatMorningBriefing(first.date,reference,values,{
    now:now(),fearGreed,supplements,financialEvidence:currentEvidence});
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
