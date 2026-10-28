import { krxSessionStatus } from './krx-session-calendar.mjs';
import { fetchPrekospiNight } from './prekospi-night-reference.mjs';
import { fetchTflNight } from './tfl-night-reference.mjs';

export async function fetchNightReference(date, options={}) {
  return await fetchTflNight(date, options) || await fetchPrekospiNight(date, options);
}

const SERIES = Object.freeze([
  ['KOSPI', '^KS11'], ['KOSDAQ', '^KQ11'], ['S&P 500', '^GSPC'],
  ['NASDAQ', '^IXIC'], ['반도체지수 SOX', '^SOX'], ['VIX', '^VIX'],
  ['원/달러', 'KRW=X'],
]);
const DAY = 86400000;

function kstParts(instant) {
  const parts = new Intl.DateTimeFormat('en-GB', {timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(instant);
  return Object.fromEntries(parts.map(part=>[part.type,part.value]));
}
export function scheduledWindow(instant) {
  const p=kstParts(instant), date=`${p.year}-${p.month}-${p.day}`, minutes=Number(p.hour)*60+Number(p.minute);
  return {date,allowed:minutes>=510 && minutes<540};
}
function dateInZone(instant, zone) {
  const parts=new Intl.DateTimeFormat('en-GB',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(instant);
  const p=Object.fromEntries(parts.map(part=>[part.type,part.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
export async function fetchDatedDaily(label,symbol,tradingDate,{fetchImpl=fetch,now=new Date()}={}) {
  try {
    const url=new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`);
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
      rows.set(date,value);
    }
    const list=[...rows].sort((a,b)=>a[0].localeCompare(b[0]));
    if(!list.length)return null;
    const [date,value]=list.at(-1), prior=list.length>1?list.at(-2)[1]:null;
    return {label,symbol,date,value,changePercent:prior>0?(value/prior-1)*100:null,source:'Yahoo Finance 일봉'};
  } catch { return null; }
}
export function formatMorningBriefing(tradingDate, reference, rows) {
  const lines=[`[${tradingDate} 장전 시장 요약]`, ''];
  if(reference) lines.push(`코스피200 야간선물 참고: ${reference.value.toFixed(2)} (${reference.source === 'TFL' ? 'TFL' : 'PreKOSPI'} 마지막 수집값, ${reference.tradingDate} 06:00 기준${reference.contract ? `, 계약 ${reference.contract}` : ''}. 공식 종가 확인 전)`);
  else lines.push('코스피200 야간선물: 당일 참고값 미확보');
  lines.push('', '전일 시장 지표 (Yahoo Finance 일봉, 지연 가능)');
  for(const [label,symbol] of SERIES){
    const row=(rows||[]).find(item=>item?.symbol===symbol && item.label===label);
    if(!row){lines.push(`${label}: 미확보`);continue;}
    const change=Number.isFinite(row.changePercent)?` (${row.changePercent>=0?'+':''}${row.changePercent.toFixed(2)}%)`:'';
    lines.push(`${label}: ${row.value.toLocaleString('en-US',{maximumFractionDigits:2})}${change} · ${row.date}`);
  }
  lines.push('', '각 수치는 기준일을 확인하세요. 야간선물은 외부 사이트 참고값이며 KRX 공식 확정 종가가 아닙니다.');
  return lines.join('\n');
}
export async function sendTelegram(token,chatId,message,{fetchImpl=fetch}={}) {
  if(!/^\d+:[A-Za-z0-9_-]{20,}$/.test(String(token||''))||! /^-?\d+$/.test(String(chatId||'')))throw new Error('TELEGRAM_CONFIG_INVALID');
  try {
    const response=await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chat_id:String(chatId),text:message,disable_web_page_preview:true}),redirect:'error',signal:AbortSignal.timeout(15000)});
    if(!response.ok || (await response.json())?.ok!==true)throw new Error('FAILED');
  } catch { throw new Error('TELEGRAM_SEND_UNCONFIRMED_DO_NOT_RETRY'); }
  return true;
}
export async function runTelegramMorning({now=()=>new Date(),fetchImpl=fetch,token,chatId,event='schedule',attempt=1,referenceFetch=fetchNightReference,send=sendTelegram}={}) {
  if(Number(attempt)!==1)throw new Error('TELEGRAM_RETRY_BLOCKED');
  if(event==='test') { await send(token,chatId,'텔레그램 브리핑 연결 시험입니다. 실제 시장 브리핑은 아닙니다.',{fetchImpl}); return {status:'TEST_SENT'}; }
  if(event!=='schedule')throw new Error('TELEGRAM_EVENT_INVALID');
  const first=scheduledWindow(now());
  if(!first.allowed)throw new Error('TELEGRAM_SCHEDULE_LATE');
  const calendar=krxSessionStatus(first.date);
  if(calendar==='CLOSED')return {status:'MARKET_CLOSED'};
  if(calendar!=='OPEN')throw new Error('TELEGRAM_CALENDAR_UNKNOWN');
  const [candidate,...values]=await Promise.all([
    referenceFetch(first.date,{fetchImpl,now}),
    ...SERIES.map(([label,symbol])=>fetchDatedDaily(label,symbol,first.date,{fetchImpl,now:now()})),
  ]);
  const last=scheduledWindow(now());
  if(last.date!==first.date||!last.allowed)throw new Error('TELEGRAM_SCHEDULE_LATE');
  const reference=candidate && (candidate.source==='PREKOSPI' || (candidate.source==='TFL' && /^[A-Z0-9]{4,12}$/.test(candidate.contract||''))) && candidate.kind==='REFERENCE'
    && candidate.tradingDate===first.date && candidate.officialClose===false
    && Number.isFinite(candidate.value) && candidate.value>0
    && Number.isFinite(Date.parse(candidate.receivedAt)) && Date.parse(candidate.receivedAt)<=now().getTime()
    && candidate.sourceUpdatedAt===`${first.date}T06:00:00+09:00` ? candidate : null;
  const message=formatMorningBriefing(first.date,reference,values.filter(Boolean));
  await send(token,chatId,message,{fetchImpl});
  return {status:reference?'SENT_REFERENCE':'SENT_SOURCE_MISSING',seriesCount:values.filter(Boolean).length};
}
if(process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  try {
    const event=process.env.GITHUB_EVENT_NAME==='schedule'?'schedule':process.env.TELEGRAM_MANUAL_TEST==='true'?'test':'invalid';
    const result=await runTelegramMorning({event,attempt:process.env.GITHUB_RUN_ATTEMPT,token:process.env.TELEGRAM_BOT_TOKEN,chatId:process.env.TELEGRAM_CHAT_ID});
    console.log(JSON.stringify(result));
  } catch(error) { console.error(String(error?.message||'TELEGRAM_BRIEFING_FAILED')); process.exitCode=1; }
}
