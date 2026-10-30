// One-time actual GAS + FDR + Shinhan integration proof, no persistence or NH auth.
import {fetchDomesticCloseIndexes,verifiedDomesticCloseRows}
 from './telegram-close-workflow.mjs';
const date='2026-10-30';
const now=new Date();
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
if(today!==date||process.env.GITHUB_REF!=='refs/heads/main'
 ||process.env.GITHUB_EVENT_NAME!=='workflow_run'){
 console.log(JSON.stringify({status:'CROSSCHECKED_EOD_READBACK_SKIPPED'}));
 process.exit(0);
}
if(!process.env.GAS_WEB_APP_URL||!process.env.GAS_ACCESS_TOKEN){
 console.log(JSON.stringify({status:'CROSSCHECKED_EOD_GAS_AUTH_MISSING'}));
 process.exit(0);
}
let rows=[];
try{rows=await fetchDomesticCloseIndexes(date,{
 gasUrl:process.env.GAS_WEB_APP_URL,gasToken:process.env.GAS_ACCESS_TOKEN,
 now:()=>new Date()
});}catch{/* failure is reported as zero, never substituted */}
const confirmed=verifiedDomesticCloseRows(date,rows);
console.log(JSON.stringify({
 status:'DOMESTIC_CROSSCHECKED_LIVE_READBACK',date,readOnly:true,
 count:confirmed.length,verifiedAllThree:confirmed.length===3,
 indexes:confirmed.map(r=>({type:r.type,date:r.date,
  source:r.source,priceType:r.priceType,value:r.value,
  comparisonSource:r.comparisonSource||null,
  changePercent:r.changePercent
 }))
}));
