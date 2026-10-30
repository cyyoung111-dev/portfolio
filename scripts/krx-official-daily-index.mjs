// Reuse the existing GAS KRX OpenAPI index lookup; never request a new NH token.
// This is a KRX daily index source, not a replacement for NH stock/ETF closes.
import {krxSessionStatus} from './krx-session-calendar.mjs';

export const SOURCE='KRX_OFFICIAL';
export const SUPPORTED=Object.freeze(['KOSPI','KOSDAQ','KOSPI200']);
const labels=Object.freeze({KOSPI:'KOSPI',KOSDAQ:'KOSDAQ',KOSPI200:'KOSPI 200'});
function kstParts(now){
 return Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Seoul',
   year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'
 }).formatToParts(now).map(x=>[x.type,x.value]));
}
export function isOfficialCloseWindow(date,instant){
 const parts=kstParts(instant),today=parts.year+'-'+parts.month+'-'+parts.day;
 return typeof date==='string' && /^\d{4}-\d{2}-\d{2}$/.test(date)
   && krxSessionStatus(date)==='OPEN' && date<=today
   && (date<today || Number(parts.hour)*60+Number(parts.minute)>=960);
}
export function selectOfficialDailyIndexRows(date,payload){
 const result=[];
 if(payload?.status!=='ok')return result;
 for(const type of SUPPORTED){
  const meta=payload.seriesMeta?.[type],rows=payload.series?.[type];
  if(!meta||meta.source!==SOURCE||meta.confirmedClose!==true||meta.officialDate!==date
    ||!Array.isArray(rows)||rows.length>2000)continue;
  const exact=rows.filter(row=>row?.date===date);
  if(exact.length!==1)continue;
  const row=exact[0];
  if(row.source!==SOURCE || (row.sourceDate&&row.sourceDate!==date)
    ||!Number.isFinite(row.value)||row.value<=0)continue;
  // Do not calculate a one-day move from an arbitrary older close.
  const rate=Number.isFinite(row.changePercent)?row.changePercent:null;
  result.push({type,label:labels[type],date,value:row.value,
    changePercent:rate,source:SOURCE,role:'NON_NH_DAILY_INDEX',
    priceType:'CONFIRMED_REGULAR_CLOSE'});
 }
 return result;
}
export async function fetchOfficialDailyIndexes(date,{
 url=process.env.GAS_WEB_APP_URL,token=process.env.GAS_ACCESS_TOKEN,
 fetchImpl=fetch,now=()=>new Date(),onResponse
}={}){
 if(!isOfficialCloseWindow(date,now())||!url||!token)return [];
 try{
  const target=new URL(url);
  if(target.protocol!=='https:'||
     !['script.google.com','script.googleusercontent.com'].includes(target.hostname))return [];
  const form=new URLSearchParams({action:'getBenchmarks',accessToken:token,
    benchmarks:SUPPORTED.join(','),from:date,to:date,fresh:'1'});
  const res=await fetchImpl(target.href,{method:'POST',
    headers:{'content-type':'application/x-www-form-urlencoded;charset=UTF-8'},
    body:form,redirect:'follow',signal:AbortSignal.timeout(17000)});
  if(!res?.ok)return [];
  const payload=await res.json();
  // The caller may cross-check Yahoo-dated rows independently; this must
  // never weaken the KRX official source/finality selection above.
  if(typeof onResponse==='function')onResponse(payload);
  return selectOfficialDailyIndexRows(date,payload);
 }catch{return [];}
}
