import {pathToFileURL} from 'node:url';
import {diagnoseNight,inspectNightTickResult} from './nhplug-night-readonly-diagnostic.mjs';
import {parsePublicFutureMaster} from './nhplug-public-future-master.mjs';
import {fetchTflNight} from './tfl-night-reference.mjs';

// Output only validated public market fields. Never expose raw payloads or auth.
export function latestNightReference(data,candidates,date){
 const code=data?.Output_0?.iem_cd;
 const matches=candidates.filter(x=>x.code===code);
 if(matches.length!==1||inspectNightTickResult(data,code,date.replaceAll('-','')).status!=='DATED_TICK_REFERENCE_PRESENT')return null;
 const rows=(data.Output_1||[]).filter(row=>inspectNightTickResult({Output_0:data.Output_0,Output_1:[row]},code,date.replaceAll('-','')).status==='DATED_TICK_REFERENCE_PRESENT');
 const offset=row=>{const t=row.bsop_time;const sec=Number(t.slice(0,2))*3600+Number(t.slice(2,4))*60+Number(t.slice(4));return sec>=64800?sec-86400:sec;};
 rows.sort((a,b)=>offset(b)-offset(a));
 if(!rows.length)return null;
 const latest=rows.filter(x=>offset(x)===offset(rows[0]));
 if(new Set(latest.map(x=>Number(x.prpr))).size!==1)return null;
 const time=String(rows[0].bsop_time);
 return {source:'NH',date,contract:code,contractMonth:matches[0].contractMonth,clock:time.slice(0,2)+':'+time.slice(2,4)+':'+time.slice(4),value:Number(rows[0].prpr),officialClose:false,lastTradeCompletenessVerified:false};
}
export function compareNightReferences(nh,tfl){
 if(!nh)return {status:'NH_REFERENCE_MISSING'};
 if(!tfl)return {status:'TFL_SAME_DATE_CLOSED_REFERENCE_MISSING',nh};
 const match=/^A01(\d)(03|06|09|12)$/.exec(tfl.contract||'');
 const month=String(nh.contractMonth||'');
 if(tfl.tradingDate!==nh.date||!match||!/^\d{4}-(03|06|09|12)$/.test(month)||Number(match[1])!==Number(month.slice(0,4))%10||match[2]!==month.slice(5))return {status:'DATE_OR_CONTRACT_MISMATCH',nh,tfl};
 const differencePt=Math.round((nh.value-tfl.value)*100)/100;
 return {status:differencePt===0?'MATCH_REFERENCE_ONLY':'PRICE_DIFFERENCE',nh,tfl,differencePt,differencePct:Math.round(differencePt/tfl.value*1000000)/10000,officialCloseVerified:false};
}
export async function runNightComparison({key,secret,request=fetch,now=()=>new Date(),tflFetch=fetchTflNight,log=console.log}={}){
 let data=null,candidates=[];
 const capture=async(url,opts)=>{
  const response=await request(url,opts);
  if(url.endsWith('/m_future.mst')&&response.ok)candidates=parsePublicFutureMaster(Buffer.from(await response.clone().arrayBuffer())).candidates;
  if(url.endsWith('/krfuture/quote/v1/nightPeriod')&&response.ok)data=await response.clone().json();
  return response;
 };
 const passed=await diagnoseNight({key,secret,request:capture,now,log});
 if(!passed)return {status:'NH_DIAGNOSTIC_FAILED'};
 const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(now());
 const nh=latestNightReference(data,candidates,date);
 const tfl=await tflFetch(date,{now});
 return compareNightReferences(nh,tfl);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{const result=await runNightComparison({key:process.env.NHPLUG_APP_KEY,secret:process.env.NHPLUG_APP_SECRET});console.log('NIGHT_COMPARISON '+JSON.stringify(result));if(!['MATCH_REFERENCE_ONLY','PRICE_DIFFERENCE'].includes(result.status))process.exitCode=1;}
 catch{console.error('NIGHT_COMPARISON REQUEST_FAILED');process.exitCode=1;}
}
