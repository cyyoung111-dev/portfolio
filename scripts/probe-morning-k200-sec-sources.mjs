// Manual read-only operational source readiness. Never writes price history,
// GAS, Telegram, claims or portfolio sheets; never outputs raw market prices,
// contracts, API credentials, SEC responses or personally identifiable data.
import {pathToFileURL} from 'node:url';
import {krxSessionStatus} from './krx-session-calendar.mjs';
import {parsePublicFutureMaster} from './nhplug-public-future-master.mjs';
import {secCikMap,parseSecRecentFiling} from './briefing-ai-official-sec-events.mjs';

const REPO='cyyoung111-dev/portfolio';
const KRX_URL='https://data-dbg.krx.co.kr/svc/apis/drv/fut_bydd_trd';
const NH_MASTER='https://www.nhplug.com/instruments/m_future.mst';
const SEC_TICKERS='https://www.sec.gov/files/company_tickers.json';
const SEC_ROOT='https://data.sec.gov/submissions/CIK';
// KRX regular futures sometimes use the exchange's short "A..." contract
// code rather than the twelve-character ISIN. Both need independent expiry
// validation; short exchange codes must NEVER be labeled an ISIN.
const K200_CODE=/^(?:KR[0-9A-Z]{10}|A[0-9A-Z]{7}|K[0-9A-Z]{8})$/;
function parseK200Month(raw) {
 const name=typeof raw==='string'?raw.trim():'';
 // Observed KRX naming convention: "코스피200 F 202612 (정규)".
 const modern=/^(?:코스피|KOSPI)\s*200\s*F\s+(20\d{2})(03|06|09|12)\s*\((?:정규|주간)\)$/i.exec(name);
 if(modern)return modern[1]+'-'+modern[2];
 // Keep the legacy fixture/older metadata shape read-only.
 const legacy=/^(?:코스피|KOSPI)\s*200\s*선물\s*(?:20)?(\d{2})[.\s/-]?(03|06|09|12)$/i.exec(name);
 return legacy?'20'+legacy[1]+'-'+legacy[2]:null;
}
function krxShortCodeToNh(code) {
 if(typeof code!=='string')return null;
 if(/^A[0-9A-Z]{7}$/.test(code))return 'K'+code;
 if(/^K[0-9A-Z]{8}$/.test(code))return code;
 return null;
}
const validDay=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)
 &&Number.isFinite(Date.parse(d+'T00:00:00Z'))
 &&new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d;
const tick=v=>{
 if(typeof v!=='string'||! /^\d+(?:\.\d+)?$/.test(v.replaceAll(',','')))return false;
 const x=Number(v.replaceAll(',',''));
 return Number.isFinite(x)&&x>0&&Math.abs(x*20-Math.round(x*20))<1e-7;
};
function clock(now){
 const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{
  timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',
  hour:'2-digit',minute:'2-digit',hourCycle:'h23'
 }).formatToParts(now).map(x=>[x.type,x.value]));
 return {date:p.year+'-'+p.month+'-'+p.day,
  minutes:Number(p.hour)*60+Number(p.minute)};
}
export function probeAuthorized({env=process.env,now=new Date()}={}){
 const current=clock(now),target=env.MARKET_SOURCE_PROBE_DATE;
 if(env.GITHUB_REPOSITORY!==REPO||env.GITHUB_REF!=='refs/heads/main'
  ||env.GITHUB_EVENT_NAME!=='push'
  ||Number(env.GITHUB_RUN_ATTEMPT)!==1
  ||env.MARKET_SOURCE_PROBE_APPROVED!=='true'
  ||target!==current.date||krxSessionStatus(target)!=='OPEN'
  ||current.minutes<8*60+15||current.minutes>=19*60)
  return null;
 return current;
}
export function previousKrxTradingDate(date){
 if(!validDay(date)||krxSessionStatus(date)!=='OPEN')return null;
 for(let days=1;days<=6;days++){
  const d=new Date(Date.parse(date+'T00:00:00Z')-days*86400000).toISOString().slice(0,10);
  const status=krxSessionStatus(d);
  if(status==='OPEN')return d;
  if(status!=='CLOSED')return null;
 }
 return null;
}
// Expose aggregate schema counts only; no prices, securities, contract
// identifiers, names, credentials, or portfolio constituents in CI logs.
// Used to distinguish KRX access issues from identity/label parser drift.
export function inspectKrxFuturesSchema(payload, requestedDate){
 const rows=payload?.OutBlock_1;
 if(!validDay(requestedDate)||!Array.isArray(rows)||rows.length>10000)
  return null;
 const sameDate=rows.filter(r=>r?.BAS_DD===requestedDate.replaceAll('-',''));
 const session=r=>r?.MKT_NM==='정규'||r?.MKT_NM==='정규시장'||r?.MKT_NM==='주간';
 const product=r=>/^(?:코스피\s*200\s*선물|KOSPI\s*200\s*FUT)/i.test(r?.PROD_NM||'');
 const nameContainsK200=r=>/(?:코스피\s*200|KOSPI\s*200)/i.test(r?.ISU_NM||'');
 const tested=sameDate.filter(r=>session(r)&&product(r));
 const widths={missing:0,short:0,twelve:0,other:0};
 const preciseWidths={six:0,seven:0,eight:0,nine:0,ten:0,eleven:0,twelve:0,other:0};
 for(const r of tested){
  const len=typeof r?.ISU_CD==='string'?r.ISU_CD.length:0;
  if(len===0)widths.missing++;
  else if(len<12)widths.short++;
  else if(len===12)widths.twelve++;
  else widths.other++;
  const widthKey=({6:'six',7:'seven',8:'eight',9:'nine',10:'ten',11:'eleven',12:'twelve'})[len]||'other';
  preciseWidths[widthKey]++;
 }
 const settleNonempty=r=>typeof r?.SETL_PRC==='string'
  &&r.SETL_PRC.trim().length>0&&r.SETL_PRC!=='-';
 return Object.freeze({
  totalRows:rows.length,exactDateRows:sameDate.length,
  regularSessionRows:sameDate.filter(session).length,
  k200ProductRows:sameDate.filter(product).length,
  k200NameRows:sameDate.filter(nameContainsK200).length,
  inspectedRows:tested.length,
  validCodeRows:tested.filter(r=>K200_CODE.test(r.ISU_CD||'')).length,
  validContractNameRows:tested.filter(r=>!!parseK200Month(r.ISU_NM)).length,
  nonemptySettlementRows:tested.filter(settleNonempty).length,
  validTickSettlementRows:tested.filter(r=>tick(r.SETL_PRC)).length,
  fullyVerifiedRows:tested.filter(r=>K200_CODE.test(r.ISU_CD||'')
   &&!!parseK200Month(r.ISU_NM)&&tick(r.SETL_PRC)).length,
  codeWidthCounts:widths,preciseCodeLengths:preciseWidths
 });
}

