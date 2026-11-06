import {AI_NINE,completedUsRegularClose} from './briefing-ai-nine-sources.mjs';
import {expectedMorningDate} from './telegram-morning-report.mjs';

// Historical Yahoo reference only, not an official index or live quote.
// The 52-week high/low below means 52-week CLOSING high/low, not intraday extrema.
// Price returns exclude dividends; adjusted-close total returns are not inferred.
const DAY=86400000;
const HOSTS=Object.freeze(['query1.finance.yahoo.com','query2.finance.yahoo.com']);
const yearsBack=(date,years)=>{
 const [y,m,d]=date.split('-').map(Number);
 const stamp=new Date(Date.UTC(y-years,m-1,d));
 return stamp.toISOString().slice(0,10);
};
const before=(date,days)=>new Date(Date.parse(date+'T00:00:00Z')-days*DAY).toISOString().slice(0,10);
const nyDate=timestamp=>{
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',
  year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(timestamp));
 const p=Object.fromEntries(parts.map(x=>[x.type,x.value]));
 return p.year+'-'+p.month+'-'+p.day;
};
const validNum=n=>Number.isFinite(n)&&n>0&&n<10000000;
const pct=(a,b)=>b>0?(a/b-1)*100:null;
const round=n=>Number.isFinite(n)?Math.round(n*10000)/10000:null;
const emit=(cb,x)=>{try{cb(x);}catch{}};

export function summarizeAiNineHistory(symbol,sessionDate,rows){
 const definition=AI_NINE.find(x=>x.symbol===symbol);
 if(!definition||typeof sessionDate!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(sessionDate)
  ||!Array.isArray(rows)||rows.length>4000)return null;
 let prior='';
 const verified=[];
 for(const row of rows){
  if(typeof row?.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(row.date)
   ||row.date<=prior||row.date>sessionDate||!validNum(row.close))return null;
  prior=row.date;
  if(definition.firstIndependentTradingDay&&row.date<definition.firstIndependentTradingDay)
   continue;
  verified.push({date:row.date,close:row.close});
 }
 if(!verified.length||verified.at(-1).date!==sessionDate)return null;
 const end=verified.at(-1),n=verified.length;
 const atOffset=k=>n>k?round(pct(end.close,verified.at(-1-k).close)):null;
 const range=verified.filter(x=>x.date>=before(sessionDate,365));
 const fullRange=range.length>=200;
 const high=fullRange?Math.max(...range.map(x=>x.close)):null;
 const low=fullRange?Math.min(...range.map(x=>x.close)):null;
 const mean=k=>n>=k?round(verified.slice(-k).reduce((s,x)=>s+x.close,0)/k):null;
 const yearReturn=y=>{
  const target=yearsBack(sessionDate,y);
  const candidate=verified.filter(x=>x.date<=target).at(-1);
  if(!candidate||candidate.date<before(target,7))return null;
  return round(pct(end.close,candidate.close));
 };
 return {
  symbol,date:sessionDate,source:'YAHOO_SPLIT_ADJUSTED_DAILY_REFERENCE',
  scope:'PRICE_ONLY_EXCLUDES_DIVIDENDS',observations:n,close:round(end.close),
  week52:fullRange?{high:round(high),low:round(low),
   highDistancePct:round(pct(end.close,high)),
   lowToHighPositionPct:high>low?round((end.close-low)/(high-low)*100):null,
   windowStart:before(sessionDate,365),sampleCount:range.length,
   type:'CLOSING_HIGH_LOW'}:null,
  returnsTradingDays:Object.fromEntries([5,20,60,120,252]
   .map(k=>[String(k),atOffset(k)])),
  returnsYears:Object.fromEntries([1,3,5,10]
   .map(k=>[String(k),yearReturn(k)])),
  sma:Object.fromEntries([20,60,200].map(k=>[String(k),mean(k)]))
 };
}
async function readHistory(symbol,date,{fetchImpl,now,host}){
 const target=AI_NINE.find(x=>x.symbol===symbol);
 if(!target||!HOSTS.includes(host))return null;
 const nowDate=now();
 if(!(nowDate instanceof Date)||!Number.isFinite(nowDate.getTime()))return null;
 const from=before(yearsBack(date,10),375);
 const end=Date.parse(date+'T00:00:00Z');
 const url=new URL('https://'+host+'/v8/finance/chart/'+encodeURIComponent(symbol));
 url.searchParams.set('period1',String(Math.floor(Date.parse(from+'T00:00:00Z')/1000)));
 url.searchParams.set('period2',String(Math.floor((end+2*DAY)/1000)));
 url.searchParams.set('interval','1d');
 url.searchParams.set('includeAdjustedClose','true');
 const r=await fetchImpl(url.href,{headers:{accept:'application/json'},
  redirect:'error',signal:AbortSignal.timeout(20000)});
 if(!r?.ok)return null;
 const chart=(await r.json())?.chart?.result?.[0];
 const meta=chart?.meta,quotes=chart?.indicators?.quote?.[0]?.close;
 if(meta?.symbol!==symbol||meta?.exchangeTimezoneName!=='America/New_York'
  ||!Array.isArray(chart?.timestamp)||!Array.isArray(quotes)
  ||chart.timestamp.length!==quotes.length||chart.timestamp.length>4000)return null;
 let raw=[];
 for(let i=0;i<quotes.length;i++){
  const timestamp=chart.timestamp[i],close=quotes[i];
  if(!Number.isFinite(timestamp)||timestamp<=0||timestamp*1000>nowDate.getTime()
   ||!validNum(close))continue;
  const traded=nyDate(timestamp*1000);
  if(traded>date)continue;
  raw.push({date:traded,close});
 }
 // Yahoo can occasionally supply duplicate bars; fail closed, no arbitrary pick.
 return summarizeAiNineHistory(symbol,date,raw);
}
export async function readAiNineHistoricalTrends(date,{fetchImpl=fetch,now=()=>new Date(),
 onDiagnostic=()=>{}}={}){
 const session=expectedMorningDate('NVDA',date);
 if(!session||!completedUsRegularClose(session,now())){
  return {sessionDate:session,verified:0,total:9,trends:[],
   statuses:AI_NINE.map(x=>({symbol:x.symbol,status:'US_CLOSE_UNVERIFIED'}))};
 }
 const values=Array(AI_NINE.length).fill(null),states=Array(AI_NINE.length).fill(null);
 let next=0;
 await Promise.all(Array.from({length:2},async()=>{
  while(next<AI_NINE.length){
   const i=next++,symbol=AI_NINE[i].symbol;
   let item=null;
   for(const host of HOSTS){
    try{item=await readHistory(symbol,session,{fetchImpl,now,host});}
    catch{/* never report raw network errors */}
    if(item)break;
   }
   values[i]=item;
   states[i]={symbol,status:item?'VERIFIED':'NO_VALID_DATED_HISTORY'};
  }
 }));
 const trends=values.filter(Boolean);
 emit(onDiagnostic,{kind:'AI9_HISTORY_READ',verified:trends.length,total:9,
  statuses:states.map(x=>({symbol:x.symbol,status:x.status}))});
 return {sessionDate:session,verified:trends.length,total:9,
  trends,statuses:states};
}
