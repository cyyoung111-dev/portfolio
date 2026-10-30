import {pathToFileURL} from 'node:url';
import {selectOfficialDailyIndexRows} from './krx-official-daily-index.mjs';

const TARGET='2026-10-30';
const TYPES=Object.freeze(['KOSPI','KOSDAQ','KOSPI200']);
// Independent same-day market-close press references; not NH/KRX API evidence.
const REFERENCES=Object.freeze({KOSPI:5730.74,KOSDAQ:724.38});
function extractType(type,data){
 const meta=data?.seriesMeta?.[type];
 const rows=Array.isArray(data?.series?.[type])?data.series[type]:[];
 const matching=rows.filter(x=>x?.date===TARGET);
 const selected=selectOfficialDailyIndexRows(TARGET,{
  status:data?.status,seriesMeta:{[type]:meta},series:{[type]:rows}
 })[0]||null;
 const observed=matching.length===1?matching[0]:null;
 const visibleValue=Number(observed?.value);
 const inspectedValue=Number.isFinite(visibleValue)&&visibleValue>0?visibleValue:null;
 const official=selected!==null;
 const value=official?selected.value:null;
 const reference=REFERENCES[type];
 return {
  type,targetDate:TARGET,
  state:official?(reference===undefined?'OFFICIAL_UNCROSSCHECKED':
    Math.abs(value-reference)<0.005?'OFFICIAL_REFERENCE_MATCH':'OFFICIAL_REFERENCE_MISMATCH'):
    'OFFICIAL_NOT_VERIFIED',
  officialDate:official?TARGET:null,
  source:official?'KRX_OFFICIAL':String(meta?.source||'NONE').slice(0,32),
  metaConfirmed:meta?.confirmedClose===true,
  metaOfficialDate:typeof meta?.officialDate==='string'?meta.officialDate.slice(0,10):null,
  returnedDate:observed?.date||null,
  returnedSource:typeof observed?.source==='string'?observed.source.slice(0,32):null,
  validatedOfficialClose:value,
  unverifiedDatedValue:official?null:inspectedValue,
  unverifiedReferenceMatch:!official&&reference!==undefined&&inspectedValue!==null
    ?Math.abs(inspectedValue-reference)<0.005:null,
  independentReference:reference??null,
  absoluteDifference:official&&reference!==undefined?Math.round((value-reference)*100)/100:null,
  datedRowCount:matching.length,
 };
}
function classifyKrxError(error){
 const input=String(error||'');
 if(!input)return 'NONE_REPORTED';
 const kinds=['EMPTY_TRADING_DATE','HTTP_401','HTTP_403','HTTP_429',
  'FETCH_FAILED','TIMEOUT','CALENDAR_UNKNOWN','AUTH_KEY','NO_DATA','INVALID'];
 return kinds.filter(kind=>input.includes(kind)).join('|')||'OTHER_REDACTED';
}
export function summarizeKrxDomesticCloseReadback(data){
 const checks=TYPES.map(t=>extractType(t,data));
 return {
  status:'KRX_DOMESTIC_CLOSE_LIVE_READBACK',
  targetDate:TARGET,
  responseStatus:data?.status==='ok'?'ok':'NON_OK',
  checkedTypes:checks,
  krxSourceFailureCode:classifyKrxError(data?.errors?.KRX_OFFICIAL),
  krxErrorPresent:!!data?.errors?.KRX_OFFICIAL,
  verifiedOfficialCount:checks.filter(x=>x.state.startsWith('OFFICIAL_')&&x.validatedOfficialClose!==null).length,
  independentlyMatchedCount:checks.filter(x=>x.state==='OFFICIAL_REFERENCE_MATCH').length,
  completeVerifiedAndMatched:checks.every(x=>x.state==='OFFICIAL_REFERENCE_MATCH'||x.state==='OFFICIAL_UNCROSSCHECKED'),
  writesPerformed:0,nhTokenRequested:false,
 };
}
export async function runReadback({fetchImpl=fetch,url=process.env.GAS_WEB_APP_URL,
  token=process.env.GAS_ACCESS_TOKEN,now=()=>new Date()}={}){
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Seoul',
  year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'
 }).formatToParts(now()).map(x=>[x.type,x.value]));
 const today=parts.year+'-'+parts.month+'-'+parts.day;
 if(today!==TARGET||Number(parts.hour)<16)return {status:'SKIPPED_NOT_TARGET_CLOSE_DATE'};
 if(!url||!token)return {status:'KRX_DOMESTIC_GAS_AUTH_MISSING'};
 let endpoint;
 try{
  endpoint=new URL(url);
  if(endpoint.protocol!=='https:'||endpoint.hostname!=='script.google.com'
    ||!/^\/macros\/s\/[^/]+\/exec$/.test(endpoint.pathname)||endpoint.search)
    return {status:'KRX_DOMESTIC_GAS_ENDPOINT_REJECTED'};
 }catch{return {status:'KRX_DOMESTIC_GAS_ENDPOINT_REJECTED'};}
 try{
  const body=new URLSearchParams({action:'getBenchmarks',
   accessToken:token,benchmarks:TYPES.join(','),from:TARGET,to:TARGET,fresh:'1'});
  const res=await fetchImpl(endpoint.href,{method:'POST',redirect:'follow',
   headers:{'content-type':'application/x-www-form-urlencoded;charset=UTF-8'},
   body,signal:AbortSignal.timeout(45000)});
  if(!res.ok)return {status:'KRX_DOMESTIC_GAS_HTTP_FAILURE',httpStatus:res.status};
  return summarizeKrxDomesticCloseReadback(await res.json());
 }catch{return {status:'KRX_DOMESTIC_GAS_READBACK_FAILED'};}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 if(process.env.GITHUB_REF!=='refs/heads/main'||process.env.GITHUB_EVENT_NAME!=='workflow_run')
  process.exit(0);
 runReadback().then(result=>{
  console.log(JSON.stringify(result));
  // Read-only diagnosis is nonblocking; unavailable T+0 official data is
  // expected until independently proven, never a release authorization.
 }).catch(()=>console.log(JSON.stringify({status:'KRX_DOMESTIC_GAS_READBACK_FAILED'})));
}