// A KRX standard ISU_CD and an NH 9-character vendor contract code are
// different identifiers. Same month alone is NOT a verified code mapping.
export function summarizeKrxDaySettlement(payload,requestedDate){
 if(!validDay(requestedDate)||!payload||Array.isArray(payload))return 'KRX_SCHEMA_INVALID';
 const rows=payload?.OutBlock_1;
 if(!Array.isArray(rows)||rows.length>10000)return 'KRX_ROWS_UNAVAILABLE';
 if(!rows.length)return 'KRX_ROWS_EMPTY';
 const dated=rows.filter(r=>r?.BAS_DD===requestedDate.replaceAll('-','')
  &&(r.MKT_NM==='정규'||r.MKT_NM==='정규시장'||r.MKT_NM==='주간')
  &&/^(?:코스피\s*200\s*선물|KOSPI\s*200\s*FUT)/i.test(r.PROD_NM||''));
 if(!dated.length)return 'KRX_K200_REGULAR_NOT_MATCHED';
 const good=dated.filter(r=>K200_CODE.test(r.ISU_CD||'')
  &&!!parseK200Month(r.ISU_NM)&&tick(r.SETL_PRC));
 if(!good.length)return 'KRX_SETTLEMENT_IDENTITY_UNVERIFIED';
 if(new Set(good.map(r=>r.ISU_CD)).size!==good.length)
  return 'KRX_DUPLICATE_CONTRACT_CODE';
 const months=new Map();
 for(const row of good){
  const month=parseK200Month(row.ISU_NM);
  months.set(month,(months.get(month)||0)+1);
 }
 return [...months.values()].some(count=>count!==1)
  ?'KRX_EXPIRY_AMBIGUOUS':'KRX_DAY_SETTLEMENT_CANDIDATES_ONLY';
}
export function compareKrxNhIdentity(krxRows,masterBuffer,requestedDate){
 const status=summarizeKrxDaySettlement(krxRows,requestedDate);
 if(status!=='KRX_DAY_SETTLEMENT_CANDIDATES_ONLY')
  return {status,contractMapped:false};
 try{
  const parsed=parsePublicFutureMaster(masterBuffer);
  const nh=parsed.candidates.filter(x=>x.contractMonth);
  const pairs=new Set(nh.map(x=>x.contractMonth));
  const official=krxRows.OutBlock_1.filter(x=>
   x?.BAS_DD===requestedDate.replaceAll('-','')
   &&K200_CODE.test(x.ISU_CD||'')
   &&parseK200Month(x.ISU_NM)&&tick(x.SETL_PRC)
   &&(x.MKT_NM==='정규'||x.MKT_NM==='정규시장'||x.MKT_NM==='주간'));
  const krxMonths=new Set(official.map(x=>parseK200Month(x.ISU_NM)));
  if(!nh.length||!official.length)return {status:'NH_K200_MASTER_UNAVAILABLE',contractMapped:false,exactCodeMatches:0};
  const matchRecords=official.filter(x=>{
   const nhCode=krxShortCodeToNh(x.ISU_CD);
   return nhCode&&nh.filter(n=>n.code===nhCode
     &&n.contractMonth===parseK200Month(x.ISU_NM)).length===1;
  });
  if(matchRecords.length &&new Set(matchRecords.map(x=>x.ISU_CD)).size===matchRecords.length){
   // Exact public code + contract month evidence; still not proof of the
   // active overnight contract or 07:40 availability.
   return {status:'CROSS_SOURCE_PUBLIC_CODE_AND_MONTH_MATCHED',
    contractMapped:false,exactCodeMatches:matchRecords.length};
  }
  if([...pairs].some(month=>krxMonths.has(month)))
   return {status:'PRODUCT_EXPIRY_CROSS_SOURCE_CANDIDATE',contractMapped:false,exactCodeMatches:0};
  return {status:'KRX_NH_EXPIRY_NOT_MATCHED',contractMapped:false};
 }catch{return {status:'NH_K200_MASTER_UNAVAILABLE',contractMapped:false};}
}
async function getJson(url,headers,fetchImpl){
 try{
  const res=await fetchImpl(url,{method:'GET',headers,
   redirect:'error',signal:AbortSignal.timeout(12000)});
  if(!res?.ok)return {status:'HTTP_'+String(res?.status||0),data:null};
  return {status:'HTTP_200',data:await res.json()};
 }catch{return {status:'NETWORK_OR_JSON_UNAVAILABLE',data:null};}
}
export async function probePublicSources({env=process.env,now=new Date(),
 fetchImpl=fetch}={}){
 const current=probeAuthorized({env,now});
 if(!current)return {status:'PROBE_AUTH_OR_WINDOW_DENIED'};
 const prior=previousKrxTradingDate(current.date);
 if(!prior)return {status:'KRX_DATE_UNVERIFIED'};
 const result={status:'READ_ONLY',target:current.date,sourceTradingDate:prior,
  krx:'NOT_ATTEMPTED',nhMaster:'NOT_ATTEMPTED',mapping:'UNVERIFIED',
  sec:'NOT_ATTEMPTED',secFiling:'NOT_CHECKED',contractMapped:false,
  telegramSends:0,portfolioWrites:0,gasCalls:0};
 const key=env.KRX_AUTH_KEY;
 let krx=null;
 if(typeof key!=='string'||key.length<10)result.krx='KEY_MISSING';
 else{
  const target=new URL(KRX_URL);
  target.searchParams.set('basDd',prior.replaceAll('-',''));
  const response=await getJson(target.href,{AUTH_KEY:key,accept:'application/json'},fetchImpl);
  result.krx=response.status;
  if(response.data){
   krx=response.data;
   result.krx=summarizeKrxDaySettlement(krx,prior);
   result.krxSchema=inspectKrxFuturesSchema(krx,prior);
  }
 }
 if(krx && result.krx==='KRX_DAY_SETTLEMENT_CANDIDATES_ONLY'){
  try{
   const response=await fetchImpl(NH_MASTER,{
    method:'GET',redirect:'error',signal:AbortSignal.timeout(10000)});
   if(!response?.ok)result.nhMaster='HTTP_'+String(response?.status||0);
   else{
    const data=Buffer.from(await response.arrayBuffer());
    if(data.length>1_000_000)result.nhMaster='TOO_LARGE';
    else{
     const comparison=compareKrxNhIdentity(krx,data,prior);
     result.nhMaster=comparison.status;
     result.mapping=comparison.status;
     result.contractMapped=comparison.contractMapped;
    }
   }
  }catch{result.nhMaster='NETWORK_OR_PARSE_UNAVAILABLE';}
 }
 const agent=env.SEC_USER_AGENT;
 if(typeof agent!=='string'||agent.length<12||!agent.includes('@'))result.sec='AGENT_MISSING';
 else{
  const headers={accept:'application/json','user-agent':agent};
  const ticker=await getJson(SEC_TICKERS,headers,fetchImpl);
  result.sec=ticker.status;
  if(ticker.data){
   const cik=secCikMap(ticker.data,['MU']).MU;
   if(cik){
    const subs=await getJson(SEC_ROOT+cik+'.json',headers,fetchImpl);
    result.sec=subs.status;
    if(subs.data){
     const filing=parseSecRecentFiling(subs.data,{
      symbol:'MU',cik,usDate:prior,now});
     result.secFiling=filing?'RECENT_VERIFIED':'NO_RECENT_FILING';
    }
   }else result.sec='TICKER_IDENTITY_NOT_VERIFIED';
  }
 }
 return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const result=await probePublicSources();
  console.log(JSON.stringify({kind:'MORNING_K200_SEC_SOURCE_PROOF',...result}));
  if(result.status!=='READ_ONLY')process.exitCode=1;
 }catch{
  console.error('MORNING_K200_SEC_SOURCE_PROOF_FAILED');
  process.exitCode=1;
 }
}
