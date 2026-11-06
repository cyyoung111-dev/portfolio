// Verified KRX official VKOSPI daily index reference for the closing Telegram brief.
// Read-only central GAS getBenchmark; no NH token issuance or portfolio writes.
import {isOfficialCloseWindow} from './krx-official-daily-index.mjs';
import {validateGasEndpoint} from './nh-gas-proxy.mjs';

const SOURCE='KRX_OFFICIAL', SYMBOL='KRX_OPEN_API:VKOSPI';
const validDate=date=>typeof date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(date)
 &&Number.isFinite(Date.parse(date+'T00:00:00Z'))
 &&new Date(date+'T00:00:00Z').toISOString().slice(0,10)===date;
const validValue=v=>Number.isFinite(v)&&v>0&&v<200;

export function selectClosingVkospi(date,payload){
 if(!validDate(date)||payload?.status!=='ok'||payload.symbol!==SYMBOL
  ||!Array.isArray(payload.points)||payload.points.length>120)return [];
 const matching=payload.points.filter(row=>row?.date===date);
 if(matching.length!==1)return [];
 const row=matching[0];
 if((row.source!==undefined&&row.source!==SOURCE)||!validValue(row.value)
  ||(row.sourceDate!==undefined&&row.sourceDate!==date))return [];
 return [{id:'VKOSPI',label:'VKOSPI',date,value:row.value,source:SOURCE,
  role:'NON_NH_REFERENCE_ONLY'}];
}
export function verifyClosingVkospi(date,rows=[]){
 if(!validDate(date)||!Array.isArray(rows)||rows.length!==1)return [];
 const row=rows[0];
 return row?.id==='VKOSPI'&&row.label==='VKOSPI'&&row.date===date
  &&row.source===SOURCE&&row.role==='NON_NH_REFERENCE_ONLY'&&validValue(row.value)
  ?[{id:'VKOSPI',label:'VKOSPI',date,value:row.value,source:SOURCE,
    role:'NON_NH_REFERENCE_ONLY'}]:[];
}
export async function readClosingVkospi(date,{
 url=process.env.GAS_WEB_APP_URL,token=process.env.GAS_ACCESS_TOKEN,
 now=()=>new Date(),fetchImpl=fetch,onDiagnostic=()=>{}
}={}){
 const emit=status=>{try{onDiagnostic({kind:'VKOSPI_READ',status});}catch{}};
 if(!isOfficialCloseWindow(date,now())||!url||typeof token!=='string'||token.length<12){
  emit('CONFIG_OR_SESSION_UNVERIFIED');return [];
 }
 let endpoint;
 try{endpoint=validateGasEndpoint(url);}catch{emit('ENDPOINT_INVALID');return [];}
 try{
  const body=new URLSearchParams({action:'getBenchmark',accessToken:token,
   benchmark:'VKOSPI',from:date,to:date});
  const response=await fetchImpl(endpoint,{method:'POST',
   headers:{'content-type':'application/x-www-form-urlencoded;charset=UTF-8'},
   body,redirect:'follow',signal:AbortSignal.timeout(17000)});
  if(!response?.ok){emit('HTTP_UNAVAILABLE');return [];}
  const payload=await response.json();
  if(payload?.status!=='ok'){emit('GAS_RESPONSE_NOT_OK');return [];}
  const rows=selectClosingVkospi(date,payload);
  emit(rows.length===1?'VERIFIED':'NO_EXACT_VALID_ROW');
  return rows;
 }catch{emit('NETWORK_OR_PARSE_FAILED');return [];}
}
