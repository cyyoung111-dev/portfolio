// Isolated public SEC/DART evidence prefetch for the next 07:40/17:00 briefings.
// ONLY an authenticated main/schedule action may write its own Actions artifact.
// No Telegram, GAS, Sheets, portfolio positions, or other financial ledgers.
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {krxSessionStatus} from './krx-session-calendar.mjs';
import {expectedMorningDate} from './telegram-morning-report.mjs';
import {collectAiFinancialEvidence} from './collect-ai-financial-evidence-readonly.mjs';
import {formatAiFinancialEvidence} from './briefing-financial-evidence.mjs';

export const FINANCIAL_PREFETCH_WORKFLOW='AI financial evidence prefetch (read-only)';
export const FINANCIAL_PREFETCH_PATH='.github/workflows/ai-financial-evidence-prefetch.yml';
export const FINANCIAL_PREFETCH_REPO='cyyoung111-dev/portfolio';
export const FINANCIAL_PREFETCH_FILE='financial-evidence.json';
const DAY=/^\d{4}-\d{2}-\d{2}$/;
const strictDay=d=>typeof d==='string'&&DAY.test(d)
 &&Number.isFinite(Date.parse(d+'T00:00:00Z'))
 &&new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d;
const numeric=n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<1e16;
const positive=n=>numeric(n)&&n>0;
const dt=n=>new Date(n);
export function financialPrefetchWindow(instant){
 if(!(instant instanceof Date)||!Number.isFinite(instant.getTime()))
  return {allowed:false,date:null,status:'CLOCK_INVALID'};
 const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{
  timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',
  hour:'2-digit',minute:'2-digit',hourCycle:'h23'
 }).formatToParts(instant).map(x=>[x.type,x.value]));
 const date=p.year+'-'+p.month+'-'+p.day;
 const minute=Number(p.hour)*60+Number(p.minute);
 return {date,allowed:minute>=375&&minute<445,
  status:minute>=375&&minute<445?'IN_WINDOW':'OUTSIDE_PREFETCH_WINDOW'};
}

// This schema includes only PUBLIC financial issuer facts, not source tokens.
// Optional missing facts are preserved as null; never backfill them from prior days.
export function verifyFinancialPrefetchArtifact(date,payload,{now=new Date(),
 expectedUsDate=expectedMorningDate('SPX',date)}={}){
 if(!strictDay(date)||!strictDay(expectedUsDate)
  ||!(now instanceof Date)||!Number.isFinite(now.getTime())
  ||!payload||typeof payload!=='object'||Array.isArray(payload)
  ||payload.schemaVersion!==1||payload.date!==date
  ||payload.source!=='SEC_DART_PUBLIC_READ_ONLY'
  ||payload.repository!==FINANCIAL_PREFETCH_REPO
  ||!strictDay(payload.evidence?.asOfKst)
  ||payload.evidence.asOfKst!==date
  ||payload.evidence.usSessionDate!==expectedUsDate
  ||payload.evidence.domesticSessionDate!==null
  ||payload.evidence.kind!=='AI_FINANCIAL_EVIDENCE_READ_ONLY')
  return null;
 const captured=Date.parse(payload.capturedAt);
 const lower=Date.parse(date+'T06:15:00+09:00');
 const upper=Date.parse(date+'T07:25:00+09:00');
 if(!Number.isFinite(captured)||captured<lower||captured>=upper
  ||captured>now.getTime()
  ||now.getTime()>=Date.parse(date+'T18:01:00+09:00'))
  return null;
 const e=payload.evidence;
 const us=['MSFT','AAPL','GOOGL','AMZN','META','NVDA','MU','ORCL','SNDK'];
 const kr=['005930','000660'];
 if(!Array.isArray(e.items)||e.items.length!==9
  ||!Array.isArray(e.domestic)||e.domestic.length!==2
  ||e.items.some((r,i)=>r?.symbol!==us[i])
  ||e.domestic.some((r,i)=>r?.symbol!==kr[i]
    ||typeof r.name!=='string'||r.name.length>24)
  ||!e.coverage
  ||!['ttm','fyOnly','referencePbr','domestic'].every(k=>
    Number.isInteger(e.coverage[k])&&e.coverage[k]>=0
    &&e.coverage[k]<=(k==='domestic'?2:9)))
  return null;
 const real={ttm:0,fyOnly:0,referencePbr:0,domestic:0};
 for(const r of e.items){
  if(r.ttm!==null){
   const v=r.ttm;
   if(!v||!['TTM','FY'].includes(v.basis)||!strictDay(v.period)
    ||v.period>date||!numeric(v.fcfUsd)
    ||!numeric(v.ocfUsd)||!numeric(v.capexUsd)||v.capexUsd<0
    ||Math.abs(v.fcfUsd-(v.ocfUsd-v.capexUsd))
      >Math.max(1,Math.abs(v.fcfUsd)*1e-8)
    ||v.capexToOcfPercent!==null
      &&(!positive(v.ocfUsd)||!numeric(v.capexToOcfPercent)
       ||Math.abs(v.capexToOcfPercent-100*v.capexUsd/v.ocfUsd)>0.01))
    return null;
   real[v.basis==='TTM'?'ttm':'fyOnly']++;
  }
  if(r.value!==null){
   const v=r.value;
   if(!v||!strictDay(v.period)||!strictDay(v.filingDate)
    ||v.period>v.filingDate||v.filingDate>expectedUsDate
    ||v.priceDate!==expectedUsDate||!positive(v.bpsUsd)
    ||!positive(v.pbrTimes)
    ||v.note!=='FY_BPS_YAHOO_PRICE_REFERENCE_SPLIT_ADJUSTED_NOT_CURRENT_QUARTER')
    return null;
   real.referencePbr++;
  }
 }
 for(const r of e.domestic){
  const v=r.evidence;
  if(v===null)continue;
  if(!v||!strictDay(v.period)||!strictDay(v.filingDate)
   ||v.period>v.filingDate||v.filingDate>date
   ||!positive(v.bpsKrw)
   ||!['VERIFIED_SINGLECLASS_BPS','INDICATIVE_MULTICLASS_BPS'].includes(v.status)
   ||v.indicative!==(v.status==='INDICATIVE_MULTICLASS_BPS')
   ||v.pbrTimes!==null||v.priceDate!==null)
   return null;
  real.domestic++;
 }
 if(!Object.keys(real).every(k=>real[k]===e.coverage[k])
  ||real.ttm+real.fyOnly+real.referencePbr+real.domestic===0
  ||formatAiFinancialEvidence(e).length===0)return null;
 return e;
}

