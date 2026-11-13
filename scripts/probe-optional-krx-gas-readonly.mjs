// Production-safe KRX optional indicator provenance diagnostic.
// Public KRX daily indexes/stocks and existing read-only GAS routes only.
// No portfolio updates, key issuance, SMS/Telegram messages or raw provider payloads.
import {pathToFileURL} from 'node:url';
import {krxSessionStatus} from './krx-session-calendar.mjs';
import {parseKrxBreadth} from './telegram-morning-breadth.mjs';
import {readClosingVkospi} from './closing-vkospi-reference.mjs';
import {readClosingKrxTurnoverFromGas} from './closing-krx-turnover.mjs';

const REPO='cyyoung111-dev/portfolio';
const SOURCES=[
 ['STOCK_KOSPI','/svc/apis/sto/stk_bydd_trd','KOSPI'],
 ['STOCK_KOSDAQ','/svc/apis/sto/ksq_bydd_trd','KOSDAQ'],
 ['INDEX_KOSPI','/svc/apis/idx/kospi_dd_trd',null],
 ['INDEX_KOSDAQ','/svc/apis/idx/kosdaq_dd_trd',null],
 ['INDEX_DERIVATIVE','/svc/apis/idx/drvprod_dd_trd',null]
];
const authPattern=/^[A-Za-z0-9_-]{16,128}$/;
function kst(now){
 const v=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{
  timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',
  hour:'2-digit',minute:'2-digit',hourCycle:'h23'
 }).formatToParts(now).map(x=>[x.type,x.value]));
 return {day:v.year+'-'+v.month+'-'+v.day,minutes:Number(v.hour)*60+Number(v.minute),
  asOf:v.year+'-'+v.month+'-'+v.day+' '+v.hour+':'+v.minute+' KST'};
}
function priorOpen(date){
 const stamp=Date.parse(date+'T00:00:00Z');
 if(!Number.isFinite(stamp))return null;
 for(let i=1;i<=14;i++){
  const target=new Date(stamp-i*86400000).toISOString().slice(0,10);
  const status=krxSessionStatus(target);
  if(status==='OPEN')return target;
  if(status==='UNKNOWN')return null;
 }
 return null;
}
export function completedKrxSession(now){
 if(!(now instanceof Date)||!Number.isFinite(now.getTime()))return null;
 const local=kst(now),market=krxSessionStatus(local.day);
 if(market==='UNKNOWN')return null;
 return market==='OPEN'&&local.minutes>=960?local.day:priorOpen(local.day);
}
// Audited derivative index identity proof. Keep raw index values out of Actions logs.
export function auditDirectVkospiRows(date,rows){
 const expected=String(date||'').replaceAll('-','');
 const matched=Array.isArray(rows)?rows.filter(x=>
  /VKOSPI|코스피 ?200 ?변동성/i.test(String(x?.IDX_NM||''))):[];
 // Do not confuse related short-term/futures/leveraged volatility indexes
 // with the exact KOSPI 200 Volatility Index (VKOSPI).
 const primary=matched.filter(x=>
  /^(?:VKOSPI|코스피\s*200\s*변동성지수(?:\s*\(VKOSPI\))?)$/i
   .test(String(x?.IDX_NM||'').trim()));
 const dated=primary.filter(x=>String(x?.BAS_DD||'')===expected);
 const valid=dated.filter(x=>{
  const raw=String(x?.CLSPRC_IDX??'').trim().replaceAll(',','');
  return raw!==''&&Number.isFinite(Number(raw))&&Number(raw)>0&&Number(raw)<200;
 });
 // Names are public KRX index identifiers only; never print quotes or keys.
 const candidateNames=[...new Set(matched.map(x=>String(x?.IDX_NM||'')
  .replace(/[^\p{L}\p{N}\s()_-]/gu,'').trim().slice(0,70)))].slice(0,8);
 return {candidateCount:matched.length,candidateNames,
  primaryCount:primary.length,exactDateCount:dated.length,
  verified:primary.length===1&&dated.length===1&&valid.length===1};
}

