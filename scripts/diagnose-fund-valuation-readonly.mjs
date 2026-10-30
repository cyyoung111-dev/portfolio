// Read-only, bounded inspection of persisted fund NAV, price history and Snapshot.
// The GAS endpoint computes status from stored rows; it does not write data.
// Never log GAS payloads, raw errors, URLs, access tokens, units or prices.
import {pathToFileURL} from 'node:url';
import {validateWebAppUrl} from './diagnose-krx-operational.mjs';

export const FUNDS=Object.freeze(['F00001','F00002','F00003']);
const NAV_STATES=new Set(['EXISTING_CONFIRMED','NON_PUBLICATION_CARRY','UNPUBLISHED','NAV_MISSING']);
const ROW_STATES=new Set(['EXISTING_VALID','NOT_REQUIRED','WRITE_REQUIRED','NOT_CREATED']);
const DATE=/^\d{4}-\d{2}-\d{2}$/;

function validDate(value) {
 if(typeof value!=='string'||!DATE.test(value))return false;
 const d=new Date(value+'T00:00:00Z');
 return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===value;
}
function shiftDate(value,days) {
 return new Date(Date.parse(value+'T00:00:00Z')+days*86400000).toISOString().slice(0,10);
}
export function summarizeFundRows(payload,code,from,to) {
 const r=payload?.fundResults?.[code], rows=r?.dates;
 if(payload?.status!=='ok'||r?.code!==code||!Array.isArray(rows)||rows.length>7)
   throw Error('FUND_AUDIT_BAD_RESPONSE');
 const seen=new Set();
 const summary={code,from,to,activeDays:0,confirmedNavDays:0,
   navMissingDates:[],unpublishedDates:[],evaluationPendingDates:[],snapshotPendingDates:[]};
 for(const row of rows) {
  if(row?.code!==code||!validDate(row.date)||row.date<from||row.date>to
      ||seen.has(row.date)||!NAV_STATES.has(row.navState)
      ||!ROW_STATES.has(row.evaluationState)||!ROW_STATES.has(row.snapshotState)
      ||typeof row.publicationExpected!=='boolean'||typeof row.unitsApplied!=='boolean'
      ||typeof row.valuationRequired!=='boolean'||row.reconciled!==true)
    throw Error('FUND_AUDIT_BAD_RESPONSE');
  seen.add(row.date);
  summary.activeDays++;
  if(row.navState==='EXISTING_CONFIRMED')summary.confirmedNavDays++;
  if(row.navState==='NAV_MISSING')summary.navMissingDates.push(row.date);
  if(row.navState==='UNPUBLISHED')summary.unpublishedDates.push(row.date);
  if(row.evaluationState==='WRITE_REQUIRED'||row.evaluationState==='NOT_CREATED')
    summary.evaluationPendingDates.push(row.date);
  if(row.snapshotState==='WRITE_REQUIRED'||row.snapshotState==='NOT_CREATED')
    summary.snapshotPendingDates.push(row.date);
 }
 for(const key of ['navMissingDates','unpublishedDates','evaluationPendingDates','snapshotPendingDates'])
   summary[key].sort();
 return summary;
}
export async function auditFundRows({url,token,now=new Date(),fetchImpl=fetch,emit=()=>{}}) {
 const endpoint=validateWebAppUrl(url);
 if(typeof token!=='string'||!token.trim())throw Error('FUND_AUDIT_TOKEN_MISSING');
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
 if(!validDate(today))throw Error('FUND_AUDIT_DATE_INVALID');
 const from=shiftDate(today,-6),to=today, summaries=[];
 for(const code of FUNDS) {
  let response, data;
  try {
   response=await fetchImpl(endpoint,{method:'POST',redirect:'follow',
     headers:{'content-type':'application/x-www-form-urlencoded;charset=UTF-8'},
     body:new URLSearchParams({action:'getFundValuationStatus',from,to,code,accessToken:token}),
     signal:AbortSignal.timeout(180000)});
  }catch{throw Error('FUND_AUDIT_NETWORK_UNVERIFIED');}
  if(!response?.ok)throw Error('FUND_AUDIT_HTTP_UNVERIFIED');
  try{data=await response.json();}catch{throw Error('FUND_AUDIT_JSON_UNVERIFIED');}
  const summary=summarizeFundRows(data,code,from,to);
  emit(summary);summaries.push(summary);
 }
 return summaries;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
 try{await auditFundRows({url:process.env.GAS_WEB_APP_URL,token:process.env.GAS_ACCESS_TOKEN,
   emit:summary=>console.log(JSON.stringify(summary))});}
 catch(error){const code=String(error?.message||'');
   console.error(/^FUND_AUDIT_[A-Z_]+$/.test(code)?code:'FUND_AUDIT_UNKNOWN');
   process.exitCode=1;
 }
}
