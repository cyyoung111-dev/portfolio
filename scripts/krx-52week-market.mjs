// Official KRX stock OHLC only. This is a reference breadth metric, NOT
// a trade/portfolio writer or a certified split-adjusted market statistic.
import {krxSessionStatus} from './krx-session-calendar.mjs';

export const MARKETS=Object.freeze({
 KOSPI:Object.freeze({path:'/svc/apis/sto/stk_bydd_trd',min:400}),
 KOSDAQ:Object.freeze({path:'/svc/apis/sto/ksq_bydd_trd',min:600})
});
export const SOURCE='KRX_OFFICIAL_STOCK_DAILY_RAW_OHLC';
export const WINDOW=252;
const MIN_ARCHIVE_DATE='2025-10-01';
// Reviewed historical overlap only. 2026+ sessions use the production GAS
// KRX calendar. An unreviewed 2025 date or a future calendar is UNKNOWN.
const CLOSED_2025=new Set([
 '2025-10-03','2025-10-06','2025-10-07','2025-10-08',
 '2025-10-09','2025-12-25','2025-12-31'
]);
const day=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&
 Number.isFinite(Date.parse(d+'T00:00:00Z'))&&
 new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d;
const number=v=>{
 if(typeof v!=='number'&&typeof v!=='string')return null;
 const x=String(v).trim();
 if(!/^(?:0|[1-9]\d{0,11})(?:\.\d{1,4})?$|^[1-9]\d{0,2}(?:,\d{3})+(?:\.\d{1,4})?$/.test(x))return null;
 const n=Number(x.replaceAll(',',''));
 return Number.isFinite(n)&&n>0&&n<1e12?n:null;
};
export function sessionStatus(date){
 if(!day(date))return 'UNKNOWN';
 if(date.startsWith('2025-')&&date>=MIN_ARCHIVE_DATE){
  if([0,6].includes(new Date(date+'T00:00:00Z').getUTCDay()))return 'CLOSED';
  return CLOSED_2025.has(date)?'CLOSED':'OPEN';
 }
 return krxSessionStatus(date);
}
export function expectedSessions(date,count=WINDOW){
 if(!day(date)||sessionStatus(date)!=='OPEN'||!Number.isInteger(count)||
   count<1||count>WINDOW)throw Error('KRX52_SESSION_UNVERIFIED');
 const found=[];
 for(let t=Date.parse(date+'T00:00:00Z'),i=0;i<480&&found.length<count;i++,t-=86400000){
  const d=new Date(t).toISOString().slice(0,10),status=sessionStatus(d);
  if(status==='UNKNOWN')throw Error('KRX52_CALENDAR_UNVERIFIED');
  if(status==='OPEN')found.push(d);
 }
 if(found.length!==count)throw Error('KRX52_HISTORY_WINDOW_UNAVAILABLE');
 return found.reverse();
}
// The public KRX daily archive is NOT a same-day close feed. Source queries
// for the 2026-11-13 close returned HTTP 200 + empty OutBlock_1 at 21:28 KST,
// while the 2026-11-12 data verified for all five approved source routes.
// Use the most recent trading session whose *next KRX open day* has passed
// the T+1 publication threshold. The following API call must still verify
// actual source/date; this calendar rule never fabricates a quote.
const DAILY_RELEASE_KST_MINUTE=8*60+15;
function nextOpenSession(date){
 const stamp=Date.parse(date+'T00:00:00Z');
 for(let i=1;i<=14;i++){
  const candidate=new Date(stamp+i*86400000).toISOString().slice(0,10);
  const status=sessionStatus(candidate);
  if(status==='UNKNOWN')throw Error('KRX52_CALENDAR_UNVERIFIED');
  if(status==='OPEN')return candidate;
 }
 throw Error('KRX52_CALENDAR_UNVERIFIED');
}
export function completedSession(now=new Date()){
 if(!(now instanceof Date)||!Number.isFinite(now.getTime()))throw Error('KRX52_CLOCK_UNVERIFIED');
 const bits=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{
  timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',
  hour:'2-digit',minute:'2-digit',hourCycle:'h23'
 }).formatToParts(now).map(x=>[x.type,x.value]));
 const today=bits.year+'-'+bits.month+'-'+bits.day;
 const minutes=Number(bits.hour)*60+Number(bits.minute);
 const stamp=Date.parse(today+'T00:00:00Z');
 for(let i=0;i<20;i++){
  const date=new Date(stamp-i*86400000).toISOString().slice(0,10);
  const status=sessionStatus(date);
  if(status==='UNKNOWN')throw Error('KRX52_CALENDAR_UNVERIFIED');
  if(status!=='OPEN')continue;
  const publicationDay=nextOpenSession(date);
  // On a following open day, only after the conservative release buffer.
  // On later dates, this candidate has already passed its release window.
  if(publicationDay<today||
   (publicationDay===today&&minutes>=DAILY_RELEASE_KST_MINUTE))
   return date;
 }
 throw Error('KRX52_RELEASE_ELIGIBLE_SESSION_UNAVAILABLE');
}
export function parseOfficialStockDay(date,market,payload){
 const spec=MARKETS[market];
 if(!day(date)||sessionStatus(date)!=='OPEN'||!spec||
   !Array.isArray(payload?.OutBlock_1)||payload.OutBlock_1.length<spec.min||
   payload.OutBlock_1.length>4500)throw Error('KRX52_SOURCE_ROWS_UNVERIFIED');
 const seen=new Set(),rows=[];let suspended=0;
 for(const row of payload.OutBlock_1){
  const code=row?.ISU_CD,expected=date.replaceAll('-','');
  if(row?.BAS_DD!==expected||typeof code!=='string'||
    !/^[A-Za-z0-9]{6,20}$/.test(code)||seen.has(code))
    throw Error('KRX52_SOURCE_SCHEMA_UNVERIFIED');
  seen.add(code);
  const high=number(row.TDD_HGPRC),low=number(row.TDD_LWPRC),
    close=number(row.TDD_CLSPRC);
  // Suspended/nontrading issues have no valid daily high/low. They cannot
  // qualify for a continuous historical range; never replace zero with close.
  if(high===null||low===null||close===null||
    high<low||close>high||close<low){suspended++;continue;}
  rows.push([code,high,low,close]);
 }
 if(rows.length<spec.min||suspended>payload.OutBlock_1.length*0.35)
   throw Error('KRX52_OHLC_COVERAGE_UNVERIFIED');
 rows.sort((a,b)=>a[0].localeCompare(b[0],'en'));
 return {source:SOURCE,market,date,totalRows:seen.size,
  excludedRows:suspended,rows};
}
export function validMarketDay(value,date,market){
 if(!value||value.source!==SOURCE||value.market!==market||value.date!==date||
   !Number.isInteger(value.totalRows)||value.totalRows<MARKETS[market].min||
   value.totalRows>4500||!Number.isInteger(value.excludedRows)||
   value.excludedRows<0||value.totalRows!==value.excludedRows+value.rows?.length||
   !Array.isArray(value.rows)||value.rows.length<MARKETS[market].min||
   value.excludedRows>value.totalRows*0.35)return false;
 let prior='';
 for(const row of value.rows){
  if(!Array.isArray(row)||row.length!==4||
    typeof row[0]!=='string'||!/^[A-Za-z0-9]{6,20}$/.test(row[0])||
    row[0]<=prior||!row.slice(1).every(x=>typeof x==='number'&&
      Number.isFinite(x)&&x>0&&x<1e12)||
    row[2]>row[3]||row[3]>row[1])return false;
  prior=row[0];
 }
 return true;
}
export function verifyArchive(value){
 if(value===null||value===undefined)return {version:1,source:SOURCE,sessions:[],summaries:[]};
 if(value?.version!==1||value.source!==SOURCE||
  !Array.isArray(value.sessions)||value.sessions.length>WINDOW||
  !Array.isArray(value.summaries)||value.summaries.length>60)
  throw Error('KRX52_ARCHIVE_SCHEMA_UNVERIFIED');
 let prior='';
 for(const item of value.sessions){
  if(!day(item?.date)||item.date<=prior||
    sessionStatus(item.date)!=='OPEN'||!item.markets||
    Object.keys(item.markets).sort().join(',')!=='KOSDAQ,KOSPI'||
    !Object.keys(MARKETS).every(m=>validMarketDay(item.markets[m],item.date,m)))
    throw Error('KRX52_ARCHIVE_DAY_UNVERIFIED');
  prior=item.date;
 }
 let reportDate='';
 for(const r of value.summaries){
  if(!day(r?.date)||r.date<=reportDate||
    !['KOSPI','KOSDAQ'].every(m=>Number.isSafeInteger(r[m]?.highs)&&
     Number.isSafeInteger(r[m]?.lows)&&Number.isSafeInteger(r[m]?.eligible)&&
     r[m].highs>=0&&r[m].lows>=0&&r[m].eligible>=Math.max(r[m].highs,r[m].lows)))
    throw Error('KRX52_ARCHIVE_SUMMARY_UNVERIFIED');
  reportDate=r.date;
 }
 return value;
}
export function appendArchive(archive,expected,marketPair){
 const existing=verifyArchive(archive);
 if(!Array.isArray(expected)||expected.length!==WINDOW||
   !expected.every((d,i)=>day(d)&&(i===0||d>expected[i-1])))
   throw Error('KRX52_EXPECTED_WINDOW_UNVERIFIED');
 const next=new Map(existing.sessions.filter(s=>expected.includes(s.date))
  .map(s=>[s.date,s]));
 if(marketPair){
  const d=marketPair.date;
  if(!expected.includes(d)||!marketPair.markets||
    !Object.keys(MARKETS).every(m=>validMarketDay(marketPair.markets[m],d,m)))
   throw Error('KRX52_PAIR_UNVERIFIED');
  if(next.has(d)&&JSON.stringify(next.get(d))!==JSON.stringify(marketPair))
   throw Error('KRX52_EXISTING_DAY_CONFLICT');
  next.set(d,marketPair);
 }
 return verifyArchive({version:1,source:SOURCE,
  sessions:[...next.values()].sort((a,b)=>a.date.localeCompare(b.date)),
  summaries:existing.summaries});
}
export function countNewHighsAndLows(archive,expected){
 const verified=verifyArchive(archive);
 if(!Array.isArray(expected)||expected.length!==WINDOW||
   verified.sessions.length!==WINDOW||
   !expected.every((d,i)=>verified.sessions[i].date===d))
   return {status:'HISTORY_INCOMPLETE',required:WINDOW,
    available:verified.sessions.filter(x=>expected?.includes(x.date)).length,
    date:expected?.at(-1)||null,markets:null};
 const markets={};
 for(const m of Object.keys(MARKETS)){
  const history=new Map();
  for(const s of verified.sessions.slice(0,-1)){
   for(const [code,hi,lo] of s.markets[m].rows){
    const point=history.get(code)||{days:0,high:0,low:Infinity};
    point.days++;point.high=Math.max(point.high,hi);
    point.low=Math.min(point.low,lo);
    history.set(code,point);
   }
  }
  let highs=0,lows=0,eligible=0,shortHistory=0;
  const today=verified.sessions.at(-1).markets[m].rows;
  for(const [code,hi,lo] of today){
   const prev=history.get(code);
   // Require a complete 251-session observation for this same security;
   // new listings, renamings and trading suspensions are not guessed.
   if(prev?.days!==WINDOW-1){shortHistory++;continue;}
   eligible++;
   if(hi>prev.high)highs++;
   if(lo<prev.low)lows++;
  }
  markets[m]={highs,lows,net:highs-lows,eligible,shortHistory,
   observedToday:today.length};
 }
 return {status:'VERIFIED_RAW_UNADJUSTED_REFERENCE',date:expected.at(-1),
  window:WINDOW,markets,source:SOURCE,splitAdjusted:false,
  newListingsCounted:false};
}
export function updateSummary(archive,count){
 const v=verifyArchive(archive);
 if(count?.status!=='VERIFIED_RAW_UNADJUSTED_REFERENCE')return v;
 const row={date:count.date,
  KOSPI:count.markets.KOSPI,KOSDAQ:count.markets.KOSDAQ};
 const summaries=v.summaries.filter(x=>x.date!==row.date);
 summaries.push(row);
 summaries.sort((a,b)=>a.date.localeCompare(b.date));
 return verifyArchive({...v,summaries:summaries.slice(-60)});
}
export function render52WeekMarketCounts(count){
 if(count?.status!=='VERIFIED_RAW_UNADJUSTED_REFERENCE')return '';
 return ['KOSPI','KOSDAQ'].map(m=>{
  const x=count.markets[m];
  return m+' 52주 신규 고가 '+x.highs+' / 신규 저가 '+x.lows+
   ' (순 '+(x.net>=0?'+':'')+x.net+')';
 }).join(' · ')+' ['+count.date+' · KRX 원시 OHLC 참고 · 분할 미보정]';
}