export async function prefetchAiFinancialEvidence({
 now=()=>new Date(),collector=collectAiFinancialEvidence
}={}){
 const first=financialPrefetchWindow(now());
 if(!first.allowed)return {ready:false,status:first.status,date:first.date};
 if(krxSessionStatus(first.date)!=='OPEN')
  return {ready:false,status:'MARKET_NOT_OPEN',date:first.date};
 const expectedUsDate=expectedMorningDate('SPX',first.date);
 if(!strictDay(expectedUsDate))return {
  ready:false,status:'US_COMPLETED_DAY_UNVERIFIED',date:first.date};
 let evidence;
 try{
  evidence=await collector({now,usSessionDate:expectedUsDate,
   domesticSessionDate:null,domesticQuotes:[]});
 }catch{return {ready:false,status:'PUBLIC_SOURCE_UNAVAILABLE',date:first.date};}
 const last=financialPrefetchWindow(now());
 if(!last.allowed||last.date!==first.date)return {
  ready:false,status:'PREFETCH_TOO_LATE',date:first.date};
 const payload={schemaVersion:1,date:first.date,
  capturedAt:now().toISOString(),source:'SEC_DART_PUBLIC_READ_ONLY',
  repository:FINANCIAL_PREFETCH_REPO,evidence};
 const checked=verifyFinancialPrefetchArtifact(first.date,payload,{now:now(),
  expectedUsDate});
 if(!checked)return {ready:false,status:'PUBLIC_EVIDENCE_UNVERIFIED',date:first.date};
 return {ready:true,status:'PREFETCH_VERIFIED',date:first.date,
  artifactName:'ai-financial-evidence-'+first.date,
  data:payload,coverage:checked.coverage};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  if(process.env.GITHUB_REPOSITORY!==FINANCIAL_PREFETCH_REPO
   ||process.env.GITHUB_REF!=='refs/heads/main'
   ||process.env.GITHUB_EVENT_NAME!=='schedule'
   ||process.env.GITHUB_RUN_ATTEMPT!=='1'
   ||!process.env.GITHUB_OUTPUT)
   throw Error('FINANCIAL_PREFETCH_ACTION_UNAUTHORIZED');
  const result=await prefetchAiFinancialEvidence();
  if(result.ready){
   fs.mkdirSync('.ai-financial-evidence',{recursive:true});
   fs.writeFileSync('.ai-financial-evidence/'+FINANCIAL_PREFETCH_FILE,
    JSON.stringify(result.data),{flag:'wx',mode:0o600});
  }
  fs.appendFileSync(process.env.GITHUB_OUTPUT,
   'ready='+result.ready+'\nartifact_name='+(result.artifactName||'')+'\n');
  // Restrict console output to coverage counts; no raw filings, amounts,
  // prices, API tokens, account information, or individual source requests.
  console.log(JSON.stringify({kind:'FINANCIAL_PREFETCH_STATUS',
   status:result.status,date:result.date,coverage:result.coverage??null,
   financialWrites:0,telegramSends:0,gasDeployments:0}));
 }catch{console.error('FINANCIAL_PREFETCH_FAILED');process.exitCode=1;}
}
