import {pathToFileURL} from 'node:url';
import {AI_NINE,readAiNineDailyPrices,readAiNineSecFilings} from './briefing-ai-nine-sources.mjs';
import {readAiNineAnnualSecFacts} from './briefing-ai-nine-sec-financials.mjs';

// Read-only operational coverage probe for the existing issue #826.
// Only enum statuses and provenance dates leave this process: never emit
// securities prices, portfolio rows, SEC financial facts, tokens or UA.
const ALLOWED=new Set([
 'VERIFIED','NO_EXACT_COMPLETED_US_BAR','US_CLOSE_UNVERIFIED',
 'SEC_USER_AGENT_NOT_CONFIGURED','SEC_HTTP_UNAVAILABLE',
 'SEC_CONTENT_TYPE_INVALID','SEC_FILING_SCHEMA_OR_DATE_INVALID','FETCH_FAILED',
 'SEC_BODY_TOO_LARGE','NO_SAME_FILING_ANNUAL_FACTS'
]);
const nowKstDay=now=>new Intl.DateTimeFormat('en-CA',{
 timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'
}).format(now);
const trustedStatus=s=>ALLOWED.has(s)?s:'UNVERIFIED';
const byUniverse=(raw)=>AI_NINE.map(item=>{
 const matches=Array.isArray(raw)?raw.filter(x=>x?.symbol===item.symbol):[];
 return {symbol:item.symbol,status:matches.length===1
  ?trustedStatus(matches[0]?.status):'UNVERIFIED'};
});

export async function runAiNineSourceAudit({
 now=()=>new Date(),readPrices=readAiNineDailyPrices,
 readFilings=readAiNineSecFilings,readAnnualFacts=readAiNineAnnualSecFacts
}={}){
 const instant=now();
 if(!(instant instanceof Date)||!Number.isFinite(instant.getTime()))
  throw Error('AI9_AUDIT_CLOCK_INVALID');
 const date=nowKstDay(instant);
 const outcomes=await Promise.allSettled([
  readPrices(date,{now}),
  readFilings({now})
 ]);
 // SEC submissions and companyfacts execute sequentially, not as an
 // 18-request burst against the SEC public fair-access rate limit.
 const financialOutcome=await Promise.allSettled([readAnnualFacts({now})]);
 const annual=financialOutcome[0].status==='fulfilled'?financialOutcome[0].value:{};
 const prices=outcomes[0].status==='fulfilled'?outcomes[0].value:{};
 const filings=outcomes[1].status==='fulfilled'?outcomes[1].value:{};
 const priceStatuses=byUniverse(prices.statuses);
 const secStatuses=byUniverse(filings.statuses);
 const annualStatuses=byUniverse(annual.statuses);
 return {
  mode:'AI9_SOURCE_AUDIT_READ_ONLY',dateKst:date,
  usSessionDate:typeof prices.expectedUsDate==='string'
   &&/^\d{4}-\d{2}-\d{2}$/.test(prices.expectedUsDate)
    ?prices.expectedUsDate:null,
  price:{verified:priceStatuses.filter(x=>x.status==='VERIFIED').length,total:9,
   statuses:priceStatuses},
  sec:{verified:secStatuses.filter(x=>x.status==='VERIFIED').length,total:9,
   statuses:secStatuses},
  annualFinancials:{verified:annualStatuses.filter(x=>x.status==='VERIFIED').length,
   total:9,statuses:annualStatuses},
  portfolioWrites:0,telegramSends:0,gasDeployments:0
 };
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
 try{console.log(JSON.stringify(await runAiNineSourceAudit()));}
 catch{console.error('AI9_AUDIT_UNVERIFIED');process.exitCode=1;}
}
