import {AI_NINE,isValidSecUserAgent} from './briefing-ai-nine-sources.mjs';
import {extractSecAnnualFacts} from './briefing-ai-nine-sec-financials.mjs';

// Read-only trailing-12-month financials. Never sum 10-Q year-to-date values
// directly across quarters or subtract facts from incompatible period lengths.
// Annual + current YTD - prior-comparable YTD is valid only for additive USD flows.
// EPS, weighted-average shares, owner earnings and ROIC are NOT inferred here.
const FLOWS=Object.freeze(['revenue','operatingIncome','netIncome','operatingCashFlow','capex']);
const QUARTERS=Object.freeze({Q1:[60,125],Q2:[145,220],Q3:[225,315]});
const MS=86400000;
const day=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)
 &&!Number.isNaN(Date.parse(s+'T00:00:00Z'))
 &&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
const diff=(a,b)=>(Date.parse(a+'T00:00:00Z')-Date.parse(b+'T00:00:00Z'))/MS;
const nextDay=s=>new Date(Date.parse(s+'T00:00:00Z')+MS).toISOString().slice(0,10);
const finite=n=>Number.isFinite(n)&&Math.abs(n)<1e16;
const rate=(n,d)=>finite(n)&&finite(d)&&d>0?Math.round(n/d*1e6)/1e4:null;
const notify=(fn,x)=>{try{fn(x);}catch{}};
const USD='USD';

function latestQuarter(doc,annual,now){
 const assets=doc.facts?.['us-gaap']?.Assets?.units?.USD;
 if(!Array.isArray(assets))return null;
 const options=assets.filter(x=>x?.form==='10-Q'&&QUARTERS[x.fp]
  &&!x.start&&day(x.end)&&day(x.filed)
  &&x.filed<=now.toISOString().slice(0,10)
  &&x.end>annual.period
  &&diff(x.end,annual.period)>=60&&diff(x.end,annual.period)<=320
  &&/^\d{10}-\d{2}-\d{6}$/.test(x.accn||'')&&finite(x.val)&&x.val>0)
  .sort((a,b)=>b.end.localeCompare(a.end)||b.filed.localeCompare(a.filed)
   ||b.accn.localeCompare(a.accn));
 if(!options.length)return {kind:'FY_ONLY'};
 const a=options[0];
 if(options.some(x=>x.end===a.end&&x.filed===a.filed&&x.accn===a.accn
  &&(x.val!==a.val||x.fp!==a.fp)))return {kind:'QUARTER_ANCHOR_CONFLICT'};
 return {kind:'QUARTER',end:a.end,form:a.form,fp:a.fp,filed:a.filed,accn:a.accn,
  expectedStart:nextDay(annual.period),priorStart:annual.periodStart};
}

function matchingUnique(entries){
 if(entries.length===0)return null;
 if(entries.some(x=>x.start!==entries[0].start||x.end!==entries[0].end
  ||x.val!==entries[0].val))return null;
 return entries[0];
}

// The same 10-Q accession is used for both current and comparative YTD.
// This avoids blending pre-restatement historical figures with new filings.
function comparableYtd(doc,tag,anchor){
 const entries=doc.facts?.['us-gaap']?.[tag]?.units?.[USD];
 if(!Array.isArray(entries))return null;
 const [min,max]=QUARTERS[anchor.fp];
 const current=matchingUnique(entries.filter(x=>x.form==='10-Q'
  &&x.accn===anchor.accn&&x.filed===anchor.filed
  &&x.end===anchor.end&&day(x.start)&&finite(x.val)
  &&x.start===anchor.expectedStart
  &&diff(x.end,x.start)>=min&&diff(x.end,x.start)<=max
  &&!(tag.startsWith('PaymentsToAcquire')&&x.val<0)));
 if(!current)return null;
 const previous=matchingUnique(entries.filter(x=>x.form==='10-Q'
  &&x.accn===anchor.accn&&x.filed===anchor.filed
  &&day(x.start)&&day(x.end)&&finite(x.val)
  &&x.start===anchor.priorStart
  &&diff(current.start,x.start)>=355&&diff(current.start,x.start)<=374
  &&diff(current.end,x.end)>=355&&diff(current.end,x.end)<=374
  &&Math.abs(diff(x.end,x.start)-diff(current.end,current.start))<=7
  &&!(tag.startsWith('PaymentsToAcquire')&&x.val<0)));
 if(!previous)return null;
 return {current:current.val,previous:previous.val,
  currentStart:current.start,currentEnd:current.end,
  priorStart:previous.start,priorEnd:previous.end,tag};
}

