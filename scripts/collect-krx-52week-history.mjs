// Incremental, bounded source-only KRX OHLC archive builder.
// Reads public KRX stock daily data with a pre-existing KRX key, writes ONLY
// a local GitHub Actions artifact. No GAS, portfolio, Telegram or repo writes.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {MARKETS,SOURCE,WINDOW,expectedSessions,completedSession,
 parseOfficialStockDay,verifyArchive,appendArchive,countNewHighsAndLows,
 audit52WeekRawDiscontinuity,updateSummary} from './krx-52week-market.mjs';

const AUTH=/^[A-Za-z0-9_-]{16,128}$/;
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const boundedInt=(n,min,max)=>Number.isInteger(n)&&n>=min&&n<=max;
export async function fetchOfficialMarketPair(date,{
 key=process.env.KRX_AUTH_KEY,fetchImpl=fetch
}={}){
 if(typeof key!=='string'||!AUTH.test(key))throw Error('KRX52_KEY_UNAVAILABLE');
 const markets={},statuses={};
 // Sequential market requests and date-scoped admission avoid a burst of
 // ~500 parallel requests and limit an API outage to a small failing batch.
 for(const [market,info] of Object.entries(MARKETS)){
  const url=new URL('https://data-dbg.krx.co.kr'+info.path);
  url.searchParams.set('basDd',date.replaceAll('-',''));
  let response;
  try{
   response=await fetchImpl(url.href,{method:'GET',
    headers:{AUTH_KEY:key,accept:'application/json'},
    redirect:'error',signal:AbortSignal.timeout(12000)});
  }catch{statuses[market]='NETWORK_OR_TIMEOUT';continue;}
  if(!response?.ok){
   statuses[market]=[401,403].includes(Number(response?.status))?'PERMISSION_DENIED'
    :Number(response?.status)===429?'THROTTLED':'HTTP_UNAVAILABLE';
   continue;
  }
  const size=Number(response.headers?.get?.('content-length')||0);
  if(size>4500000){statuses[market]='PAYLOAD_TOO_LARGE';continue;}
  try{
   const parsed=parseOfficialStockDay(date,market,await response.json());
   markets[market]=parsed;statuses[market]='VERIFIED';
  }catch{statuses[market]='SCHEMA_OR_DATE_UNVERIFIED';}
 }
 return {pair:Object.keys(markets).length===2?{date,markets}:null,statuses};
}
export async function collectHistory({
 now=new Date(),key=process.env.KRX_AUTH_KEY,maxDates=16,
 initial=null,fetchImpl=fetch,log=()=>{},pause=delay
}={}){
 if(typeof key!=='string'||!AUTH.test(key))throw Error('KRX52_KEY_UNAVAILABLE');
 if(!boundedInt(maxDates,1,60))throw Error('KRX52_BATCH_LIMIT');
 const target=completedSession(now),expected=expectedSessions(target);
 let archive=appendArchive(verifyArchive(initial),expected,null);
 const stored=new Set(archive.sessions.map(s=>s.date));
 const pending=[...expected].reverse().filter(d=>!stored.has(d));
 const attempted=[];
 // Newest first: a partial bootstrap remains reusable across daily runs.
 for(const date of pending.slice(0,maxDates)){
  const {pair,statuses}=await fetchOfficialMarketPair(date,{key,fetchImpl});
  attempted.push({date,KOSPI:statuses.KOSPI,KOSDAQ:statuses.KOSDAQ,
   saved:Boolean(pair)});
  if(pair)archive=appendArchive(archive,expected,pair);
  if(Object.values(statuses).includes('PERMISSION_DENIED')||
    Object.values(statuses).includes('THROTTLED'))break;
  await pause(350);
 }
 const counts=countNewHighsAndLows(archive,expected);
 // A 252/252 data proof is not a corporate-action-adjusted market indicator.
 // Emit an independent source-only quality audit before any integration.
 const quality=audit52WeekRawDiscontinuity(archive,expected,counts);
 archive=updateSummary(archive,counts);
 const report={kind:'KRX_52W_OHLC_SOURCE_ONLY',date:target,
  // A release-eligible *dated* T+1 market session, not an intraday close.
  // Explicit boundaries make an exact 252-session proof independently auditable.
  officialPublicationPolicy:'NEXT_KRX_OPEN_AFTER_0815_KST',
  windowStart:expected[0],windowEnd:expected.at(-1),
  requiredSessions:WINDOW,storedSessions:archive.sessions.length,
  attemptedDates:attempted.length,addedDates:attempted.filter(x=>x.saved).length,
  sourceCoverage:counts.status,officialRawOhlc:true,
  splitAdjusted:false,portfolioWrites:0,gasWrites:0,telegramSends:0,
  // Fixed source-status enums and public market dates only. Keep prices,
  // raw API payloads, response text and credential values out of logs.
  attemptedResults:attempted.map(x=>({date:x.date,KOSPI:x.KOSPI,
   KOSDAQ:x.KOSDAQ,saved:x.saved})),
  // Counts are NOT output before all 252 sessions and both market sources
  // independently validate; short-history securities stay excluded.
  ...(counts.status==='VERIFIED_RAW_UNADJUSTED_REFERENCE'
   ?{markets:counts.markets,quality}:{})};
 log(report);
 return {archive,counts,quality,report,attempted};
}
export function readArchiveFile(input){
 if(!input||!fs.existsSync(input))return null;
 const stat=fs.statSync(input);
 if(!stat.isFile()||stat.size>100000000)throw Error('KRX52_ARCHIVE_SIZE_UNVERIFIED');
 return verifyArchive(JSON.parse(fs.readFileSync(input,'utf8')));
}
export async function runCli(args=process.argv.slice(2),{
 now=new Date(),fetchImpl=fetch,key=process.env.KRX_AUTH_KEY
}={}){
 const opts={maxDates:16,input:'',output:'.krx-52week/history.json',
  summary:'.krx-52week/summary.json'};
 for(const arg of args){
  const match=/^--(max-dates|input|output|summary)=(.+)$/.exec(arg);
  if(!match)throw Error('KRX52_ARGUMENT_UNVERIFIED');
  const name=match[1]==='max-dates'?'maxDates':match[1];
  opts[name]=name==='maxDates'?Number(match[2]):match[2];
 }
 if(!boundedInt(opts.maxDates,1,60))throw Error('KRX52_BATCH_LIMIT');
 const initial=readArchiveFile(opts.input);
 const out=await collectHistory({now,key,maxDates:opts.maxDates,
  initial,fetchImpl,log:r=>console.log(JSON.stringify(r))});
 // Failed KRX credentials or network must never overwrite a previous
 // trustworthy artifact with an empty / truncated rebuilt history.
 if(out.report.addedDates===0&&out.report.storedSessions<WINDOW &&
   out.report.attemptedDates>0)throw Error('KRX52_NO_PROGRESS');
 for(const file of [opts.output,opts.summary]){
  fs.mkdirSync(path.dirname(file),{recursive:true});
 }
 fs.writeFileSync(opts.output,JSON.stringify(out.archive),'utf8');
 fs.writeFileSync(opts.summary,JSON.stringify({
  ...out.report,
  counts:out.counts.status==='VERIFIED_RAW_UNADJUSTED_REFERENCE'
   ?out.counts:null
 },null,2),'utf8');
 return out;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{await runCli();}
 catch(e){
  const code=/^KRX52_[A-Z_0-9]+$/.test(e?.message||'')
   ?e.message:'KRX52_SOURCE_UNVERIFIED';
  console.error(code);process.exitCode=1;
 }
}
