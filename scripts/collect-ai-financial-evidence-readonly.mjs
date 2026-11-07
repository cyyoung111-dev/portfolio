// Explicit read-only collector. Never imported by punctual Telegram renderers.
// SEC requests are sequential to limit load; run in a separate prefetch job.
import {readAiNineTtmSecFacts} from './briefing-ai-nine-sec-ttm.mjs';
import {readAiNineAnnualValueSnapshots} from './briefing-ai-nine-sec-values.mjs';
import {readTwoDomesticDartBps} from './briefing-dart-semiconductor-sources.mjs';
import {buildAiFinancialEvidence} from './briefing-financial-evidence.mjs';
import {financialSourceCoverageStatus}
 from './briefing-financial-source-status.mjs';

export async function collectAiFinancialEvidence({
 now=()=>new Date(),readTtm=readAiNineTtmSecFacts,
 readValues=readAiNineAnnualValueSnapshots,
 readDart=readTwoDomesticDartBps,usSessionDate,
 domesticSessionDate=null,domesticQuotes=[],onSourceStatus=()=>{}
}={}){
 const instant=now();
 if(!(instant instanceof Date)||!Number.isFinite(instant.getTime()))
  throw Error('FINANCIAL_EVIDENCE_CLOCK_INVALID');
 const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',
  year:'numeric',month:'2-digit',day:'2-digit'}).format(instant);
 // DART BPS is the first independently validated input. A partial SEC
 // outage must never prevent these already-verified Korean company facts
 // from reaching the scheduled 06:20 evidence artifact.
 // SEC collectors remain sequential to respect public-source fair access.
 // Every source has an independent fail-closed boundary; no stale fallback.
 let dart={},ttm={},fyValues={};
 try{dart=await readDart({now});}catch{}
 try{ttm=await readTtm({now});}catch{}
 try{fyValues=await readValues({now});}catch{}
 // Nonblocking, status-only diagnostics are out-of-band: artifact unchanged.
 try{onSourceStatus(financialSourceCoverageStatus({ttm,fy:fyValues,dart}));}catch{}
 return buildAiFinancialEvidence({
  asOfKst:date,usSessionDate,domesticSessionDate,ttm,fyValues,dart,domesticQuotes});
}
