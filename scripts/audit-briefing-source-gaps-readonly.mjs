// Production, no-write diagnosis for data omitted from the 17:00 market briefing.
// Log only fixed instrument IDs, approved source labels, dates and counts.
// Never log prices, private positions, access tokens or raw network responses.
import {pathToFileURL} from 'node:url';
import {krxSessionStatus} from './krx-session-calendar.mjs';
import {readClosingStockSources,validClosingStockReference} from './closing-extra-daily-sources.mjs';
import {readClosingKrxTurnoverFromGas} from './closing-krx-turnover.mjs';
import {readClosingVkospi} from './closing-vkospi-reference.mjs';
import {readTreasuryCurve,verifyTreasuryCurve} from './closing-us-treasury-curve.mjs';

const STOCK_IDS=Object.freeze(['SAMSUNG','SKHYNIX','NVDA','MU']);
const TURNOVER_IDS=Object.freeze(['KOSPI','KOSDAQ']);
const TREASURY_IDS=Object.freeze(['UST2Y','UST3Y','UST10Y_FRED']);
const SAFE_STOCK_SOURCES=new Set(['NH_REGULAR_CLOSE','KRX_OFFICIAL','YAHOO_DAILY_REFERENCE']);
const DIAGNOSTIC_KINDS=new Set([
 'NH_CLOSE_STOCK_READ','KRX_CLOSE_STOCK_READ','US_STOCK_DAILY_REFERENCE',
 'CLOSE_STOCK_COVERAGE','KRX_TURNOVER_READ','VKOSPI_READ','FRED_TREASURY_READ'
]);
const VALID_STATUSES=new Set([
 'GAS_RESPONSE_OK','SESSION_UNVERIFIED','GAS_AUTH_REJECTED',
 'GAS_RESPONSE_NOT_OK','PRICE_RESPONSE_SCHEMA','CONFIG_OR_SESSION_UNVERIFIED',
 'GAS_ENDPOINT_INVALID','GAS_TIMEOUT_30S','GAS_FETCH_FAILED',
 'GAS_HTTP_UNAVAILABLE','GAS_JSON_INVALID','BOTH_VERIFIED','PARTIAL',
 'NO_DATED_OFFICIAL_CLOSE','NETWORK_OR_PARSE_FAILED',
 'NO_EXACT_COMPLETED_BAR','CHECKED','VERIFIED','HTTP_UNAVAILABLE',
 'ENDPOINT_INVALID','PAYLOAD_INVALID','NO_EXACT_VALID_ROWS',
 'NO_EXACT_VALID_ROW','PUBLISHED_PRIOR_SESSION','CONTENT_TYPE_INVALID',
 'GAS_EMPTY_ROWS','GAS_STATUS_ERROR','GAS_RESPONSE_SCHEMA',
 'KRX_NO_DATED_VKOSPI_POINT','KRX_KEY_NOT_CONFIGURED',
 'KRX_KEY_OR_INDEX_PERMISSION_DENIED','KRX_VKOSPI_BATCH_NETWORK_FAILURE',
 'NETWORK_OR_PARSE_FAILED'
]);

