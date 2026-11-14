// Issue #734 - KRX official stock basic-info listing-date audit, READ ONLY.
// Never reconstruct high/low or alter 52-week raw counts. No persistence of
// licensed metadata, names, ISINs, stock OHLC, keys, or account information.
import {pathToFileURL} from 'node:url';
import {readArchiveFile} from './collect-krx-52week-history.mjs';
import {MARKETS,WINDOW,verifyArchive,expectedSessions,
 countNewHighsAndLows,audit52WeekHistoryEligibility,completedSession}
 from './krx-52week-market.mjs';

export const KRX_BASE_INFO_PATHS=Object.freeze({
 KOSPI:'/svc/apis/sto/stk_isu_base_info',
 KOSDAQ:'/svc/apis/sto/ksq_isu_base_info'
});
const KEY=/^[A-Za-z0-9_-]{16,128}$/;
const CODE=/^[0-9]{6}$/;
const ISIN=/^[A-Z0-9]{12}$/;
function fail(reason){throw Error('KRX52_LISTING_'+reason);}
function toDate(value){
 if(typeof value!=='string')fail('DATE_FORMAT_UNVERIFIED');
 const raw=/^\d{8}$/.test(value)?value:
  /^\d{4}[-/]\d{2}[-/]\d{2}$/.test(value)?value.replace(/[-/]/g,''):null;
 if(!raw)fail('DATE_FORMAT_UNVERIFIED');
 const out=raw.slice(0,4)+'-'+raw.slice(4,6)+'-'+raw.slice(6);
 if(new Date(out+'T00:00:00Z').toISOString().slice(0,10)!==out)
  fail('DATE_INVALID');
 return out;
}
export function parseKrxBaseInfo(date,market,payload){
 if(!MARKETS[market]||!Object.hasOwn(KRX_BASE_INFO_PATHS,market))
  fail('MARKET_UNVERIFIED');
 if(toDate(date)!==date||!Array.isArray(payload?.OutBlock_1)||
   payload.OutBlock_1.length<MARKETS[market].min||
   payload.OutBlock_1.length>5000)fail('SCHEMA_OR_COVERAGE_UNVERIFIED');
 const codes=new Map();
 for(const row of payload.OutBlock_1){
  const code=row?.ISU_SRT_CD,isin=row?.ISU_CD;
  if(typeof code!=='string'||!CODE.test(code)||
    typeof isin!=='string'||!ISIN.test(isin)||codes.has(code))
   fail('CODE_IDENTITY_OR_DUPLICATE');
  const listed=toDate(row.LIST_DD);
  if(listed>date)fail('FUTURE_LISTING_UNVERIFIED');
  codes.set(code,{
   listed,
   securityGroup:typeof row.SECUGRP_NM==='string'?row.SECUGRP_NM:'',
   shareClass:typeof row.KIND_STKCERT_TP_NM==='string'?row.KIND_STKCERT_TP_NM:''
  });
 }
 return {date,market,codes};
}
export function analyzeOfficialListingCoverage(archive,expected,baseByMarket){
 const valid=verifyArchive(archive);
 if(!Array.isArray(expected)||expected.length!==WINDOW||
  !valid.sessions.every((s,i)=>s.date===expected[i])||
  valid.sessions.length!==WINDOW)fail('ARCHIVE_INCOMPLETE');
 let canonical;
 try{canonical=expectedSessions(expected.at(-1));}catch{fail('CALENDAR_UNVERIFIED');}
 if(canonical.some((x,i)=>x!==expected[i]))fail('ARCHIVE_CALENDAR_UNVERIFIED');
 const raw=countNewHighsAndLows(valid,expected);
 const eligibility=audit52WeekHistoryEligibility(valid,expected,raw);
 const markets={};
 for(const market of Object.keys(MARKETS)){
  const metadata=baseByMarket?.[market];
  if(!metadata||metadata.date!==expected.at(-1)||metadata.market!==market||
   !(metadata.codes instanceof Map))fail('BASE_INFO_DATE_MARKET_UNVERIFIED');
  const today=valid.sessions.at(-1).markets[market].rows;
  const current=new Set(today.map(r=>r[0]));
  const firstSeen=new Map();
  const days=new Map();
  const gaps=new Map();
  for(let i=0;i<WINDOW;i++){
   for(const [code] of valid.sessions[i].markets[market].rows){
    if(!current.has(code))continue;
    if(!firstSeen.has(code))firstSeen.set(code,i);
    if(gaps.has(code)){
     const last=days.get(code).last;
     gaps.set(code,gaps.get(code)+i-last-1);
    }else gaps.set(code,0);
    const v=days.get(code)||{n:0,last:-1};
    v.n++;v.last=i;days.set(code,v);
   }
  }
  const report={sourceTotalToday:metadata.codes.size,
   observedToday:today.length,matched:0,unmatched:0,
   matchedFullHistory:0,matchedLateContinuous:0,matchedInterrupted:0,
   confirmedListedWithinWindow:0,confirmedListedWithinWindowLate:0,
   listedBeforeWindowButLate:0,confirmedListedWithinWindowInterrupted:0,
   listedBeforeWindowButInterrupted:0,
   classCommon:0,classPreferred:0,classUnclassified:0,
   listedDateAfterFirstQuote:0,
   sourceStatus:'PARTIAL',publicationAllowed:false};
  for(const [code] of today){
   const info=metadata.codes.get(code);
   if(!info){report.unmatched++;continue;}
   const first=firstSeen.get(code);
   if(!Number.isInteger(first))fail('CURRENT_SYMBOL_NOT_IN_HISTORY');
   const firstDay=expected[first];
   if(info.listed>firstDay){
    // An official listing after actual KRX trade data means the matching
    // short code has incompatible histories (relisting, reused ID, etc).
    report.listedDateAfterFirstQuote++;
    continue;
   }
   report.matched++;
   if(info.shareClass==='보통주')report.classCommon++;
   else if(info.shareClass==='우선주')report.classPreferred++;
   else report.classUnclassified++;
   const detail=days.get(code),gapsCount=gaps.get(code);
   const listedInWindow=info.listed>=expected[0];
   if(listedInWindow)report.confirmedListedWithinWindow++;
   if(detail.n===WINDOW){
    report.matchedFullHistory++;
    if(info.listed>expected[0])fail('FULL_HISTORY_LISTING_CONFLICT');
   }else if(gapsCount===0&&first>0){
    report.matchedLateContinuous++;
    if(listedInWindow)report.confirmedListedWithinWindowLate++;
    else report.listedBeforeWindowButLate++;
   }else if(gapsCount>0){
    report.matchedInterrupted++;
    if(listedInWindow)report.confirmedListedWithinWindowInterrupted++;
    else report.listedBeforeWindowButInterrupted++;
   }else fail('ELIGIBILITY_UNCLASSIFIED');
  }
  if(report.matched+report.unmatched+report.listedDateAfterFirstQuote!==today.length||
   report.matchedFullHistory>eligibility.markets[market].fullHistory||
   report.matchedLateContinuous>eligibility.markets[market].lateFirstObservedContinuous||
   report.matchedInterrupted>eligibility.markets[market].interruptedAfterFirstObserved)
   fail('DENOMINATOR_CONFLICT');
  report.sourceStatus=report.unmatched===0&&report.listedDateAfterFirstQuote===0
   ?'MATCHED_LISTING_DATES_NOT_BREADTH_CERTIFIED':'PARTIAL_OR_IDENTITY_CONFLICT';
  markets[market]=report;
 }
 return {kind:'KRX52_OFFICIAL_LISTING_DATE_READONLY',
  status:'LISTING_METADATA_AUDIT_ONLY',date:expected.at(-1),
  source:'KRX_OFFICIAL_STOCK_BASE_INFO',
  licensedRedistributionVerified:false,haltReasonsVerified:false,
  corporateActionsVerified:false,marketWideCertified:false,
  publicationAllowed:false,portfolioWrites:0,gasWrites:0,telegramSends:0,
  markets};
}
export async function fetchKrxBaseInfo(date,market,{key,fetchImpl=fetch}={}){
 if(typeof key!=='string'||!KEY.test(key))
  return {status:'KRX_KEY_UNAVAILABLE',data:null};
 const path=KRX_BASE_INFO_PATHS[market];
 if(!path||toDate(date)!==date)fail('SOURCE_PARAMETERS_INVALID');
 const url=new URL('https://data-dbg.krx.co.kr'+path);
 url.searchParams.set('basDd',date.replaceAll('-',''));
 let response;
 try{
  response=await fetchImpl(url.href,{method:'GET',redirect:'error',
   headers:{AUTH_KEY:key,accept:'application/json'},
   signal:AbortSignal.timeout(12000)});
 }catch{return {status:'NETWORK_OR_TIMEOUT',data:null};}
 if(!response?.ok){
  return {status:[401,403].includes(Number(response?.status))
   ?'KRX_SERVICE_APPROVAL_REQUIRED'
   :Number(response?.status)===429?'RATE_LIMITED':'HTTP_UNVERIFIED',data:null};
 }
 const size=Number(response.headers?.get?.('content-length')||0);
 if(size>4500000)return {status:'SOURCE_TOO_LARGE',data:null};
 try{
  const data=parseKrxBaseInfo(date,market,await response.json());
  return {status:'VERIFIED',data};
 }catch{return {status:'SCHEMA_UNVERIFIED',data:null};}
}
export async function runKrxListingReadOnly({archive,key,fetchImpl=fetch,now=new Date()}={}){
 const valid=verifyArchive(archive);
 const expected=valid.sessions.map(x=>x.date);
 if(expected.length!==WINDOW||expected.some((d,i)=>d!==expectedSessions(expected.at(-1))[i]))
  fail('ARCHIVE_INCOMPLETE');
 const date=expected.at(-1);
 const eligible=completedSession(now);
 // A stale 252-session archive cannot prove up-to-date official listing.
 if(date!==eligible)return {kind:'KRX52_OFFICIAL_LISTING_DATE_READONLY',
   status:'ARCHIVE_STALE',date,expected:eligible,publicationAllowed:false,
   marketWideCertified:false,portfolioWrites:0,gasWrites:0,telegramSends:0};
 const sourceStatus={},base={};
 for(const market of Object.keys(MARKETS)){
  const x=await fetchKrxBaseInfo(date,market,{key,fetchImpl});
  sourceStatus[market]=x.status;
  if(x.status==='VERIFIED')base[market]=x.data;
  if(['KRX_KEY_UNAVAILABLE','KRX_SERVICE_APPROVAL_REQUIRED','RATE_LIMITED'].includes(x.status))break;
 }
 if(Object.keys(base).length!==2)
  return {kind:'KRX52_OFFICIAL_LISTING_DATE_READONLY',status:'SOURCE_UNVERIFIED',
   date,sourceStatus,marketWideCertified:false,publicationAllowed:false,
   portfolioWrites:0,gasWrites:0,telegramSends:0};
 return {...analyzeOfficialListingCoverage(valid,expected,base),sourceStatus};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const arg=process.argv.slice(2);
  if(arg.length!==1||!/^\-\-input=\.krx-52week\/[a-z/-]+\.json$/.test(arg[0]))
   fail('CLI_ARGUMENT_UNVERIFIED');
  const archive=readArchiveFile(arg[0].slice('--input='.length));
  const report=await runKrxListingReadOnly({archive,key:process.env.KRX_AUTH_KEY});
  console.log(JSON.stringify(report));
 }catch(e){
  console.error(/^KRX52_LISTING_[A-Z_]+$/.test(String(e?.message))?
   e.message:'KRX52_LISTING_AUDIT_UNVERIFIED');
  process.exitCode=1;
 }
}
