// Verified KRX official VKOSPI daily index reference for the closing Telegram brief.
// Read-only central GAS getBenchmark; no NH token issuance or portfolio writes.
import {isOfficialCloseWindow} from './krx-official-daily-index.mjs';
import {validateGasEndpoint} from './nh-gas-proxy.mjs';
import {readOfficialKrxVkospiDaily} from './krx-vkospi-daily.mjs';

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
 authKey=process.env.KRX_AUTH_KEY,now=()=>new Date(),fetchImpl=fetch,
 fetchDirect=readOfficialKrxVkospiDaily,onDiagnostic=()=>{}
}={}){
 const emit=status=>{try{onDiagnostic({kind:'VKOSPI_READ',status});}catch{}};
 if(!isOfficialCloseWindow(date,now())){
  emit('CONFIG_OR_SESSION_UNVERIFIED');return [];
 }
 const direct=async()=>{
  let candidate=[];
  try{candidate=await fetchDirect(date,{authKey,now,fetchImpl});}catch{}
  const rows=verifyClosingVkospi(date,candidate);
  if(rows.length===1)emit('KRX_DIRECT_VERIFIED');
  return rows;
 };
 if(!url||typeof token!=='string'||token.length<12){
  emit('CONFIG_OR_SESSION_UNVERIFIED');return direct();
 }
 let endpoint;
 try{endpoint=validateGasEndpoint(url);}
 catch{emit('ENDPOINT_INVALID');return direct();}
 try{
  const body=new URLSearchParams({action:'getBenchmark',accessToken:token,
   benchmark:'VKOSPI',from:date,to:date});
  const response=await fetchImpl(endpoint,{method:'POST',
   headers:{'content-type':'application/x-www-form-urlencoded;charset=UTF-8'},
   body,redirect:'follow',signal:AbortSignal.timeout(17000)});
  if(!response?.ok){emit('HTTP_UNAVAILABLE');return direct();}
  const payload=await response.json();
  if(payload?.status!=='ok'){
   const message=payload?.message;
   const status=payload?.status!=='error'?'GAS_RESPONSE_SCHEMA'
    :message==='인증 실패'?'GAS_AUTH_REJECTED'
    :message==='선택 기간의 VKOSPI 데이터를 조회하지 못했습니다.'
      ?'KRX_NO_DATED_VKOSPI_POINT'
    :message==='getBenchmark 실패: VKOSPI 조회에는 KRX AUTH_KEY가 필요합니다. 설정에서 KRX 인증키를 등록하세요.'
      ?'KRX_KEY_NOT_CONFIGURED'
    :message==='getBenchmark 실패: KRX AUTH_KEY가 유효하지 않거나 지수 API 이용 권한이 없습니다.'
      ?'KRX_KEY_OR_INDEX_PERMISSION_DENIED'
    :message==='getBenchmark 실패: VKOSPI 날짜 배치 네트워크 오류'
      ?'KRX_VKOSPI_BATCH_NETWORK_FAILURE':'GAS_STATUS_ERROR';
   emit(status);return direct();
  }
  const rows=selectClosingVkospi(date,payload);
  emit(rows.length===1?'VERIFIED':'NO_EXACT_VALID_ROW');
  return rows.length===1?rows:direct();
 }catch{emit('NETWORK_OR_PARSE_FAILED');return direct();}
}
