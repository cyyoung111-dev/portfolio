// Explicit read-only collector. Never imported by punctual Telegram renderers.
// SEC requests are sequential to limit load; run in a separate prefetch job.
import {readAiNineTtmSecFacts} from './briefing-ai-nine-sec-ttm.mjs';
import {readAiNineAnnualValueSnapshots} from './briefing-ai-nine-sec-values.mjs';
import {readTwoDomesticDartBps} from './briefing-dart-semiconductor-sources.mjs';
import {buildAiFinancialEvidence} from './briefing-financial-evidence.mjs';
import {financialSourceCoverageStatus}
 from './briefing-financial-source-status.mjs';
import {sharedSecCompanyFactsFetch} from './shared-sec-companyfacts-prefetch.mjs';

// Exactly one independent second SEC FY-value read may recover transient
// completed US daily quote/split-history provider gaps. SEC filings are
// memoized only inside this one prefetch invocation. Never merge different
// snapshots, claim FY=BPS TTM, invent quotes, or make a financial write.
const PBR_RETRYABLE=new Set(['QUOTE_UNVERIFIED','SPLIT_HISTORY_UNVERIFIED']);
const verifiedValueCount=source=>{
 const snapshots=Array.isArray(source?.snapshots)?source.snapshots:[];
 const statuses=Array.isArray(source?.statuses)?source.statuses:[];
 return statuses.filter(x=>x?.status==='VERIFIED_FY_BPS_PBR'
  &&statuses.filter(y=>y?.symbol===x.symbol).length===1
  &&snapshots.filter(v=>v?.symbol===x.symbol).length===1
  &&snapshots.some(v=>v?.symbol===x.symbol
   &&v.source==='SEC_10K_US_GAAP'
   &&v.priceSource==='YAHOO_DAILY_REFERENCE'
   &&Number.isFinite(v.pbrTimes)&&v.pbrTimes>0)).length;
};
const hasTransientPbrGap=source=>
 Array.isArray(source?.snapshots)
 &&source.snapshots.some(x=>PBR_RETRYABLE.has(x?.pbrUnavailableReason));


export async function collectAiFinancialEvidence({
 now=()=>new Date(),readTtm=readAiNineTtmSecFacts,
 readValues=readAiNineAnnualValueSnapshots,
 readDart=readTwoDomesticDartBps,usSessionDate,fetchImpl=fetch,
 domesticSessionDate=null,domesticQuotes=[],onSourceStatus=()=>{},
 retryDelay=ms=>new Promise(resolve=>setTimeout(resolve,ms))
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
 const sharedFetch=sharedSecCompanyFactsFetch(fetchImpl);
 try{dart=await readDart({now});}catch{}
 try{ttm=await readTtm({now,fetchImpl:sharedFetch});}catch{}
 try{fyValues=await readValues({now,fetchImpl:sharedFetch});}catch{}
 // One retry is warranted ONLY for a public same-session price/split proof
 // unavailable on an otherwise parsed FY filing, not missing SEC/DART facts.
 // Selecting the better *entire* read keeps provenance within each attempt.
 if(hasTransientPbrGap(fyValues)){
  try{
   await retryDelay(2000);
   const retry=await readValues({now,fetchImpl:sharedFetch});
   if(verifiedValueCount(retry)>verifiedValueCount(fyValues))
    fyValues=retry;
  }catch{/* Keep the first verified read; never replace it with an error. */}
 }
 // Nonblocking, status-only diagnostics are out-of-band: artifact unchanged.
 try{onSourceStatus(financialSourceCoverageStatus({ttm,fy:fyValues,dart}));}catch{}
 return buildAiFinancialEvidence({
  asOfKst:date,usSessionDate,domesticSessionDate,ttm,fyValues,dart,domesticQuotes});
}
