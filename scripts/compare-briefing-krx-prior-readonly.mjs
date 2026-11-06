// Read-only comparison of *exact* KRX current vs previous OPEN-session rows.
// It diagnoses publication lag versus a persistently unavailable provider,
// without inferring either from an empty response or writing any finance state.
import {pathToFileURL} from 'node:url';
import {krxSessionStatus} from './krx-session-calendar.mjs';
import {kstAuditSession} from './audit-briefing-source-gaps-readonly.mjs';
import {readKrxOfficialClosingStocks,validClosingStockReference}
 from './closing-extra-daily-sources.mjs';
import {readClosingKrxTurnoverFromGas,verifyOfficialKrxTurnover}
 from './closing-krx-turnover.mjs';
import {readClosingVkospi,verifyClosingVkospi}
 from './closing-vkospi-reference.mjs';

const STOCKS=['SAMSUNG','SKHYNIX'];
const MARKETS=['KOSPI','KOSDAQ'];
const SOURCE_REASONS=new Set([
 'BOTH_VERIFIED','PARTIAL','NO_DATED_OFFICIAL_CLOSE',
 'CONFIG_OR_SESSION_UNVERIFIED','ENDPOINT_INVALID',
 'HTTP_UNAVAILABLE','NETWORK_OR_PARSE_FAILED','GAS_RESPONSE_NOT_OK',
 'GAS_STATUS_ERROR','GAS_AUTH_REJECTED','GAS_RESPONSE_SCHEMA',
 'NO_EXACT_VALID_ROW','NO_EXACT_VALID_ROWS','GAS_EMPTY_ROWS',
 'PAYLOAD_INVALID','VERIFIED'
]);
export function previousOpenKrxDay(date){
 if(krxSessionStatus(date)!=='OPEN')return null;
 const ms=Date.parse(date+'T00:00:00Z');
 if(!Number.isFinite(ms))return null;
 for(let i=1;i<=14;i++){
  const candidate=new Date(ms-i*86400000).toISOString().slice(0,10);
  const status=krxSessionStatus(candidate);
  if(status==='OPEN')return candidate;
  if(status==='UNKNOWN')return null;
 }
 return null;
}
const safeReason=details=>SOURCE_REASONS.has(details?.status)
 ?details.status:'UNVERIFIED_REASON';
const resultStatus=(rows,date,group,id)=>{
 if(!Array.isArray(rows))return false;
 if(group==='stocks')return rows.filter(r=>r?.id===id
   &&r.source==='KRX_OFFICIAL'&&validClosingStockReference(date,r)).length===1;
 if(group==='turnover')return verifyOfficialKrxTurnover(date,rows)
   .filter(r=>r.market===id).length===1;
 if(group==='vkospi')return verifyClosingVkospi(date,rows).length===1;
 return false;
};
export async function compareKrxPriorSession({
 now=()=>new Date(),stocks=readKrxOfficialClosingStocks,
 turnover=readClosingKrxTurnoverFromGas,vkospi=readClosingVkospi,
 report=()=>{}
}={}){
 const asOf=now();
 if(!(asOf instanceof Date)||!Number.isFinite(asOf.getTime()))
  throw Error('KRX_COMPARISON_CLOCK');
 const current=kstAuditSession(asOf);
 if(!current.currentSession)throw Error('KRX_COMPARISON_BEFORE_CLOSE_WINDOW');
 const previous=previousOpenKrxDay(current.date);
 if(!previous)throw Error('KRX_COMPARISON_PREVIOUS_DATE_UNKNOWN');
 const dates=[current.date,previous],groups=['stocks','turnover','vkospi'];
 const diagnostics={};
 const calls=await Promise.allSettled(dates.flatMap(date=>groups.map(group=>{
  diagnostics[date+'/'+group]=[];
  const source={stocks,turnover,vkospi}[group];
  return source(date,{now,onDiagnostic:diag=>{
   diagnostics[date+'/'+group].push(safeReason(diag));
  }});
 })));
 const table={};
 let i=0;
 for(const date of dates){
  table[date]={};
  for(const group of groups){
   const result=calls[i++];
   table[date][group]={
    rows:result.status==='fulfilled'&&Array.isArray(result.value)?result.value:[],
    reason:result.status==='rejected'?'SOURCE_REJECTED'
      :diagnostics[date+'/'+group].at(-1)||'NO_DIAGNOSTIC'
   };
  }
 }
 const record=(group,id)=>{
  const today=resultStatus(table[current.date][group].rows,current.date,group,id);
  const prior=resultStatus(table[previous][group].rows,previous,group,id);
  return {group,id,current:today?'VERIFIED':'NO_VERIFIED_ROW',
   previous:prior?'VERIFIED':'NO_VERIFIED_ROW',
   currentReason:table[current.date][group].reason,
   previousReason:table[previous][group].reason,
   comparison:today?(prior?'BOTH_VERIFIED':'CURRENT_ONLY_VERIFIED')
     :(prior?'PREVIOUS_ONLY_VERIFIED':'BOTH_UNVERIFIED')};
 };
 const summary={mode:'KRX_EXACT_DATE_COMPARE_READ_ONLY',
  asOfKst:current.asOfKst,currentDate:current.date,previousDate:previous,
  results:[...STOCKS.map(id=>record('stocks',id)),
   ...MARKETS.map(id=>record('turnover',id)),record('vkospi','VKOSPI')],
  conclusion:'SOURCE_AVAILABILITY_ONLY_NOT_PUBLICATION_PROOF',
  financialWrites:0,telegramSends:0,gasDeployments:0};
 report(summary);
 return summary;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 if(!process.env.GAS_WEB_APP_URL||!process.env.GAS_ACCESS_TOKEN){
  console.error('KRX_COMPARISON_GAS_CREDENTIALS_UNAVAILABLE');
  process.exitCode=1;
 }else{
  try{await compareKrxPriorSession({report:x=>console.log(JSON.stringify(x))});}
  catch{console.error('KRX_COMPARISON_UNVERIFIED');process.exitCode=1;}
 }
}
