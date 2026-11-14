// Issue #734: KIS adjusted OHLC verification for ONE stock and ONE exact
// 252-KRX-session window. Diagnostic only: no token handling, market-wide
// publishing, GAS/portfolio writes or Telegram integration.
import {WINDOW,expectedSessions,MARKETS,SOURCE,verifyArchive} from './krx-52week-market.mjs';

export const KIS_ADJUSTED_SOURCE='KIS_FHKST03010100_ADJUSTED_OHLC';
export const KIS_ADJUSTED_TR='FHKST03010100';
export const KIS_ADJUSTED_PATH='/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice';
const CODE=/^[0-9]{6}$/;
const YMD=/^[0-9]{8}$/;
function failure(reason){throw Error('KRX52_KIS_'+reason);}
function checkedWindow(expected){
 if(!Array.isArray(expected)||expected.length!==WINDOW)failure('WINDOW_INVALID');
 let canonical;
 try{canonical=expectedSessions(expected.at(-1));}catch{failure('CALENDAR_UNVERIFIED');}
 if(canonical.some((d,i)=>d!==expected[i]))failure('SESSION_MISMATCH');
 return expected;
}
function checkedCode(code){if(typeof code!=='string'||!CODE.test(code))failure('CODE_UNVERIFIED');return code;}
function positivePrice(x){
 if((typeof x!=='string'&&typeof x!=='number')||
  !/^(?:0|[1-9]\d{0,11})(?:\.\d{1,4})?$/.test(String(x)))return null;
 const n=Number(x);
 return Number.isFinite(n)&&n>0?n:null;
}
function checkedBar(date,hi,lo,close){
 if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||
  ![hi,lo,close].every(x=>Number.isFinite(x)&&x>0)||
  lo>close||close>hi)failure('BAR_SCHEMA_UNVERIFIED');
 return {date,high:hi,low:lo,close};
}
// 100 trading sessions maximum per official API request. Every returned date
// must belong to the requested KRX session chunk, not just be <= end date.
export function planKisAdjusted52WeekRequests(expected,code){
 checkedWindow(expected);checkedCode(code);
 const pages=[];
 for(let i=0;i<WINDOW;i+=100){
  const dates=expected.slice(i,i+100);
  pages.push({
   page:pages.length+1,expectedDates:dates,
   trId:KIS_ADJUSTED_TR,path:KIS_ADJUSTED_PATH,
   params:{
    FID_COND_MRKT_DIV_CODE:'J',FID_INPUT_ISCD:code,
    FID_INPUT_DATE_1:dates[0].replaceAll('-',''),
    FID_INPUT_DATE_2:dates.at(-1).replaceAll('-',''),
    FID_PERIOD_DIV_CODE:'D',
    // KIS official v1 stock-period endpoint: 0=adjusted; 1=raw.
    FID_ORG_ADJ_PRC:'0'
   }
  });
 }
 if(pages.length!==3||pages.reduce((n,p)=>n+p.expectedDates.length,0)!==252)
  failure('PAGINATION_UNVERIFIED');
 return pages;
}
export function parseKisAdjusted52WeekPages(expected,code,payloads){
 const pages=planKisAdjusted52WeekRequests(expected,code);
 if(!Array.isArray(payloads)||payloads.length!==pages.length)
  failure('PAGE_COUNT_UNVERIFIED');
 const all=[],seen=new Set();
 for(let i=0;i<pages.length;i++){
  const payload=payloads[i],need=pages[i].expectedDates;
  if(payload?.rt_cd!=='0'||!Array.isArray(payload.output2)||
    payload.output2.length!==need.length)failure('RESPONSE_OR_COVERAGE_UNVERIFIED');
  const allowed=new Set(need),pageSeen=new Set();
  for(const row of payload.output2){
   const ymd=row?.stck_bsop_date;
   if(typeof ymd!=='string'||!YMD.test(ymd))
    failure('DATE_SCHEMA_UNVERIFIED');
   const date=ymd.slice(0,4)+'-'+ymd.slice(4,6)+'-'+ymd.slice(6);
   if(!allowed.has(date)||pageSeen.has(date)||seen.has(date))
    failure('PAGE_DATE_OR_DUPLICATE');
   const high=positivePrice(row.stck_hgpr),low=positivePrice(row.stck_lwpr),
    close=positivePrice(row.stck_clpr);
   if(high===null||low===null||close===null)
    failure('PRICE_SCHEMA_UNVERIFIED');
   const bar=checkedBar(date,high,low,close);
   pageSeen.add(date);seen.add(date);all.push(bar);
  }
  if(need.some(d=>!pageSeen.has(d)))failure('SESSION_GAP_UNVERIFIED');
 }
 all.sort((a,b)=>a.date.localeCompare(b.date));
 if(all.length!==WINDOW||all.some((x,i)=>x.date!==expected[i]))
  failure('FULL_WINDOW_UNVERIFIED');
 return {source:KIS_ADJUSTED_SOURCE,code,adjusted:true,
  firstDate:expected[0],lastDate:expected.at(-1),bars:all};
}
// Validate against the existing SEALED KRX raw archive. It is intentionally
// one-symbol read-only audit: many validated symbols, IPOs, suspensions and
// resale permission are still needed before claiming market-wide counts.
export function auditKisAdjustedSymbol(archive,expected,market,code,payloads){
 checkedWindow(expected);checkedCode(code);
 if(!MARKETS[market])failure('MARKET_UNVERIFIED');
 const verified=verifyArchive(archive);
 if(verified.sessions.length!==WINDOW||
  verified.sessions.some((s,i)=>s.date!==expected[i]))
  failure('KRX_ARCHIVE_WINDOW_UNVERIFIED');
 const raw=[];
 for(const session of verified.sessions){
  const rows=session.markets[market].rows;
  const row=rows.find(x=>x[0]===code);
  if(!row)failure('RAW_SECURITY_COVERAGE_UNVERIFIED');
  raw.push(checkedBar(session.date,row[1],row[2],row[3]));
 }
 const kis=parseKisAdjusted52WeekPages(expected,code,payloads);
 const today=raw.at(-1),current=kis.bars.at(-1);
 if(current.high!==today.high||current.low!==today.low||
    current.close!==today.close)
  failure('LATEST_KRX_PRICE_BASIS_MISMATCH');
 const metrics=bars=>{
  const prior=bars.slice(0,-1),end=bars.at(-1);
  return {newHigh:end.high>Math.max(...prior.map(x=>x.high)),
   newLow:end.low<Math.min(...prior.map(x=>x.low))};
 };
 return {kind:'KRX52_KIS_ADJUSTED_SINGLE_STOCK_AUDIT',
  sourceRaw:SOURCE,sourceAdjusted:KIS_ADJUSTED_SOURCE,
  market,code,date:expected.at(-1),sessionsVerified:WINDOW,
  raw:metrics(raw),adjusted:metrics(kis.bars),
  sameDateCurrentOhlcVerified:true,
  marketWideCertified:false,publicationAllowed:false,
  officialListingUniverseVerified:false,licensedRedistributionVerified:false,
  portfolioWrites:0,gasWrites:0,telegramSends:0};
}
