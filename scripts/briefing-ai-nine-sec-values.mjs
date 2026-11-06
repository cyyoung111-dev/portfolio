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

export function extractAnnualValueSnapshot(doc,symbol,quote,{now=new Date()}={}){
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
 const pbr=goodQuote&&finite(bookPerShare)&&bookPerShare>0
  ?price/bookPerShare:null;
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
  pbrTimes:finite(pbr)?pbr:null,
  limitations:['BPS_FROM_EXACT_FISCAL_END_SHARES',
   'FY_BOOK_VALUE_NOT_LATEST_10Q',
   'EPS_10K_NOT_TRAILING_12_MONTHS',
   'YAHOO_PRICE_NON_OFFICIAL_REFERENCE']
 };
 return {symbol,status:complete?'VERIFIED_FY_BPS_PBR':'PARTIAL_FY_VALUE',snapshot};
}

export async function readAiNineAnnualValueSnapshots({
 fetchImpl=fetch,now=()=>new Date(),userAgent=process.env.SEC_USER_AGENT,
 readPrices=readAiNineDailyPrices,onDiagnostic=()=>{}
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
    const result=extractAnnualValueSnapshot(await res.json(),item.symbol,
     q.length===1?q[0]:null,{now:instant});
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