export function extractSecTtmFacts(doc,symbol,{now=new Date()}={}){
 const annual=extractSecAnnualFacts(doc,symbol,{now});
 if(!annual)return {symbol,status:'NO_REPORTED_ANNUAL_ANCHOR',report:null};
 const anchor=latestQuarter(doc,annual,now);
 if(anchor.kind==='QUARTER_ANCHOR_CONFLICT')
  return {symbol,status:'QUARTER_ANCHOR_CONFLICT',report:null};
 if(anchor.kind==='FY_ONLY'){
  // Latest 10-K is already as recent as the most recently reported quarter.
  // Annual figures are valid for its fiscal year end, but not a newer TTM.
  return {symbol,status:'FY_ONLY',report:{
   periodEnd:annual.period,method:'REPORTED_FY',annualAccession:annual.accessionNumber,
   fields:Object.fromEntries(FLOWS.map(key=>[key,annual.values[key]?.value??null])),
   missing:FLOWS.filter(key=>!finite(annual.values[key]?.value))
  }};
 }
 const fields={},provenance={},missing=[];
 for(const key of FLOWS){
  const yearly=annual.values[key],tag=yearly?.tag;
  // Annual and two YTD observations MUST use one unchanged GAAP concept.
  const ytd=tag?comparableYtd(doc,tag,anchor):null;
  if(!finite(yearly?.value)||!ytd){fields[key]=null;missing.push(key);continue;}
  const value=yearly.value+ytd.current-ytd.previous;
  if(!finite(value)||(key==='revenue'||key==='capex')&&value<0){
   fields[key]=null;missing.push(key);continue;
  }
  fields[key]=value;
  provenance[key]={tag,annualAccession:annual.accessionNumber,
   quarterAccession:anchor.accn,annualEnd:annual.period,
   currentYtdStart:ytd.currentStart,currentYtdEnd:ytd.currentEnd,
   priorYtdStart:ytd.priorStart,priorYtdEnd:ytd.priorEnd};
 }
 const fcf=finite(fields.operatingCashFlow)&&finite(fields.capex)
  ?fields.operatingCashFlow-fields.capex:null;
 return {symbol,status:missing.length?'PARTIAL_TTM':'VERIFIED_TTM',report:{
  periodEnd:anchor.end,quarterForm:anchor.form,quarterFiledAt:anchor.filed,
  quarterAccession:anchor.accn,annualAccession:annual.accessionNumber,
  method:'FY_PLUS_CURRENT_YTD_MINUS_PRIOR_YTD',
  fields,provenance,missing,calculated:{
   freeCashFlow:fcf,operatingMarginPercent:rate(fields.operatingIncome,fields.revenue),
   fcfMarginPercent:rate(fcf,fields.revenue)
  },
  unavailable:{epsTtm:'WEIGHTED_AVERAGE_SHARES_NOT_DERIVED',
   bps:'QUARTER_END_SHARE_COUNT_NOT_DERIVED',
   roic:'INVESTED_CAPITAL_NOT_DERIVED'}
 }};
}

export async function readAiNineTtmSecFacts({
 fetchImpl=fetch,now=()=>new Date(),userAgent=process.env.SEC_USER_AGENT,
 onDiagnostic=()=>{}
}={}){
 if(!isValidSecUserAgent(userAgent)){
  const statuses=AI_NINE.map(({symbol})=>({symbol,status:'SEC_USER_AGENT_NOT_CONFIGURED'}));
  return {total:AI_NINE.length,verified:0,fyOnly:0,partial:0,reports:[],statuses};
 }
 const reports=[],statuses=[];
 for(const item of AI_NINE){
  let status='FETCH_FAILED',report=null;
  try{
   const resp=await fetchImpl('https://data.sec.gov/api/xbrl/companyfacts/CIK'
    +item.cik+'.json',{method:'GET',redirect:'error',
     headers:{accept:'application/json','user-agent':userAgent},
     signal:AbortSignal.timeout(25000)});
   if(!resp?.ok)status='SEC_HTTP_UNAVAILABLE';
   else if(!String(resp.headers?.get?.('content-type')||'').toLowerCase().includes('json'))
    status='SEC_CONTENT_TYPE_INVALID';
   else if(Number(resp.headers?.get?.('content-length'))>12000000)
    status='SEC_BODY_TOO_LARGE';
   else{
    const extracted=extractSecTtmFacts(await resp.json(),item.symbol,{now:now()});
    status=extracted.status;report=extracted.report;
   }
  }catch{status='FETCH_FAILED';}
  statuses.push({symbol:item.symbol,status});
  if(report)reports.push({symbol:item.symbol,...report});
  if(item!==AI_NINE[AI_NINE.length-1])
   await new Promise(resolve=>setTimeout(resolve,250));
 }
 const result={total:AI_NINE.length,
  verified:statuses.filter(x=>x.status==='VERIFIED_TTM').length,
  fyOnly:statuses.filter(x=>x.status==='FY_ONLY').length,
  partial:statuses.filter(x=>x.status==='PARTIAL_TTM').length,
  reports,statuses};
 // Never log amounts, filings, tokens or emails; only coverage statuses.
 notify(onDiagnostic,{verified:result.verified,fyOnly:result.fyOnly,
  partial:result.partial,statuses:statuses.map(({symbol,status})=>({symbol,status}))});
 return result;
}
