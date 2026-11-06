import {pathToFileURL} from 'node:url';
import {AI_NINE} from './briefing-ai-nine-sources.mjs';
import {readAiNineTtmSecFacts} from './briefing-ai-nine-sec-ttm.mjs';

// Strictly status-only SEC official XBRL read-only audit; do not print
// financial values, User-Agent/contact info, account data, or SEC payloads.
export async function runAiNineTtmAudit({reader=readAiNineTtmSecFacts}={}){
 const raw=await reader();
 const trusted=new Set(['VERIFIED_TTM','PARTIAL_TTM','FY_ONLY',
  'NO_REPORTED_ANNUAL_ANCHOR','QUARTER_ANCHOR_CONFLICT','SEC_USER_AGENT_NOT_CONFIGURED',
  'SEC_HTTP_UNAVAILABLE','SEC_CONTENT_TYPE_INVALID',
  'SEC_BODY_TOO_LARGE','FETCH_FAILED']);
 const rows=AI_NINE.map(x=>{
  const matches=Array.isArray(raw.statuses)
   ?raw.statuses.filter(r=>r.symbol===x.symbol):[];
  const status=matches.length===1&&trusted.has(matches[0].status)
   ?matches[0].status:'UNVERIFIED';
  const report=Array.isArray(raw.reports)
   ?raw.reports.find(r=>r.symbol===x.symbol):null;
  const missing=Array.isArray(report?.missing)
   ?report.missing.filter(k=>['revenue','operatingIncome','netIncome',
    'operatingCashFlow','capex'].includes(k)):[];
  return {symbol:x.symbol,status,missing};
 });
 const count=status=>rows.filter(r=>r.status===status).length;
 return {mode:'AI9_SEC_TTM_READ_ONLY',
  verifiedTtm:count('VERIFIED_TTM'),fiscalYearOnly:count('FY_ONLY'),
  partialTtm:count('PARTIAL_TTM'),total:AI_NINE.length,statuses:rows,
  portfolioWrites:0,telegramSends:0,gasDeployments:0};
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
 try{console.log(JSON.stringify(await runAiNineTtmAudit()));}
 catch{console.error('AI9_TTM_AUDIT_UNVERIFIED');process.exitCode=1;}
}
