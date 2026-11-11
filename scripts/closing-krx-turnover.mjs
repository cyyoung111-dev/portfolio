// KRX OpenAPI official index transaction value; optional read-only provider.
// Direct credentials are never embedded, persisted or included in results.
// Not wired to Telegram until an approved central GAS read contract is available.
import {isOfficialCloseWindow} from './krx-official-daily-index.mjs';
import {validateGasEndpoint} from './nh-gas-proxy.mjs';

const MARKET=Object.freeze({
 KOSPI:Object.freeze({path:'/svc/apis/idx/kospi_dd_trd',name:'코스피'}),
 KOSDAQ:Object.freeze({path:'/svc/apis/idx/kosdaq_dd_trd',name:'코스닥'})
});
const validDate=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)
 &&Number.isFinite(Date.parse(d+'T00:00:00Z'))
 &&new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d;
const money=s=>{
 if(typeof s!=='string'&&!Number.isSafeInteger(s))return null;
 const raw=String(s);
 if(!/^(?:0|[1-9]\d*|[1-9]\d{0,2}(?:,\d{3})+)$/.test(raw))return null;
 const v=Number(raw.replaceAll(',',''));
 return Number.isSafeInteger(v)&&v>0&&v<1000000000000000?v:null;
};
export function selectOfficialKrxTurnover(date,market,payload){
 const info=MARKET[market];
 if(!validDate(date)||!info||!Array.isArray(payload?.OutBlock_1)
   ||payload.OutBlock_1.length>250)return null;
 const matching=payload.OutBlock_1.filter(x=>x?.IDX_NM===info.name);
 if(matching.length!==1)return null;
 const row=matching[0];
 if(row.BAS_DD!==date.replaceAll('-',''))return null;
 const value=money(row.ACC_TRDVAL);
 if(value===null)return null;
 return {id:'KRX_TURNOVER_'+market,market,date,valueKrw:value,
  source:'KRX_OFFICIAL_INDEX_DAILY',role:'NON_NH_REFERENCE_ONLY'};
}
export function verifyOfficialKrxTurnover(date,rows=[]){
 if(!validDate(date)||!Array.isArray(rows)||rows.length>2)return [];
 const accepted=[];
 for(const market of Object.keys(MARKET)){
  const matches=rows.filter(row=>row?.market===market);
  if(matches.length>1)return [];
  const row=matches[0];
  if(!row)continue;
  if(row.id!=='KRX_TURNOVER_'+market||row.date!==date
    ||row.source!=='KRX_OFFICIAL_INDEX_DAILY'
    ||row.role!=='NON_NH_REFERENCE_ONLY'||!Number.isSafeInteger(row.valueKrw)
    ||row.valueKrw<=0||row.valueKrw>=1000000000000000)return [];
  accepted.push({id:row.id,market,date,valueKrw:row.valueKrw,source:row.source,role:row.role});
 }
 return accepted;
}
export async function fetchOfficialKrxTurnover(date,{
 authKey=process.env.KRX_AUTH_KEY,now=()=>new Date(),fetchImpl=fetch
}={}){
 if(!isOfficialCloseWindow(date,now())||typeof authKey!=='string'
   ||!/^[A-Za-z0-9_-]{16,128}$/.test(authKey))return [];
 const rows=await Promise.all(Object.entries(MARKET).map(async([market,info])=>{
  const target=new URL('https://data-dbg.krx.co.kr'+info.path);
  target.searchParams.set('basDd',date.replaceAll('-',''));
  try{
   const response=await fetchImpl(target.href,{method:'GET',redirect:'error',
    headers:{AUTH_KEY:authKey,accept:'application/json'},signal:AbortSignal.timeout(10000)});
   if(!response?.ok)return null;
   const len=Number(response.headers?.get?.('content-length')||0);
   if(len>250000)return null;
   const body=await response.json();
   return selectOfficialKrxTurnover(date,market,body);
  }catch{return null;}
 }));
 return verifyOfficialKrxTurnover(date,rows.filter(Boolean));
}
export function formatKrxTurnover(date,rows=[]){
 const verified=verifyOfficialKrxTurnover(date,rows);
 return Object.keys(MARKET).map(market=>{
  const row=verified.find(x=>x.market===market);
  return market+' 지수 구성종목 거래대금: '(row?(row.valueKrw/1000000000000).toFixed(2)
    +'조원 ['+date+' · KRX]':'공식 당일 자료 미확보');
 }).join('\n');
}


// Production-friendly read-only bridge. Existing KRX key remains in GAS
// Script Properties. GitHub sends only its existing GAS access token.
export async function readClosingKrxTurnoverFromGas(date,{
 url=process.env.GAS_WEB_APP_URL,token=process.env.GAS_ACCESS_TOKEN,
 now=()=>new Date(),fetchImpl=fetch,onDiagnostic=()=>{}
}={}){
 const emit=status=>{try{onDiagnostic({kind:'KRX_TURNOVER_READ',status});}catch{}};
 if(!isOfficialCloseWindow(date,now())||!url
   ||typeof token!=='string'||token.length<12){
  emit('CONFIG_OR_SESSION_UNVERIFIED');return [];
 }
 let endpoint;
 try{endpoint=validateGasEndpoint(url);}catch{emit('ENDPOINT_INVALID');return [];}
 try{
  const response=await fetchImpl(endpoint,{method:'POST',
   headers:{'content-type':'application/x-www-form-urlencoded;charset=UTF-8'},
   body:new URLSearchParams({action:'getKrxMarketTurnover',accessToken:token,date}),
   redirect:'follow',signal:AbortSignal.timeout(17000)});
  if(!response?.ok){emit('HTTP_UNAVAILABLE');return [];}
  const data=await response.json();
  if(data?.status!=='ok'||data.date!==date||data.readOnly!==true
    ||data.source!=='KRX_OFFICIAL_INDEX_DAILY'||!Array.isArray(data.rows)
    ||data.rows.length>2){emit('PAYLOAD_INVALID');return [];}
  const verified=verifyOfficialKrxTurnover(date,data.rows);
  if(data.rows.length===0){emit('GAS_EMPTY_ROWS');return [];}
  if(verified.length!==data.rows.length){emit('NO_EXACT_VALID_ROWS');return [];}
  emit(verified.length===2?'BOTH_VERIFIED':verified.length?'PARTIAL':'NO_EXACT_VALID_ROWS');
  return verified;
 }catch{emit('NETWORK_OR_PARSE_FAILED');return [];}
}
