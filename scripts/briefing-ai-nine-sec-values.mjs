import {AI_NINE,isValidSecUserAgent,readAiNineDailyPrices} from './briefing-ai-nine-sources.mjs';
import {extractSecAnnualFacts} from './briefing-ai-nine-sec-financials.mjs';

// Annual FY EPS and fiscal-year-end BPS, paired to a completed US session.
// Never derive year-end shares from weighted-average diluted shares or
// shares issued. This is NOT TTM EPS or a current-quarter book value.
const SHARE_SOURCES=Object.freeze([
 {namespace:'us-gaap',tag:'CommonStockSharesOutstanding'},
 {namespace:'dei',tag:'EntityCommonStockSharesOutstanding'}
]);
const DAY_MS=86400000;
const goodDay=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)
 &&Number.isFinite(Date.parse(s+'T00:00:00Z'))
 &&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
const ageDays=(a,b)=>(Date.parse(a+'T00:00:00Z')-Date.parse(b+'T00:00:00Z'))/DAY_MS;
const finite=x=>typeof x==='number'&&Number.isFinite(x)&&Math.abs(x)<1e16;
const kstDate=d=>new Intl.DateTimeFormat('en-CA',{
 timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'
}).format(d);
const note=(fn,x)=>{try{fn(x);}catch{}};
const utcDate=s=>new Date(s*1000).toISOString().slice(0,10);

// Independent completed-history split proof. Absence of events is only
// meaningful when the returned daily history demonstrably covers both ends.
// The final quote is a contemporaneous unadjusted post-action daily close;
// fiscal-year-end BPS must be restated into the quote's share units.
export async function readYahooSplitProof(symbol,start,end,{fetchImpl=fetch}={}){
 if(!AI_NINE.some(x=>x.symbol===symbol)||!goodDay(start)||!goodDay(end)
  ||end<=start||ageDays(end,start)>550)return null;
 const p1=Math.floor(Date.parse(start+'T00:00:00Z')/1000)-8*86400;
 const p2=Math.floor(Date.parse(end+'T00:00:00Z')/1000)+3*86400;
 try{
  const url='https://query1.finance.yahoo.com/v8/finance/chart/'
   +encodeURIComponent(symbol)+'?period1='+p1+'&period2='+p2
   +'&interval=1d&events=split';
  const response=await fetchImpl(url,{
   method:'GET',redirect:'error',headers:{accept:'application/json'},
   signal:AbortSignal.timeout(18000)});
  if(!response?.ok)return null;
  const json=await response.json();
  const charts=json?.chart?.result;
  if(!Array.isArray(charts)||charts.length!==1
    ||charts[0]?.meta?.symbol!==symbol
    ||charts[0]?.meta?.exchangeTimezoneName!=='America/New_York')return null;
  const data=charts[0];
  const ts=data.timestamp;
  if(!Array.isArray(ts)||ts.length<3
   ||ts.some(v=>!Number.isInteger(v)||v<0))return null;
  const dates=ts.map(utcDate);
  if(dates.some((d,i)=>!goodDay(d)||(i>0&&d<=dates[i-1])))return null;
  // Validate that Yahoo provided the full calendar interval rather than
  // silently truncating the first or last segment of corporate-action history.
  if(ageDays(dates[0],start)>10||dates.at(-1)<end)return null;
  const raw=data.events?.splits??{};
  if(raw===null||typeof raw!=='object'||Array.isArray(raw))return null;
  const events=Object.values(raw);
  if(events.length>100)return null;
  let ratio=1;
  const seen=new Set();
  for(const x of events){
   if(!Number.isInteger(x?.date)||x.date<=0)return null;
   const d=utcDate(x.date);
   if(!goodDay(d)||seen.has(d))return null;
   seen.add(d);
   const n=Number(x.numerator),den=Number(x.denominator);
   if(!Number.isFinite(n)||!Number.isFinite(den)||n<=0||den<=0)return null;
   const factor=n/den;
   if(!Number.isFinite(factor)||factor<=0||factor>10000)return null;
   if(d>start&&d<=end)ratio*=factor;
  }
  if(!Number.isFinite(ratio)||ratio<=0||ratio>1e8)return null;
  return {symbol,since:start,through:end,sharesPerOldShare:ratio,
   source:'YAHOO_CHART_SPLIT_EVENTS',coverage:'COMPLETE'};
 }catch{return null;}
}

