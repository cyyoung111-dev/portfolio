import {expectedMorningDate} from './telegram-morning-report.mjs';
import {fetchDatedDaily} from './telegram-morning-briefing.mjs';

// SEC company ticker CIK identifiers: one canonical symbol/CIK
// per issuer. These are a watchlist, NOT an exchange-published stock index.
// No data from this module is written to portfolio sheets or sent to Telegram.
export const AI_NINE=Object.freeze([
 {symbol:'MSFT',label:'Microsoft',cik:'0000789019'},
 {symbol:'AAPL',label:'Apple',cik:'0000320193'},
 {symbol:'GOOGL',label:'Alphabet',cik:'0001652044'},
 {symbol:'AMZN',label:'Amazon',cik:'0001018724'},
 {symbol:'META',label:'Meta',cik:'0001326801'},
 {symbol:'NVDA',label:'NVIDIA',cik:'0001045810'},
 {symbol:'MU',label:'Micron',cik:'0000723125'},
 {symbol:'ORCL',label:'Oracle',cik:'0001341439'},
 {symbol:'SNDK',label:'Sandisk',cik:'0002023554',firstIndependentTradingDay:'2025-02-24'}
].map(item=>Object.freeze(item)));

const validDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)
 &&Number.isFinite(Date.parse(value+'T00:00:00Z'))
 &&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
const emitSafe=(callback,status)=>{try{callback(status);}catch{}};
const fetchHosts=Object.freeze(['query1.finance.yahoo.com','query2.finance.yahoo.com']);

// An exact-date daily candle can arrive while NYSE is still trading.
// Require NYSE 16:00 Eastern plus a 15-minute dissemination buffer.
// Uses America/New_York to handle DST, never KST date alone.
export function completedUsRegularClose(usDate,instant){
 if(!validDate(usDate)||!(instant instanceof Date)||!Number.isFinite(instant.getTime()))return false;
 const fields=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{
  timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',
  hour:'2-digit',minute:'2-digit',hourCycle:'h23'
 }).formatToParts(instant).map(part=>[part.type,part.value]));
 const nyDate=`${fields.year}-${fields.month}-${fields.day}`;
 return nyDate>usDate || (nyDate===usDate &&
  Number(fields.hour)*60+Number(fields.minute)>=16*60+15);
}


// Read-only reference candles; never promote Yahoo to official/NH close.
// The prior COMPLETED US session must match the strict existing calendar gate.
export async function readAiNineDailyPrices(date,{
 fetchDaily=fetchDatedDaily,fetchImpl=fetch,now=()=>new Date(),onDiagnostic=()=>{}
}={}){
 const expectedUsDate=expectedMorningDate('NVDA',date);
 const prices=Array(AI_NINE.length).fill(null);
 const statuses=Array(AI_NINE.length).fill(null);
 if(!expectedUsDate || !completedUsRegularClose(expectedUsDate,now())){
  const result={expectedUsDate:expectedUsDate??null,prices:[],verified:0,total:9,
   statuses:AI_NINE.map(item=>({symbol:item.symbol,status:'US_CLOSE_UNVERIFIED'}))};
  emitSafe(onDiagnostic,{kind:'AI9_DAILY_READ',verified:0,total:9,status:'US_CLOSE_UNVERIFIED'});
  return result;
 }
 let next=0;
 await Promise.all(Array.from({length:3},async()=>{
  while(next<AI_NINE.length){
   const index=next++,item=AI_NINE[index];
   let accepted=null;
   for(const host of fetchHosts){
    try{
     const row=await fetchDaily(item.label,item.symbol,date,{host,fetchImpl,now:now()});
     if(row?.label!==item.label||row.symbol!==item.symbol
       ||row.source!=='Yahoo Finance 일봉'||row.date!==expectedUsDate
       ||!Number.isFinite(row.value)||row.value<=0
       ||(row.changePercent!==null&&!Number.isFinite(row.changePercent)))continue;
     accepted={symbol:item.symbol,label:item.label,date:row.date,value:row.value,
      changePercent:row.changePercent,unit:'USD',source:'YAHOO_DAILY_REFERENCE'};
     break;
    }catch{/* do not expose provider errors or turn stale rows into closes */}
   }
   prices[index]=accepted;
   statuses[index]={symbol:item.symbol,status:accepted?'VERIFIED':'NO_EXACT_COMPLETED_US_BAR'};
  }
 }));
 const verified=prices.filter(Boolean);
 const result={expectedUsDate,prices:verified,verified:verified.length,total:AI_NINE.length,statuses};
 emitSafe(onDiagnostic,{kind:'AI9_DAILY_READ',verified:verified.length,total:AI_NINE.length,
  statuses:statuses.map(({symbol,status})=>({symbol,status}))});
 return result;
}

