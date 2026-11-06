import {pathToFileURL} from 'node:url';
import {AI_NINE} from './briefing-ai-nine-sources.mjs';
import {readAiNineAnnualValueSnapshots} from './briefing-ai-nine-sec-values.mjs';

// Status-only, no prices, book values, share counts, EPS, secrets or accounts.
export async function runAiNineAnnualValueAudit({reader=readAiNineAnnualValueSnapshots}={}){
 const result=await reader();
 const approved=new Set(['VERIFIED_FY_BPS_PBR','PARTIAL_FY_VALUE',
  'NO_REPORTED_FY','SEC_USER_AGENT_NOT_CONFIGURED','FETCH_FAILED',
  'SEC_HTTP_UNAVAILABLE','SEC_CONTENT_TYPE_INVALID','SEC_BODY_TOO_LARGE']);
 const statuses=AI_NINE.map(item=>{
  const matches=Array.isArray(result.statuses)
   ?result.statuses.filter(x=>x.symbol===item.symbol):[];
  const status=matches.length===1&&approved.has(matches[0].status)
   ?matches[0].status:'UNVERIFIED';
  const report=Array.isArray(result.snapshots)
   ?result.snapshots.find(x=>x.symbol===item.symbol):null;
  return {symbol:item.symbol,status,
   annualEps:typeof report?.dilutedAnnualEpsUsd==='number'?'AVAILABLE':'UNAVAILABLE',
   fiscalEndBps:typeof report?.bpsUsd==='number'?'AVAILABLE':'UNAVAILABLE',
   referencePbr:typeof report?.pbrTimes==='number'?'AVAILABLE':'UNAVAILABLE'};
 });
 return {mode:'AI9_FY_EPS_BPS_PBR_READ_ONLY',total:AI_NINE.length,
  verified:statuses.filter(x=>x.status==='VERIFIED_FY_BPS_PBR').length,
  statuses,portfolioWrites:0,telegramSends:0,gasDeployments:0};
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
 try{console.log(JSON.stringify(await runAiNineAnnualValueAudit()));}
 catch{console.error('AI9_FY_VALUE_AUDIT_UNVERIFIED');process.exitCode=1;}
}