// Require same 10-K accession, filed date and fiscal-year-end instant.
// DEI cover-page shares dated AFTER year end are not valid BPS denominators.
export function selectYearEndOutstandingShares(doc,annual){
 if(!annual||!goodDay(annual.period)||!goodDay(annual.filedAt))return null;
 const found=[];
 for(const {namespace,tag} of SHARE_SOURCES){
  const rows=doc?.facts?.[namespace]?.[tag]?.units?.shares;
  if(!Array.isArray(rows))continue;
  for(const x of rows){
   if(x?.form==='10-K'&&x.fp==='FY'
    &&x.accn===annual.accessionNumber&&x.filed===annual.filedAt
    &&x.end===annual.period&&!x.start
    &&finite(x.val)&&Number.isSafeInteger(x.val)&&x.val>0){
    found.push({shares:x.val,tag:namespace+':'+tag,unit:'shares'});
   }
  }
 }
 if(found.length===0)return null;
 if(found.some(x=>x.shares!==found[0].shares))return null;
 return {shares:found[0].shares,tag:found[0].tag,unit:'shares',
  end:annual.period,accessionNumber:annual.accessionNumber};
}

export function extractAnnualValueSnapshot(doc,symbol,quote,{now=new Date(),splitProof=null}={}){
 const annual=extractSecAnnualFacts(doc,symbol,{now});
 if(!annual)return {symbol,status:'NO_REPORTED_FY',snapshot:null};
 const eps=annual.values?.epsDiluted?.value;
 const equity=annual.values?.equity?.value;
 const denom=selectYearEndOutstandingShares(doc,annual);
 const qDate=quote?.date, price=quote?.value;
 const goodQuote=quote?.symbol===symbol
  &&quote?.unit==='USD'&&quote?.source==='YAHOO_DAILY_REFERENCE'
  &&goodDay(qDate)&&qDate<=kstDate(now)
  &&qDate>=annual.filedAt&&ageDays(qDate,annual.filedAt)<=550
  &&finite(price)&&price>0;
 const bookPerShare=finite(equity)&&equity>0&&denom?.shares>0
  ?equity/denom.shares:null;
 const splitFactor=splitProof?.symbol===symbol
  &&splitProof?.since===annual.period&&splitProof?.through===qDate
  &&splitProof?.source==='YAHOO_CHART_SPLIT_EVENTS'
  &&splitProof?.coverage==='COMPLETE'
  &&finite(splitProof?.sharesPerOldShare)&&splitProof.sharesPerOldShare>0
  ?splitProof.sharesPerOldShare:null;
 const adjustedBookPerShare=finite(bookPerShare)&&bookPerShare>0
  &&finite(splitFactor)&&splitFactor>0?bookPerShare/splitFactor:null;
 const pbr=goodQuote&&finite(adjustedBookPerShare)&&adjustedBookPerShare>0
  ?price/adjustedBookPerShare:null;
 const complete=finite(eps)&&finite(bookPerShare)&&bookPerShare>0
  &&finite(pbr)&&pbr>0;
 const snapshot={
  symbol,asOf:annual.period,reportedAt:annual.filedAt,
  annualAccession:annual.accessionNumber,source:'SEC_10K_US_GAAP',
  priceDate:goodQuote?qDate:null,
  priceSource:goodQuote?'YAHOO_DAILY_REFERENCE':null,
  priceUsd:goodQuote?price:null,
  dilutedAnnualEpsUsd:finite(eps)?eps:null,epsPeriodType:'FY_REPORTED_NOT_TTM',
  equityUsd:finite(equity)?equity:null,
  yearEndOutstandingShares:denom?.shares??null,
  sharesTag:denom?.tag??null,
  bpsUsd:finite(bookPerShare)?bookPerShare:null,
  splitAdjustedBpsUsd:finite(adjustedBookPerShare)?adjustedBookPerShare:null,
  splitSharesPerOldShare:splitFactor,
  pbrTimes:finite(pbr)?pbr:null,
  pbrUnavailableReason:!finite(pbr)
   ?(!goodQuote?'QUOTE_UNVERIFIED':!finite(bookPerShare)
      ?'FISCAL_END_BPS_UNAVAILABLE':'SPLIT_HISTORY_UNVERIFIED'):null,
  limitations:['BPS_FROM_EXACT_FISCAL_END_SHARES',
   'FY_BOOK_VALUE_NOT_LATEST_10Q',
   'EPS_10K_NOT_TRAILING_12_MONTHS',
   'YAHOO_PRICE_NON_OFFICIAL_REFERENCE',
   'YAHOO_SPLIT_EVENTS_NON_OFFICIAL_REFERENCE']
 };
 return {symbol,status:complete?'VERIFIED_FY_BPS_PBR':'PARTIAL_FY_VALUE',snapshot};
}

