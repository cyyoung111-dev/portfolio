// Read-only end-to-end verification of the exact closing-briefing domestic
// provider. No Telegram messages, GAS writes, credentials in output, or NH OAuth.
import {fetchDomesticCloseIndexes,verifiedDomesticCloseRows} from './telegram-close-workflow.mjs';
import {pathToFileURL} from 'node:url';

const TARGET='2026-10-30';
const EXPECTED=Object.freeze({KOSPI:5730.74,KOSDAQ:724.38,KOSPI200:899.78});
const INDEX_TYPES=Object.freeze(['KOSPI','KOSDAQ','KOSPI200']);
function kstDate(instant) {
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Seoul',
  year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'
 }).formatToParts(instant).map(x=>[x.type,x.value]));
 return {day:parts.year+'-'+parts.month+'-'+parts.day,hour:Number(parts.hour)};
}
export function inspectClosingDomesticReadback(rows,date=TARGET){
 const accepted=verifiedDomesticCloseRows(date,rows);
 const byType=new Map(accepted.map(x=>[x.type,x]));
 const indexes=INDEX_TYPES.map(type=>{
  const x=byType.get(type),reference=EXPECTED[type];
  return {type,date:x?.date||null,source:x?.source||'UNAVAILABLE',
   priceType:x?.priceType||null,
   value:x?.value??null,
   matchesReference:Number.isFinite(x?.value)&&Math.round(x.value*100)===Math.round(reference*100),
   independentlyCrosschecked:x?.source==='YAHOO_SHINHAN_CROSSCHECKED_EOD'
     &&x?.priceType==='INDEPENDENT_CROSSCHECKED_EOD'
     &&x?.comparisonSource==='SHINHAN_PUBLIC_INDEX',
   publishedAt:x?.comparisonPublishedAt||null};
 });
 return {status:'DOMESTIC_EOD_CLOSING_INTEGRATION_READBACK',date,
  acceptedDomesticCount:accepted.length,allThreeMatch:indexes.every(x=>x.matchesReference),
  allThreeIndependentlyCrosschecked:indexes.every(x=>x.independentlyCrosschecked),
  indexes,readOnly:true,nhTokenRequested:false,telegramSent:false,writesPerformed:0};
}
export async function runIntegratedReadback({
 now=()=>new Date(),fetchDomestic=fetchDomesticCloseIndexes
}={}){
 const current=kstDate(now());
 if(current.day!==TARGET||current.hour<16)
  return {status:'DOMESTIC_EOD_DIAGNOSTIC_WINDOW_CLOSED'};
 if(!process.env.GAS_WEB_APP_URL||!process.env.GAS_ACCESS_TOKEN)
  return {status:'DOMESTIC_EOD_GAS_AUTH_UNAVAILABLE'};
 try {
  const rows=await fetchDomestic(TARGET,{now});
  return inspectClosingDomesticReadback(rows,TARGET);
 }catch{return {status:'DOMESTIC_EOD_INTEGRATION_FETCH_UNAVAILABLE'};}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 if(process.env.GITHUB_REF==='refs/heads/main'
     &&process.env.GITHUB_EVENT_NAME==='workflow_run') {
  const result=await runIntegratedReadback();
  console.log(JSON.stringify(result));
 }
}