export function formatAiNineDailyPrices(result){
 if(!result||result.total!==AI_NINE.length||!Array.isArray(result.prices)
  ||!Array.isArray(result.statuses))throw Error('AI9_DAILY_SCHEMA_INVALID');
 const lines=['■ AI 핵심 9사 (미국 정규장 완료 일봉 · Yahoo 참고)'];
 for(const item of AI_NINE){
  const rows=result.prices.filter(x=>x.symbol===item.symbol&&x.label===item.label
   &&x.date===result.expectedUsDate&&x.source==='YAHOO_DAILY_REFERENCE'
   &&Number.isFinite(x.value)&&x.value>0&&x.unit==='USD');
  if(rows.length!==1){lines.push(item.symbol+': 완료 일봉 미확보');continue;}
  const x=rows[0],change=Number.isFinite(x.changePercent)
   ?' ('+(x.changePercent>=0?'+':'')+x.changePercent.toFixed(2)+'%)':'';
  lines.push(item.symbol+': '+x.value.toLocaleString('en-US',{maximumFractionDigits:2})
   +' USD'+change+' ['+x.date+']');
 }
 return lines.join('\n');
}

function validateSecFiling(doc,item,now){
 if(!doc||Number(doc.cik)!==Number(item.cik)
  ||!Array.isArray(doc.tickers)||!doc.tickers.includes(item.symbol))return null;
 const recent=doc.filings?.recent;
 if(!recent||!Array.isArray(recent.form)||!Array.isArray(recent.filingDate)
  ||!Array.isArray(recent.reportDate)||!Array.isArray(recent.accessionNumber))return null;
 const filings=[];
 for(let i=0;i<Math.min(300,recent.form.length);i++){
  const form=recent.form[i],filedAt=recent.filingDate[i],periodEnd=recent.reportDate[i],
   accessionNumber=recent.accessionNumber[i];
  if(!['10-Q','10-K'].includes(form)||!validDate(filedAt)||!validDate(periodEnd)
   ||periodEnd>filedAt||filedAt>now.toISOString().slice(0,10)
   ||!/^\d{10}-\d{2}-\d{6}$/.test(accessionNumber||''))continue;
  filings.push({form,filedAt,periodEnd,accessionNumber,source:'SEC_EDGAR_SUBMISSIONS'});
 }
 filings.sort((a,b)=>b.filedAt.localeCompare(a.filedAt)
  ||b.accessionNumber.localeCompare(a.accessionNumber));
 return filings[0]||null;
}

// SEC requires a truthful identifying User-Agent (name + contact e-mail).
// Do not fabricate one; skip securely until SEC_USER_AGENT is configured.
// This step validates filing metadata only, NOT companyfacts or earnings.
export async function readAiNineSecFilings({
 fetchImpl=fetch,now=()=>new Date(),userAgent=process.env.SEC_USER_AGENT,
 onDiagnostic=()=>{}
}={}){
 const validAgent=typeof userAgent==='string'&&userAgent.length>=12&&userAgent.length<=160
  &&/^[\x20-\x7e]+$/.test(userAgent)&&/\b[^\s@]+@[^\s@]+\.[^\s@]+\b/.test(userAgent);
 if(!validAgent){
  const statuses=AI_NINE.map(item=>({symbol:item.symbol,status:'SEC_USER_AGENT_NOT_CONFIGURED'}));
  emitSafe(onDiagnostic,{kind:'AI9_SEC_FILINGS_READ',verified:0,total:9,
   status:'SEC_USER_AGENT_NOT_CONFIGURED'});
  return {filings:[],verified:0,total:9,statuses};
 }
 const filings=Array(AI_NINE.length).fill(null),statuses=Array(AI_NINE.length).fill(null);
 let next=0;
 await Promise.all(Array.from({length:2},async()=>{
  while(next<AI_NINE.length){
   const i=next++,item=AI_NINE[i];
   let latest=null,status='FETCH_FAILED';
   try{
    const url='https://data.sec.gov/submissions/CIK'+item.cik+'.json';
    const response=await fetchImpl(url,{method:'GET',redirect:'error',
     headers:{accept:'application/json','user-agent':userAgent},
     signal:AbortSignal.timeout(12000)});
    if(!response?.ok){status='SEC_HTTP_UNAVAILABLE';}
    else if(!String(response.headers?.get?.('content-type')||'').toLowerCase().includes('json')){
     status='SEC_CONTENT_TYPE_INVALID';
    }else{
     const doc=await response.json();
     latest=validateSecFiling(doc,item,now());
     status=latest?'VERIFIED':'SEC_FILING_SCHEMA_OR_DATE_INVALID';
    }
   }catch{status='FETCH_FAILED';}
   filings[i]=latest?{symbol:item.symbol,cik:item.cik,latest}:null;
   statuses[i]={symbol:item.symbol,status};
  }
 }));
 const verified=filings.filter(Boolean);
 emitSafe(onDiagnostic,{kind:'AI9_SEC_FILINGS_READ',verified:verified.length,total:AI_NINE.length,
  statuses:statuses.map(({symbol,status})=>({symbol,status}))});
 return {filings:verified,verified:verified.length,total:AI_NINE.length,statuses};
}