export function kstAuditSession(instant){
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{
  timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',
  hour:'2-digit',minute:'2-digit',hourCycle:'h23'
 }).formatToParts(instant).map(x=>[x.type,x.value]));
 const today=`${parts.year}-${parts.month}-${parts.day}`;
 const mins=Number(parts.hour)*60+Number(parts.minute);
 let date=today;
 if(mins<960||krxSessionStatus(today)!=='OPEN'){
   let cursor=Date.parse(today+'T00:00:00Z');
   date=null;
   for(let i=1;i<=14;i++){
     const candidate=new Date(cursor-i*86400000).toISOString().slice(0,10);
     if(krxSessionStatus(candidate)==='OPEN'){date=candidate;break;}
     if(krxSessionStatus(candidate)==='UNKNOWN')break;
   }
 }
 if(!date||krxSessionStatus(date)!=='OPEN')throw Error('BRIEFING_GAP_SESSION_UNVERIFIED');
 return {date,asOfKst:`${today} ${parts.hour}:${parts.minute}`,
  currentSession:date===today};
}
const safeDiagnostic=d=>{
 if(!d||!DIAGNOSTIC_KINDS.has(d.kind))return null;
 return {kind:d.kind,status:VALID_STATUSES.has(d.status)?d.status:'OTHER_UNVERIFIED',
  ...(d.kind==='FRED_TREASURY_READ'&&TREASURY_IDS.includes(d.id)?{id:d.id}:{}),
  checked:Array.isArray(d.verified)?d.verified.filter(x=>STOCK_IDS.includes(x)):[],
  stocks:Array.isArray(d.stocks)?d.stocks.filter(x=>STOCK_IDS.includes(x.id))
    .map(x=>({id:x.id,status:/^[A-Z_]+$/.test(x.status)?x.status:'UNKNOWN'})):[]};
};
export async function runClosingGapAudit({
 now=()=>new Date(),stocks=readClosingStockSources,
 turnover=readClosingKrxTurnoverFromGas,vkospi=readClosingVkospi,
 treasury=readTreasuryCurve,report=()=>{}
}={}){
 const instant=now();if(!(instant instanceof Date)||!Number.isFinite(instant.getTime()))
  throw Error('BRIEFING_GAP_CLOCK_UNVERIFIED');
 const session=kstAuditSession(instant),diagnostics=[];
 const listen=d=>{const clean=safeDiagnostic(d);if(clean)diagnostics.push(clean);};
 const calls=await Promise.allSettled([
  stocks(session.date,{now,onDiagnostic:listen}),
  turnover(session.date,{now,onDiagnostic:listen}),
  vkospi(session.date,{now,onDiagnostic:listen}),
  treasury(session.date,{onDiagnostic:listen})
 ]);
 const result=i=>calls[i].status==='fulfilled'&&Array.isArray(calls[i].value)
  ?calls[i].value:[];
 const observedStocks=result(0),observedTurnover=result(1),
  observedVkospi=result(2),observedTreasury=verifyTreasuryCurve(session.date,result(3));
 const stockRows=STOCK_IDS.map(id=>{
   const rows=observedStocks.filter(x=>x?.id===id&&SAFE_STOCK_SOURCES.has(x.source)
     &&validClosingStockReference(session.date,x));
   return {id,status:rows.length===1?'VERIFIED':'NO_VERIFIED_ROW',
    source:rows.length===1?rows[0].source:null};
 });
 const turnoverRows=TURNOVER_IDS.map(id=>({
  market:id,status:observedTurnover.some(x=>x.market===id)?'VERIFIED':'NO_VERIFIED_ROW'
 }));
 const rateRows=TREASURY_IDS.map(id=>({
  id,status:observedTreasury.some(x=>x.id===id)?'VERIFIED':'NO_VERIFIED_ROW'
 }));
 const summary={mode:'BRIEFING_MISSING_SOURCES_READ_ONLY',
  ...session,stockRows,turnoverRows,
  vkospiStatus:observedVkospi.some(x=>x.id==='VKOSPI')?'VERIFIED':'NO_VERIFIED_ROW',
  treasuryRows:rateRows,
  diagnostics:diagnostics.slice(0,14),
  failedSourceGroups:['STOCKS','TURNOVER','VKOSPI','TREASURY']
    .filter((_,i)=>calls[i].status==='rejected'),
  nonConnected:['FOREIGN_INSTITUTION_FLOW','INVESTOR_DEPOSITS','MARGIN_BALANCE'],
  completeness:'OPTIONAL_SOURCES_ONLY',
  financialWrites:0,telegramSends:0,gasDeployments:0};
 report(summary);
 return summary;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 if(!process.env.GAS_WEB_APP_URL||!process.env.GAS_ACCESS_TOKEN){
  console.error('BRIEFING_GAP_GAS_CREDENTIALS_UNAVAILABLE');process.exitCode=1;
 }else{
  try{
   await runClosingGapAudit({report:r=>console.log(JSON.stringify(r))});
  }catch{console.error('BRIEFING_GAP_AUDIT_UNVERIFIED');process.exitCode=1;}
 }
}
