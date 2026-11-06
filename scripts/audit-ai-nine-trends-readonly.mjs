import {pathToFileURL} from 'node:url';
import {AI_NINE} from './briefing-ai-nine-sources.mjs';
import {readAiNineHistoricalTrends} from './briefing-ai-nine-trends.mjs';
// Read-only 52-week/long-horizon COVERAGE check. Never logs raw prices,
// financial facts, source bodies, credentials or private portfolio rows.
export async function runAiNineTrendAudit({
 now=()=>new Date(),readTrends=readAiNineHistoricalTrends
}={}){
 const instant=now();
 if(!(instant instanceof Date)||!Number.isFinite(instant.getTime()))
  throw Error('AI9_TREND_AUDIT_CLOCK_INVALID');
 const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{
  timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'
 }).formatToParts(instant).map(x=>[x.type,x.value]));
 const date=p.year+'-'+p.month+'-'+p.day;
 let result=null;
 try{result=await readTrends(date,{now});}catch{}
 const entries=AI_NINE.map(item=>{
  const states=Array.isArray(result?.statuses)?result.statuses.filter(x=>x?.symbol===item.symbol):[];
  const values=Array.isArray(result?.trends)?result.trends.filter(x=>x?.symbol===item.symbol):[];
  const good=states.length===1&&states[0]?.status==='VERIFIED'
   &&values.length===1&&values[0]?.date===result?.sessionDate
   &&values[0]?.source==='YAHOO_SPLIT_ADJUSTED_DAILY_REFERENCE';
  const t=good?values[0]:null;
  return {symbol:item.symbol,status:good?'VERIFIED':'UNVERIFIED',
   week52:t?.week52?'AVAILABLE':'UNVERIFIED',
   returnsYears:Object.fromEntries([1,3,5,10]
    .map(year=>[String(year),Number.isFinite(t?.returnsYears?.[String(year)])?
     'AVAILABLE':'UNAVAILABLE']))};
 });
 return {mode:'AI9_TREND_AUDIT_READ_ONLY',kstDate:date,
  usSessionDate:typeof result?.sessionDate==='string'?result.sessionDate:null,
  verified:entries.filter(x=>x.status==='VERIFIED').length,total:9,
  items:entries,portfolioWrites:0,telegramSends:0,gasDeployments:0};
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
 try{console.log(JSON.stringify(await runAiNineTrendAudit()));}
 catch{console.error('AI9_TREND_AUDIT_UNVERIFIED');process.exitCode=1;}
}
