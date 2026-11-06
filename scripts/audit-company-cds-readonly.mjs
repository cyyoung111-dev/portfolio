import {pathToFileURL} from 'node:url';
import {buildCompanyCdsCoverage} from './briefing-company-cds-sources.mjs';

// Intentional read-only source readiness report. Neither public ICE EOD clean
// prices nor DTCC coupon/upfront records can masquerade as a CDS spread.
export function auditCompanyCdsReadiness(options={}){
 const raw=buildCompanyCdsCoverage(options);
 return {mode:'COMPANY_CDS_SOURCE_CONTRACT_READ_ONLY',
  total:raw.total,verifiedQuotes:raw.verifiedQuotes,
  verifiedTradeReports:raw.verifiedTradeReports,
  statuses:raw.statuses.map(({symbol,country,status})=>({symbol,country,status})),
  valuesEmitted:0,portfolioWrites:0,telegramSends:0,gasDeployments:0};
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
 console.log(JSON.stringify(auditCompanyCdsReadiness()));
}
