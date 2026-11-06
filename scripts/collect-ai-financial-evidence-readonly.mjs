// Explicit read-only collector. Never imported by punctual Telegram renderers.
// SEC requests are sequential to limit load; run in a separate prefetch job.
import {readAiNineTtmSecFacts} from './briefing-ai-nine-sec-ttm.mjs';
import {readAiNineAnnualValueSnapshots} from './briefing-ai-nine-sec-values.mjs';
import {readTwoDomesticDartBps} from './briefing-dart-semiconductor-sources.mjs';
import {buildAiFinancialEvidence} from './briefing-financial-evidence.mjs';

export async function collectAiFinancialEvidence({
 now=()=>new Date(),readTtm=readAiNineTtmSecFacts,
 readValues=readAiNineAnnualValueSnapshots,
 readDart=readTwoDomesticDartBps,usSessionDate,domesticQuotes=[]
}={}){
 const instant=now();
 if(!(instant instanceof Date)||!Number.isFinite(instant.getTime()))
  throw Error('FINANCIAL_EVIDENCE_CLOCK_INVALID');
 const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',
  year:'numeric',month:'2-digit',day:'2-digit'}).format(instant);
 const ttm=await readTtm({now});
 const fyValues=await readValues({now});
 const dart=await readDart({now});
 return buildAiFinancialEvidence({
  asOfKst:date,usSessionDate,ttm,fyValues,dart,domesticQuotes});
}