export async function readAiNineAnnualValueSnapshots({
 fetchImpl=fetch,now=()=>new Date(),userAgent=process.env.SEC_USER_AGENT,
 readPrices=readAiNineDailyPrices,readSplitProof=readYahooSplitProof,onDiagnostic=()=>{}
}={}){
 if(!isValidSecUserAgent(userAgent)){
  return {total:AI_NINE.length,verified:0,
   statuses:AI_NINE.map(x=>({symbol:x.symbol,status:'SEC_USER_AGENT_NOT_CONFIGURED'})),
   snapshots:[]};
 }
 const instant=now(),date=kstDate(instant);
 let prices={};
 try{prices=await readPrices(date,{now});}catch{}
 const expected=prices?.expectedUsDate;
 const priceRows=Array.isArray(prices?.prices)?prices.prices:[];
 const statuses=[],snapshots=[];
 for(const item of AI_NINE){
  let status='FETCH_FAILED',snapshot=null;
  try{
   const res=await fetchImpl('https://data.sec.gov/api/xbrl/companyfacts/CIK'
    +item.cik+'.json',{method:'GET',redirect:'error',
     headers:{accept:'application/json','user-agent':userAgent},
     signal:AbortSignal.timeout(25000)});
   if(!res?.ok)status='SEC_HTTP_UNAVAILABLE';
   else if(!String(res.headers?.get?.('content-type')||'').toLowerCase().includes('json'))
    status='SEC_CONTENT_TYPE_INVALID';
   else if(Number(res.headers?.get?.('content-length'))>12000000)
    status='SEC_BODY_TOO_LARGE';
   else{
    const q=priceRows.filter(x=>x.symbol===item.symbol
     &&x.label===item.label&&x.date===expected
     &&goodDay(expected)&&x.unit==='USD'
     &&x.source==='YAHOO_DAILY_REFERENCE'
     &&finite(x.value)&&x.value>0);
    const doc=await res.json();
    const annual=extractSecAnnualFacts(doc,item.symbol,{now:instant});
    const quote=q.length===1?q[0]:null;
    let proof=null;
    if(annual&&quote){
     try{proof=await readSplitProof(item.symbol,annual.period,quote.date);}
     catch{}
    }
    const result=extractAnnualValueSnapshot(doc,item.symbol,
     quote,{now:instant,splitProof:proof});
    status=result.status;snapshot=result.snapshot;
   }
  }catch{status='FETCH_FAILED';}
  statuses.push({symbol:item.symbol,status});
  if(snapshot)snapshots.push(snapshot);
  if(item!==AI_NINE[AI_NINE.length-1])
   await new Promise(resolve=>setTimeout(resolve,250));
 }
 const output={total:AI_NINE.length,
  verified:statuses.filter(x=>x.status==='VERIFIED_FY_BPS_PBR').length,
  statuses,snapshots};
 note(onDiagnostic,{total:AI_NINE.length,verified:output.verified,
  statuses:statuses.map(x=>({symbol:x.symbol,status:x.status}))});
 return output;
}
