import {pathToFileURL} from 'node:url';
import {DART_SEMICONDUCTORS,readTwoDomesticDartBps} from './briefing-dart-semiconductor-sources.mjs';

// The only user-visible output is coverage status. Never reveal the
// API query string, tokens, account rows, capital, shares or prices.
const allowed=new Set([
 'DART_KEY_NOT_CONFIGURED','DART_KEY_REJECTED','DART_RATE_LIMITED',
 'DART_HTTP_UNAVAILABLE','DART_FETCH_FAILED','NO_PUBLISHED_REPORT',
 'DART_SCHEMA_UNVERIFIED','DART_IDENTITY_MISMATCH',
 'DART_PERIOD_OR_FILING_UNVERIFIED','DART_PARENT_EQUITY_UNVERIFIED',
 'DART_SHARES_PERIOD_UNVERIFIED','DART_SHARE_CLASSES_UNVERIFIED',
 'DART_SHARE_TOTAL_MISMATCH','DART_BPS_ARITHMETIC_INVALID',
 'INDICATIVE_MULTICLASS_BPS','VERIFIED_SINGLECLASS_BPS'
]);
// Do not expose raw share counts, issuer capital or invalid field contents.
// The optional detail is selected from a fixed set of arithmetic diagnoses.
const shareDetails=new Set([
 'COMMON_FIELD_NON_NUMERIC','COMMON_SHARE_RANGE_INVALID',
 'COMMON_SHARE_ARITHMETIC_MISMATCH','COMMON_NONPOSITIVE_SHARES',
 'PREFERRED_FIELD_NON_NUMERIC','PREFERRED_SHARE_RANGE_INVALID',
 'PREFERRED_SHARE_ARITHMETIC_MISMATCH',
 'TOTAL_FIELD_NON_NUMERIC','TOTAL_SHARE_RANGE_INVALID',
 'TOTAL_SHARE_ARITHMETIC_MISMATCH','TOTAL_NONPOSITIVE_SHARES',
 'CLASS_TOTAL_OUTSTANDING_MISMATCH','UNKNOWN_STOCK_FIELD'
]);
export async function auditDartDomesticBps({reader=readTwoDomesticDartBps}={}){
 const raw=await reader();
 const statuses=DART_SEMICONDUCTORS.map(item=>{
  const hits=Array.isArray(raw.statuses)
   ?raw.statuses.filter(x=>x.symbol===item.symbol):[];
  const status=hits.length===1&&allowed.has(hits[0].status)
   ?hits[0].status:'UNVERIFIED';
  const report=Array.isArray(raw.rows)
   ?raw.rows.filter(r=>r.symbol===item.symbol):[];
  return {symbol:item.symbol,status,
   ...(status==='DART_SHARE_TOTAL_MISMATCH'
    &&shareDetails.has(hits[0]?.detail)?{detail:hits[0].detail}:{}),
   filedPeriod:report.length===1?report[0].period:null};
 });
 return {mode:'DART_DOMESTIC_SEMICONDUCTOR_READ_ONLY',
  total:2,verified:statuses.filter(x=>x.status==='VERIFIED_SINGLECLASS_BPS').length,
  indicative:statuses.filter(x=>x.status==='INDICATIVE_MULTICLASS_BPS').length,
  statuses,portfolioWrites:0,telegramSends:0,gasDeployments:0};
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
 try{console.log(JSON.stringify(await auditDartDomesticBps()));}
 catch{console.error('DART_BPS_AUDIT_UNVERIFIED');process.exitCode=1;}
}