const allowedReason=/^[A-Z][A-Z0-9_]{2,75}$/;
const cleanReasons=values=>values.map(x=>allowedReason.test(x?.status||'')?x.status:'UNVERIFIED');
export async function probeOptionalKrxMetrics({
 now=new Date(),key=process.env.KRX_AUTH_KEY,gasUrl=process.env.GAS_WEB_APP_URL,
 gasToken=process.env.GAS_ACCESS_TOKEN,fetchImpl=fetch,
 getVkospi=readClosingVkospi,getTurnover=readClosingKrxTurnoverFromGas,
 output=x=>console.log(JSON.stringify(x))
}={}){
 const date=completedKrxSession(now),local=kst(now);
 const gasReady=Boolean(gasUrl)&&typeof gasToken==='string'&&gasToken.length>=12;
 const directReady=typeof key==='string'&&authPattern.test(key);
 const result={kind:'KRX_OPTIONAL_METRICS_READONLY',date,asOf:local.asOf,
  configured:{gas:gasReady,githubKrxKey:directReady},
  portfolioWrites:0,gasWrites:0,telegramSends:0,tokenIssuances:0};
 output(result);
 if(!date)return {date:null,readOnly:true};
 const preceding=priorOpen(date);
 // Historical date is passed only to the source's immutable close-time gate.
 // Synthetic time never certifies that the data existed at that historical time.
 if(gasReady){
  for(const target of [date,preceding].filter(Boolean)){
   const nowGate=()=>new Date(target+'T17:08:00+09:00');
   const metrics=await Promise.allSettled([
    (async()=>{const reasons=[];
     const rows=await getVkospi(target,{url:gasUrl,token:gasToken,now:nowGate,
      fetchImpl,onDiagnostic:x=>reasons.push(x)});
     return {verified:rows.length===1,reasons:cleanReasons(reasons)};})(),
    (async()=>{const reasons=[];
     const rows=await getTurnover(target,{url:gasUrl,token:gasToken,now:nowGate,
      fetchImpl,onDiagnostic:x=>reasons.push(x)});
     return {verified:rows.length,expected:2,reasons:cleanReasons(reasons)};})()
   ]);
   output({kind:'KRX_GAS_OPTIONAL_CONTRACT',date:target,
    provenance:'HISTORIC_READ_ACTUAL_REQUEST_TIME',
    vkospi:metrics[0].status==='fulfilled'?metrics[0].value:{verified:false,reasons:['REQUEST_FAILED']},
    turnover:metrics[1].status==='fulfilled'?metrics[1].value:{verified:0,expected:2,reasons:['REQUEST_FAILED']},
    writes:0});
  }
 }
 if(directReady){
  // A same-day 0-row response is ambiguous without an actual control day.
  // Compare the prior confirmed KRX session at request time, not a fabricated
  // historical observation. At most 2 x 5 public GETs, no financial writes.
  for(const targetDate of [date,preceding].filter(Boolean)){
  await Promise.all(SOURCES.map(async([id,path,market])=>{
   const status={kind:'KRX_DIRECT_OPTIONAL_CONTRACT',date:targetDate,id,
    provenance:'HISTORIC_READ_ACTUAL_REQUEST_TIME'};
   const url=new URL('https://data-dbg.krx.co.kr'+path);
   url.searchParams.set('basDd',targetDate.replaceAll('-',''));
   try{
    const response=await fetchImpl(url.href,{method:'GET',
     headers:{AUTH_KEY:key,accept:'application/json'},redirect:'error',
     signal:AbortSignal.timeout(8500)});
    status.http=Number(response?.status)||0;
    if(response?.ok){
     const raw=await response.json(),rows=raw?.OutBlock_1;
     status.payloadShape=!Array.isArray(rows)?'NO_OUTBLOCK':
      rows.length===0?'EMPTY_OUTBLOCK':'OUTBLOCK_PRESENT';
     status.rowCount=Array.isArray(rows)?rows.length:0;
     status.exactDate=Array.isArray(rows)&&rows.length>0
      &&rows.every(x=>String(x?.BAS_DD||'')===targetDate.replaceAll('-',''));
     // Do not emit any index prices/turnover values, only fixed schema names.
     status.schemaFields=Array.isArray(rows)&&rows.length>0
      ?['BAS_DD','IDX_NM','CLSPRC_IDX','ACC_TRDVAL','TDD_HGPRC','TDD_LWPRC']
       .filter(k=>Object.hasOwn(rows[0]||{},k)):[];
     if(market){
      const parsed=parseKrxBreadth(targetDate,market,raw);
      status.breadthVerified=Boolean(parsed);
      if(parsed)status.breadth={advances:parsed.advances,declines:parsed.declines,
       unchanged:parsed.unchanged,issues:parsed.issues};
      status.turnoverColumnAvailable=Array.isArray(rows)&&rows.length>0
       &&rows.every(x=>Object.hasOwn(x||{},'ACC_TRDVAL'));
     }else{
      status.turnoverColumnAvailable=Array.isArray(rows)&&rows.length>0
       &&rows.some(x=>Object.hasOwn(x||{},'ACC_TRDVAL'));
      if(id==='INDEX_DERIVATIVE'){
       const audit=auditDirectVkospiRows(targetDate,rows);
       status.vkospiCandidateCount=audit.candidateCount;
       status.vkospiCandidateNames=audit.candidateNames;
       status.vkospiPrimaryCount=audit.primaryCount;
       status.vkospiExactDateCount=audit.exactDateCount;
       status.vkospiVerified=audit.verified;
      }
     }
    }
   }catch(e){status.error=['TimeoutError','AbortError'].includes(e?.name)
     ?'TIMEOUT':'NETWORK_OR_RESPONSE';}
   output(status);
  }));
  }
 }
 output({kind:'KRX_52W_MARKET_BREADTH',date,
  status:'HISTORICAL_252_SESSIONS_REQUIRED',
  note:'ONE_DAY_ADVANCE_DECLINE_IS_NOT_52W_NEW_HIGH_NEW_LOW',writes:0});
 return {date,readOnly:true,gasConfigured:gasReady,githubKrxKeyConfigured:directReady};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{await probeOptionalKrxMetrics();}
 catch{console.error('KRX_OPTIONAL_METRICS_PROBE_UNVERIFIED');process.exitCode=1;}
}
