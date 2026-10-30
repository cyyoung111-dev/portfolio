import {inspectNightTickResult} from './nhplug-night-readonly-diagnostic.mjs';
export function latestNightReference(data,candidates,date){
 const code=data?.Output_0?.iem_cd;
 const matches=candidates.filter(x=>x.code===code);
 if(matches.length!==1||inspectNightTickResult(data,code,date.replaceAll('-','')).status!=='DATED_TICK_REFERENCE_PRESENT')return null;
 const rows=(data.Output_1||[]).filter(row=>inspectNightTickResult({Output_0:data.Output_0,Output_1:[row]},code,date.replaceAll('-','')).status==='DATED_TICK_REFERENCE_PRESENT');
 const offset=row=>{const t=String(row.bsop_time);const sec=Number(t.slice(0,2))*3600+Number(t.slice(2,4))*60+Number(t.slice(4));return sec>=64800?sec-86400:sec;};
 rows.sort((a,b)=>offset(b)-offset(a));
 if(!rows.length)return null;
 const latest=rows.filter(x=>offset(x)===offset(rows[0]));
 if(new Set(latest.map(x=>Number(x.prpr))).size!==1)return null;
 const time=String(rows[0].bsop_time);
 return {source:'NH',date,contract:code,contractMonth:matches[0].contractMonth,clock:time.slice(0,2)+':'+time.slice(2,4)+':'+time.slice(4),value:Number(rows[0].prpr),officialClose:false,lastTradeCompletenessVerified:false};
}

export function validateNhNight(value,date,receivedAt){
 const price=Number(value?.value),at=Date.parse(receivedAt),end=Date.parse(`${date}T06:00:00+09:00`);
 if(value?.date!==date||value?.clock!=='06:00:00'||!/^K[A-Z0-9]{8}$/.test(value?.contract||'')||!/^\d{4}-(03|06|09|12)$/.test(value?.contractMonth||'')||!(price>0)||!Number.isFinite(price)||Math.abs(price*20-Math.round(price*20))>1e-7||!Number.isFinite(at)||at<end)return null;
 return {source:'NH',kind:'REFERENCE',tradingDate:date,contract:value.contract,contractMonth:value.contractMonth,value:price,clock:'06:00:00',sourceUpdatedAt:`${date}T06:00:00+09:00`,receivedAt:new Date(at).toISOString(),officialClose:false};
}
