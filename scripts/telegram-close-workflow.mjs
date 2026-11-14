import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {krxSessionStatus} from './krx-session-calendar.mjs';
import {completedSession as krxPublishedSession} from './krx-52week-market.mjs';
import {sendTelegram} from './telegram-morning-briefing.mjs';
import {readNhMorningIndexes} from './nh-morning-index-source.mjs';
import {expectedMorningDate} from './telegram-morning-report.mjs';
import {fetchSecondaryIndexes} from './closing-secondary-index-sources.mjs';
import domesticIndexEod from '../src/web/domain/market/domestic_index_eod.js';
import {fetchOfficialDailyIndexes} from './krx-official-daily-index.mjs';
import {fetchShinhanIndexEod} from './shinhan-korean-index-eod.mjs';
import {verifyCrosscheckedYahooIndexes} from './yahoo-shinhan-crosschecked-close.mjs';
import {deliveryTrigger} from './telegram-delivery-trigger.mjs';
import {deliverAndRecordWeekday} from './telegram-weekday-sent-proof.mjs';
import {summarizeCloseCoverage,formatCloseCoverageSummary,closeQualityDecision} from './briefing-source-coverage.mjs';
import {readClosingStockSources,readClosingMacros,formatClosingExtra} from './closing-extra-daily-sources.mjs';
import {loadPreparedClose} from './telegram-close-prepared-artifact.mjs';
import {verifyLateCloseSent} from './telegram-close-late-verdict.mjs';
import {sanitizePreclose} from './telegram-close-precompute.mjs';
import {readClosingMarketReferences,formatClosingMarketReferences} from './closing-market-references.mjs';
import {readCurrentFutures,formatCurrentFutures,selectCurrentFuturesRows} from './closing-current-futures.mjs';
import {formatAiIndustryCloseLens} from './briefing-ai-industry-lens.mjs';
import {fitAiFinancialEvidenceForBudget,auditSentFinancialEvidence} from './briefing-financial-evidence.mjs';
import {readKofiaLiquidity,formatKofiaLiquidity} from './briefing-kofia-liquidity.mjs';
import {readInvestorTrends,formatInvestorTrends} from './briefing-krx-investor-trends.mjs';
import {summarizeOptionalDelivery} from './briefing-optional-display-audit.mjs';
import {loadAiFinancialEvidenceArtifact} from './load-ai-financial-evidence-artifact.mjs';
import {readTreasuryCurve,verifyTreasuryCurve,formatTreasuryCurve} from './closing-us-treasury-curve.mjs';
import {readClosingVkospi,verifyClosingVkospi} from './closing-vkospi-reference.mjs';
import {readClosingKrxTurnoverFromGas,verifyOfficialKrxTurnover,formatKrxTurnover}
 from './closing-krx-turnover.mjs';
import {readFearGreed,verifyFearGreed,formatFearGreed,fearGreedDisplayStatus} from './briefing-fear-greed.mjs';

// Fixed-shape read-only source reasons for optional 17:00 market indicators.
// Never propagate provider text, HTTP bodies, URLs, tokens or financial amounts.
const CLOSE_OPTIONAL_READ_CODES=Object.freeze({
 FRED_TREASURY_READ:new Set(['SESSION_UNVERIFIED','HTTP_UNAVAILABLE',
  'CONTENT_TYPE_INVALID','NO_EXACT_VALID_ROW','PUBLISHED_PRIOR_SESSION',
  'VERIFIED','NETWORK_OR_PARSE_FAILED']),
 TREASURY_PAR_READ:new Set(['SESSION_UNVERIFIED','HTTP_UNAVAILABLE',
  'SOURCE_OR_TYPE_INVALID','RESPONSE_TOO_LARGE','NO_EXACT_VALID_ROW',
  'VERIFIED','NETWORK_OR_PARSE_FAILED']),
 VKOSPI_READ:new Set(['CONFIG_OR_SESSION_UNVERIFIED','ENDPOINT_INVALID',
  'HTTP_UNAVAILABLE','GAS_RESPONSE_SCHEMA','GAS_AUTH_REJECTED',
  'KRX_NO_DATED_VKOSPI_POINT','KRX_KEY_NOT_CONFIGURED',
  'KRX_KEY_OR_INDEX_PERMISSION_DENIED','KRX_VKOSPI_BATCH_NETWORK_FAILURE',
  'GAS_STATUS_ERROR','NO_EXACT_VALID_ROW','VERIFIED','NETWORK_OR_PARSE_FAILED',
  'KRX_TPLUSONE_NOT_PUBLISHED']),
 KRX_TURNOVER_READ:new Set(['CONFIG_OR_SESSION_UNVERIFIED',
  'ENDPOINT_INVALID','HTTP_UNAVAILABLE','PAYLOAD_INVALID','GAS_EMPTY_ROWS',
  'NO_EXACT_VALID_ROWS','BOTH_VERIFIED','PARTIAL','NETWORK_OR_PARSE_FAILED',
  'KRX_TPLUSONE_NOT_PUBLISHED'])
});
export function sanitizeCloseOptionalSourceReason(raw){
 if(!raw||typeof raw!=='object'||!Object.hasOwn(CLOSE_OPTIONAL_READ_CODES,raw.kind))return null;
 const safe={kind:raw.kind,status:CLOSE_OPTIONAL_READ_CODES[raw.kind].has(raw.status)
   ?raw.status:'OTHER_UNVERIFIED'};
 if(raw.kind==='FRED_TREASURY_READ'&&
    ['UST2Y','UST3Y','UST10Y_FRED'].includes(raw.id))safe.id=raw.id;
 return safe;
}

const REPO='cyyoung111-dev/portfolio';
const parts=instant=>Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(instant).map(p=>[p.type,p.value]));
// The authorized public KRX daily stock/index routes publish D on T+1, not
// at 17:00 on D. Read-only proof #43425414981: five D=2026-11-13 routes
// returned HTTP 200 and ZERO rows at 21:28 KST; D=11/12 was available.
// Do not make repeat redundant 17:00 GAS/direct KRX requests or label
// yesterday's official series with today's date. This does not block a
// *different, separately approved* same-day provider injected by the caller.
export function isKrxDailyPublicationEligible(date,instant){
 try{
  return /^\d{4}-\d{2}-\d{2}$/.test(date||'')&&
    krxPublishedSession(instant)>=date;
 }catch{return false;}
}
export function closeWindow(instant){
  const p=parts(instant),minute=Number(p.hour)*60+Number(p.minute);
  return {date:`${p.year}-${p.month}-${p.day}`,allowed:minute>=1020&&minute<1080}; // 17:00–17:59 KST; 18:00 hard cutoff
}

const NH_VERIFIED=Object.freeze([
 {label:'S&P 500',symbol:'^GSPC'},
 {label:'NASDAQ',symbol:'^IXIC'},
 {label:'NASDAQ100',symbol:'^NDX'}
]);
const NH_UNVERIFIED=Object.freeze(['KOSPI','KOSDAQ','KOSPI 200','다우존스','SOX','VIX','VKOSPI']);
export function verifiedNhCloseRows(date,rows){
 const expected=expectedMorningDate('SPX',date);
 if(!expected||!Array.isArray(rows)||rows.length>10)return [];
 const accepted=[];
 for(const target of NH_VERIFIED){
  const matches=rows.filter(row=>row?.symbol===target.symbol);
  if(matches.length!==1)continue;
  const row=matches[0];
  if(row.label!==target.label||row.source!=='NH_INDEX_DAILY'
    ||row.date!==expected||!Number.isFinite(row.value)||row.value<=0
    ||(row.changePercent!==null&&!Number.isFinite(row.changePercent)))continue;
  accepted.push({label:target.label,symbol:target.symbol,source:'NH_INDEX_DAILY',
    date:expected,value:row.value,changePercent:row.changePercent});
 }
 return accepted;
}
function previousOpenDate(date){
 const start=Date.parse(date+'T00:00:00Z');
 if(!Number.isFinite(start))return null;
 for(let n=1;n<=14;n++){
  const candidate=new Date(start-n*86400000).toISOString().slice(0,10);
  const session=krxSessionStatus(candidate);
  if(session==='UNKNOWN')return null;
  if(session==='OPEN')return candidate;
 }
 return null;
}
export async function fetchDomesticCloseIndexes(date,{fetchImpl=fetch,now=()=>new Date(),
 gasUrl=process.env.GAS_WEB_APP_URL,gasToken=process.env.GAS_ACCESS_TOKEN,
 fetchOfficial=fetchOfficialDailyIndexes,fetchShinhan=fetchShinhanIndexEod}={}){
 const previous=previousOpenDate(date);
 if(!previous||krxSessionStatus(date)!=='OPEN')return [];
 const from=new Date(Date.parse(previous+'T00:00:00Z')-2*86400000).toISOString().slice(0,10);
 // KRX official same-day result takes precedence when GAS confirms actual publication.
 let gasPayload=null;
 const [official,out,shinhan]=await Promise.all([
  Promise.resolve().then(()=>fetchOfficial(date,{url:gasUrl,token:gasToken,fetchImpl,now,
    onResponse:payload=>{gasPayload=payload;}})).catch(()=>[]),
  domesticIndexEod.loadSeries(['KOSPI','KOSDAQ','KOSPI200'],from,date,{fetchImpl,now})
    .catch(()=>({seriesMap:{}})),
  Promise.resolve().then(()=>fetchShinhan(date,{fetchImpl,now})).catch(()=>null)
 ]);
 const crosschecked=verifyCrosscheckedYahooIndexes(date,gasPayload,shinhan,previous,out.seriesMap||{});
 const labels={KOSPI:'KOSPI',KOSDAQ:'KOSDAQ',KOSPI200:'KOSPI 200'};
 return Object.keys(labels).flatMap(type=>{
  const verified=Array.isArray(official)?official.filter(r=>r?.type===type&&r.date===date
    &&r.source==='KRX_OFFICIAL'&&r.role==='NON_NH_DAILY_INDEX'
    &&r.priceType==='CONFIRMED_REGULAR_CLOSE'
    &&Number.isFinite(r.value)&&r.value>0):[];
  if(verified.length===1)return verified;
  if(verified.length>1)return [];
  const independent=crosschecked.filter(r=>r.type===type);
  if(independent.length===1)return independent;
  if(independent.length>1)return [];
  const list=out.seriesMap[type]||[],current=list.filter(x=>x.date===date);
  const prior=list.filter(x=>x.date<date).at(-1);
  if(current.length!==1||!prior||prior.date!==previous||current[0].source!=='FDR_KRX_CACHE'
   ||current[0].role!=='NON_NH_DAILY_INDEX'||current[0].priceType!=='PUBLISHED_EOD_REFERENCE')
    return [];
  return [{type,label:labels[type],date,source:'FDR_KRX_CACHE',role:'NON_NH_DAILY_INDEX',
    value:current[0].value,changePercent:(current[0].value/prior.value-1)*100,
    priceType:'PUBLISHED_EOD_REFERENCE'}];
 });
}
// The domestic KRX/FDR EOD reference can independently justify a closing
// briefing. This does not promote it to an NH stock/ETF operating close.
export function verifiedDomesticCloseRows(date,rows){
 if(!Array.isArray(rows)||rows.length>12)return [];
 const valid=[];
 for(const [label,type] of [['KOSPI','KOSPI'],['KOSDAQ','KOSDAQ'],['KOSPI 200','KOSPI200']]){
  const candidates=rows.filter(r=>r?.label===label);
  if(candidates.length!==1)continue;
  const r=candidates[0];
  if(r.type!==type||r.date!==date||r.role!=='NON_NH_DAILY_INDEX'
    ||!Number.isFinite(r.value)||r.value<=0)continue;
  if(r.source==='KRX_OFFICIAL'){
   if(r.priceType!=='CONFIRMED_REGULAR_CLOSE'
     ||r.changePercent!==null&&r.changePercent!==undefined&&!Number.isFinite(r.changePercent))continue;
  }else if(r.source==='FDR_KRX_CACHE'){
   if(r.priceType!=='PUBLISHED_EOD_REFERENCE'||!Number.isFinite(r.changePercent))continue;
  }else if(r.source==='YAHOO_SHINHAN_CROSSCHECKED_EOD'){
   if(r.priceType!=='INDEPENDENT_CROSSCHECKED_EOD'
     ||r.comparisonSource!=='SHINHAN_PUBLIC_INDEX'
     ||!Number.isFinite(Date.parse(r.comparisonPublishedAt||''))
     ||r.changePercent!==null&&!Number.isFinite(r.changePercent))continue;
  }else continue;
  valid.push(r);
 }
 return valid;
}
export function formatClose(date,rows,secondary=[],domestic=[],stocks=[],macros=[],markets=[],futures=[],now=new Date(date+'T17:00:00+09:00'),rates=[],vkospi=[],fearGreed=null,financialEvidence=null,turnover=[],liquidity=null,investors=null){
 const valid=verifiedNhCloseRows(date,rows);
 const validDomestic=verifiedDomesticCloseRows(date,domestic);
 const verifiedRates=verifyTreasuryCurve(date,rates);
 const verifiedVkospi=verifyClosingVkospi(date,vkospi);
 const verifiedTurnover=verifyOfficialKrxTurnover(date,turnover);
 const lines=['['+date+' 장후 시장 브리핑]',
  '기준: 국내 당일 마감 · 17시 해외 선물 · 미국 현물 직전 완료장','',
  ...formatAiIndustryCloseLens({date,usDate:expectedMorningDate('SPX',date),
    nh:valid,domestic:validDomestic,secondary,stocks,futures,financialEvidence,now}),'',
  '■ 국내 시장 (당일 종가)'];
 for(const label of NH_UNVERIFIED.slice(0,3)){
  const matches=validDomestic.filter(x=>x.label===label);
  if(matches.length!==1){lines.push(label+': 검증된 당일 종가 미확보');continue;}
  const x=matches[0];
  const change=Number.isFinite(x.changePercent)
    ?' ('+(x.changePercent>=0?'+':'')+x.changePercent.toFixed(2)+'%)':'';
  const provenance=x.source==='KRX_OFFICIAL'?'KRX'
    :x.source==='YAHOO_SHINHAN_CROSSCHECKED_EOD'?'Yahoo·신한 참고':'FDR 참고';
  lines.push(label+': '+x.value.toLocaleString('en-US',{maximumFractionDigits:2})
    +change+' ['+date+' · '+provenance+']');
 }
 const vk=verifiedVkospi[0];
 lines.push('VKOSPI: '+(vk?vk.value.toFixed(2)+' ['+date+' · KRX]':'당일 확정치 미확보'));
 lines.push('',formatCurrentFutures(date,futures,now),'','■ 미국 현물시장 (직전 완료장)');
 for(const target of NH_VERIFIED){
  const row=valid.find(r=>r.symbol===target.symbol);
  if(!row){lines.push(target.label+': 완료 종가 미확보');continue;}
  const change=Number.isFinite(row.changePercent)
    ?' ('+(row.changePercent>=0?'+':'')+row.changePercent.toFixed(2)+'%)':'';
  lines.push(target.label+': '+row.value.toLocaleString('en-US',{maximumFractionDigits:2})
    +change+' ['+row.date+']');
 }
 lines.push('','■ 글로벌 참고 지표');
 for(const label of NH_UNVERIFIED.slice(3)){
  const candidates=secondary.filter(row=>row?.label===label&&row.role==='NON_NH_REFERENCE_ONLY'
    &&row.date===expectedMorningDate('SPX',date)
    &&Number.isFinite(row.value)&&row.value>0
    &&((label==='다우존스'&&row.source==='FRED_DJIA')
      ||(label==='SOX'&&['FRED_NASDAQSOX','YAHOO_SOX_DAILY_REFERENCE'].includes(row.source))
      ||(label==='VIX'&&row.source==='CBOE_VIX_DAILY')));
  if(candidates.length!==1){lines.push(label+': 검증값 미확보');continue;}
  const item=candidates[0];
  const provenance=item.source==='CBOE_VIX_DAILY'?'CBOE 참고':item.source==='YAHOO_SOX_DAILY_REFERENCE'?'Yahoo 참고':'FRED 참고';
  lines.push(label+': '+item.value.toLocaleString('en-US',{maximumFractionDigits:2})
    +' ['+item.date+' · '+provenance+']');
 }
 const coverage=summarizeCloseCoverage(date,{nh:valid,domestic:validDomestic,
  secondary,stocks,macros,markets,rates:verifiedRates,vkospi:verifiedVkospi,
  turnover:verifiedTurnover,liquidity,investors,
  expectedUsDate:expectedMorningDate('SPX',date)});
 lines.push('',formatClosingExtra(date,stocks,macros,{omitUs10y:verifiedRates.some(x=>x.id==='UST10Y_FRED'&&
    x.date===expectedMorningDate('SPX',date))}),'',
  formatTreasuryCurve(date,verifiedRates),'',
  formatClosingMarketReferences(date,markets),'',
  formatCloseCoverageSummary(coverage).split('\n')
    .filter(line=>!line.startsWith('미연결 참고지표:')).join('\n'),
  '※ 기본 가격·미국 지수: NH PLUG · 그 외 참고값 출처 별도 표기');
 // Published FreeSIS settlement-date totals, never presented as a same-day
 // trading close. A missing source must not add another repetitive warning.
 const investorLine=formatInvestorTrends(investors);
 if(investorLine&&lines.join('\n').length+investorLine.length+2<=3900){
   const position=lines.indexOf('■ 글로벌 참고 지표');
   if(position>=0)lines.splice(position,0,investorLine,'');
 }
 const liquidityLine=formatKofiaLiquidity(liquidity);
 if(liquidityLine&&lines.join('\n').length+liquidityLine.length+2<=3900){
   const position=lines.indexOf('■ 글로벌 참고 지표');
   if(position>=0)lines.splice(position,0,liquidityLine,'');
 }
 const sentiment=formatFearGreed(fearGreed,{now});
 const baseline=lines.join('\n');
 const insertAt=lines.indexOf('■ 글로벌 참고 지표');
 // A supplementary feed must not exceed Telegram's payload budget or block 17:00.
 if(insertAt>=0&&baseline.length+sentiment.length+1<=3900)
   lines.splice(insertAt+1,0,sentiment);
 // Precomputed SEC/DART evidence only. Never fetch in the 17:00 critical path.
 const financialLines=financialEvidence?.asOfKst===date
  &&financialEvidence.usSessionDate===expectedMorningDate('SPX',date)
   ?fitAiFinancialEvidenceForBudget(financialEvidence,
       3900-lines.join('\n').length-2):[];
 const index=lines.indexOf('■ 국내 시장 (당일 종가)');
 if(financialLines.length&&index>=0
  &&lines.join('\n').length+financialLines.join('\n').length+2<=3900)
   lines.splice(index,0,...financialLines,'');
 // Give the 06:20 SEC/DART financial evidence its existing payload priority.
 // Optional KRX cash turnover must never push an otherwise valid SEND over
 // the 4,000-character Telegram guard; confirmed official dated rows only.
 if(verifiedTurnover.length){
   const detail=formatKrxTurnover(date,verifiedTurnover);
   const pos=lines.findIndex(x=>x.startsWith('VKOSPI:'));
   if(pos>=0&&lines.join('\n').length+detail.length+2<=3900)
     lines.splice(pos+1,0,detail);
 }
 // Verified market and finance values outrank generic closing commentary.
 const genericNotes=[
  /^• AI 수요 검증:/,/^• 실행 기준:/,/^• 긍정:/,/^• 경계:/,
  /^■ 조건부 시나리오 · 다음 확인/,/^※ 기본 가격·미국 지수:/
 ];
 let rendered=lines.join('\n');
 for(const pattern of genericNotes){
  if(rendered.length<=3900)break;
  const idx=lines.findIndex(x=>pattern.test(x));
  if(idx>=0)lines.splice(idx,1);
  rendered=lines.join('\n');
 }
 return rendered;
}
// Wait only briefly for the already-running 06:20 SEC/DART artifact read.
// A fast market-only PREPARE used to read a still-pending optional promise as
// null. Always cancel the timer, catch optional errors, and never make the
// evidence loader a claim or dispatch gate.
export async function settleOptionalCloseFinance(promise,waitMs=1800){
 if(!Number.isInteger(waitMs)||waitMs<0||waitMs>1800)
   throw Error('TELEGRAM_CLOSE_FINANCE_BUDGET_INVALID');
 const pending=Promise.resolve(promise).catch(()=>null);
 // With zero remaining budget, give an already-fulfilled public evidence
 // promise one microtask to win. An unresolved request still returns null
 // without any timer, so the close SEND window remains protected.
 if(waitMs===0)return (await Promise.race([
   pending,Promise.resolve().then(()=>null)]))??null;
 let timer;
 try {
   const deadline=new Promise(resolve=>{timer=setTimeout(()=>resolve(null),waitMs);});
   return (await Promise.race([pending,deadline]))??null;
 } finally {
   if(timer!==undefined)clearTimeout(timer);
 }
}
export async function prepareClose({now=()=>new Date(),fetchImpl=fetch,githubToken,repository,attempt=1,fetchNh=readNhMorningIndexes,
 gasUrl=process.env.GAS_WEB_APP_URL,gasToken=process.env.GAS_ACCESS_TOKEN,
 fetchSecondary=fetchSecondaryIndexes,fetchDomestic=fetchDomesticCloseIndexes,
 fetchStocks=readClosingStockSources,fetchMacros=readClosingMacros,
 fetchMarkets=readClosingMarketReferences,fetchFutures=readCurrentFutures,
 fetchRates=readTreasuryCurve,fetchVkospi=readClosingVkospi,
 fetchTurnover=readClosingKrxTurnoverFromGas,fetchLiquidity=readKofiaLiquidity,
 fetchInvestorFlows=readInvestorTrends,
 loadPrepared=async()=>null,loadFinancialEvidence=async()=>null}={}){
  if(repository!==REPO||!githubToken||Number(attempt)!==1)throw Error('TELEGRAM_CLOSE_CONFIG');
  const window=closeWindow(now());if(!window.allowed)throw Error('TELEGRAM_CLOSE_LATE');
  const session=krxSessionStatus(window.date);
  if(session==='CLOSED')return {ready:false,status:'MARKET_CLOSED',date:window.date};
  if(session!=='OPEN')throw Error('TELEGRAM_CLOSE_CALENDAR_UNKNOWN');
  const artifactName='telegram-close-claim-'+window.date;
  let response,data;
  try{response=await fetchImpl(`https://api.github.com/repos/${REPO}/actions/artifacts?name=${artifactName}&per_page=100`,{headers:{authorization:'Bearer '+githubToken,accept:'application/vnd.github+json'},redirect:'error',signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error();data=await response.json();}catch{throw Error('TELEGRAM_CLOSE_CLAIM_FAILED');}
  if(!Number.isSafeInteger(data.total_count)||data.total_count<0||!Array.isArray(data.artifacts)||data.total_count===0&&data.artifacts.length)throw Error('TELEGRAM_CLOSE_CLAIM_SCHEMA');
  if(data.total_count>0){if(!data.artifacts.some(a=>a.name===artifactName))throw Error('TELEGRAM_CLOSE_CLAIM_SCHEMA');return {ready:false,status:'ALREADY_CLAIMED',date:window.date};}
  // Run the optional public-data loader alongside market collection; it must
  // never become a delivery claim, source gate or Telegram send authority.
  // Start in parallel; after market verification allow a bounded grace
  // period for the already-started archive reader to resolve.
  const optionalFinancialEvidence=Promise.resolve().then(()=>
    loadFinancialEvidence(window.date,{token:githubToken,repository,fetchImpl,now}))
    .catch(()=>null);
  // US NH indices and Korean KRX/FDR EOD references are independently
  // eligible. A missing NH response must not block verified domestic closes.
  // FRED/CBOE secondary references alone NEVER authorize sending.
  // A fully verified 16:50 public-data Artifact avoids unnecessary 17:00
  // fetches. Missing/invalid groups are fetched live, without claim bypass.
  let rawPrepared=null;
  try{rawPrepared=await loadPrepared(window.date,
    {token:githubToken,repository,fetchImpl,now});}catch{}
  const cached=rawPrepared?sanitizePreclose(window.date,rawPrepared):null;
  let {nh:rows=[],secondary=[],domestic=[],stocks=[],macros=[],markets=[]}=cached||{};
  // Latest 17:00 overseas quotes must never come from the 16:50 EOD artifact.
  let futures=[],rates=[],vkospi=[],turnover=[],liquidity=null,investors=null,fearGreed=null;
  const usedCache=Boolean(cached&&Object.values(cached).some(x=>x.length));
  const failedGroups=[];
  const sourceReasons=[];
  const krxDailyPublished=isKrxDailyPublicationEligible(window.date,now());
  // Only the built-in KRX Open API reader is skipped. Dependency-injected
  // sources in offline tests or later approved timely provider remain eligible.
  const onSourceReason=detail=>{
    const safe=sanitizeCloseOptionalSourceReason(detail);
    if(safe&&sourceReasons.length<12)sourceReasons.push(safe);
  };
  const combine=(oldRows,liveRows,key)=>{
   const byKey=new Map(oldRows.map(x=>[x[key],x]));
   for(const x of liveRows)byKey.set(x[key],x);
   return [...byKey.values()];
  };
  const normalize=(key,items)=>sanitizePreclose(window.date,{[key]:items})?.[key]||[];
  await Promise.all([
   (async()=>{if(rows.length===3)return;try{rows=combine(rows,normalize('nh',
    await fetchNh(window.date,{url:gasUrl,token:gasToken,fetchImpl})),'symbol');}
    catch{failedGroups.push('NH');}})(),
   (async()=>{if(secondary.length===3)return;try{secondary=combine(secondary,normalize('secondary',
    await fetchSecondary(window.date,{fetchImpl})),'label');}
    catch{failedGroups.push('SECONDARY');}})(),
   (async()=>{if(domestic.length===3)return;try{domestic=combine(domestic,normalize('domestic',
    await fetchDomestic(window.date,{fetchImpl,now,gasUrl,gasToken})),'label');}
    catch{failedGroups.push('DOMESTIC');}})(),
   (async()=>{if(stocks.length===4)return;try{stocks=combine(stocks,normalize('stocks',
    await fetchStocks(window.date,{url:gasUrl,token:gasToken,fetchImpl,
      onDiagnostic:details=>console.log(JSON.stringify({kind:'NH_CLOSE_STOCK_READ',...details}))})),'id');}
    catch{failedGroups.push('STOCKS');}})(),
   (async()=>{if(macros.length===3)return;try{macros=combine(macros,normalize('macros',
    await fetchMacros(window.date,{fetchImpl,now})),'id');}
    catch{failedGroups.push('MACROS');}})(),
   (async()=>{if(markets.length===5)return;try{markets=combine(markets,normalize('markets',
    await fetchMarkets(window.date,{fetchImpl,now})),'id');}
    catch{failedGroups.push('MARKETS');}})(),
   (async()=>{try{futures=await fetchFutures(window.date,{fetchImpl,now});}
    catch{futures=[];}})(),
   (async()=>{try{rates=verifyTreasuryCurve(window.date,await fetchRates(window.date,{fetchImpl,onDiagnostic:onSourceReason}));}
    catch{rates=[];}})(),
   (async()=>{try{
      if(!krxDailyPublished&&fetchVkospi===readClosingVkospi){
       onSourceReason({kind:'VKOSPI_READ',status:'KRX_TPLUSONE_NOT_PUBLISHED'});
       vkospi=[];return;
      }
      vkospi=verifyClosingVkospi(window.date,
       await fetchVkospi(window.date,{url:gasUrl,token:gasToken,fetchImpl,now,
        onDiagnostic:onSourceReason}));
     }catch{failedGroups.push('VKOSPI');}})(),
   (async()=>{try{
      if(!krxDailyPublished&&fetchTurnover===readClosingKrxTurnoverFromGas){
       onSourceReason({kind:'KRX_TURNOVER_READ',status:'KRX_TPLUSONE_NOT_PUBLISHED'});
       turnover=[];return;
      }
      turnover=verifyOfficialKrxTurnover(window.date,
       await fetchTurnover(window.date,{url:gasUrl,token:gasToken,fetchImpl,now,
        onDiagnostic:onSourceReason}));
     }catch{turnover=[];failedGroups.push('TURNOVER');}})(),
    (async()=>{fearGreed=await readFearGreed({fetchImpl,now});})(),
    (async()=>{try{liquidity=await fetchLiquidity(window.date,{fetchImpl});}
       catch{liquidity=null;}})(),
    (async()=>{try{investors=await fetchInvestorFlows(window.date,{mode:'close',fetchImpl,now});}
       catch{investors=null;}})()
  ]);
  // Real provider reasons remain in Actions logs only; never in Telegram.
  // A zero count is a genuine missing reading, not proof of a broken provider.
  console.log(JSON.stringify({kind:'CLOSE_OPTIONAL_SOURCE_READ',date:window.date,
    futures:futures.length,treasury:rates.length,vkospi:vkospi.length,
    turnover:turnover.length,investorMarkets:investors?.markets?.length||0,
    kofiaDeposits:Boolean(liquidity?.deposits),kofiaMargin:Boolean(liquidity?.margin),
    sourceReasons}));
  const verified=verifiedNhCloseRows(window.date,rows);
  const domesticVerified=verifiedDomesticCloseRows(window.date,domestic);
  const coverage=summarizeCloseCoverage(window.date,{nh:verified,domestic:domesticVerified,
   secondary,stocks,macros,markets,rates,vkospi,turnover,liquidity,investors,
   expectedUsDate:expectedMorningDate('SPX',window.date),failedGroups});
  const quality=closeQualityDecision(coverage);
  const after=closeWindow(now());
  if(!after.allowed||after.date!==window.date)throw Error('TELEGRAM_CLOSE_LATE');
  if(!quality.currentDeliveryGateSatisfied)
    return {ready:false,status:'NO_VERIFIED_INDEX_CLOSE',date:window.date,coverage,quality};
  // Do not delay a near-deadline SEND. At 17:28:30 KST or later,
  // take only evidence already resolved by the normal market reads.
  const remainingMs=Date.parse(window.date+'T17:28:30+09:00')-now().getTime();
  const financialEvidence=await settleOptionalCloseFinance(
    optionalFinancialEvidence,Math.min(1800,Math.max(0,remainingMs)));
  // Recheck after the optional read: a late archive must never arm a claim.
  const finalClock=closeWindow(now());
  if(!finalClock.allowed||finalClock.date!==window.date)
    throw Error('TELEGRAM_CLOSE_LATE');
  return {ready:true,status:'PREPARED',date:window.date,artifactName,
    nhConfirmed:verified.length,domesticConfirmed:domesticVerified.length,
    coverage,quality,cacheSource:usedCache?'VERIFIED_1650_ARTIFACT':'LIVE_ONLY',
    futuresCount:futures.length,ratesCount:rates.length,vkospiCount:vkospi.length,
    turnoverCount:turnover.length,
    liquidityStatus:{deposits:Boolean(liquidity?.deposits),margin:Boolean(liquidity?.margin)},
    investorMarkets:investors?.markets?.length||0,
    // Market-only public rows; no tokens, accounts or GAS ledger data. The
    // send step re-renders AI/US futures at the actual transmission time.
    reportInputs:{nh:verified,secondary,domestic:domesticVerified,stocks,macros,markets,futures,rates,vkospi,turnover,liquidity,investors,fearGreed,...(financialEvidence?{financialEvidence}:{})},
    message:formatClose(window.date,verified,secondary,domesticVerified,stocks,macros,markets,futures,now(),rates,vkospi,fearGreed,financialEvidence,turnover,liquidity,investors)};
}
// Only the already-armed 16:35 runner uses this bounded wait when today's
// core index closes are not yet published. Existing claim and SEND guards
// remain unchanged; reference-only prices never authorize a delivery.
export async function prepareArmedCloseWithRetry(prepare,{
 now=()=>new Date(),sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),
 retryMs=180000,maxAttempts=8}={}){
 if(typeof prepare!=='function'||!Number.isSafeInteger(retryMs)||retryMs<1000||
   !Number.isSafeInteger(maxAttempts)||maxAttempts<1||maxAttempts>8)
   throw Error('TELEGRAM_CLOSE_RETRY_CONFIG');
 const first=closeWindow(now());
 if(!first.allowed)return {ready:false,status:'OUTSIDE_DELIVERY_WINDOW',date:first.date};
 const deadline=Date.parse(first.date+'T17:22:00+09:00');
 for(let attempt=1;attempt<=maxAttempts;attempt++){
  const current=closeWindow(now());
  if(!current.allowed||current.date!==first.date)
    return {ready:false,status:'WINDOW_EXPIRED',date:first.date};
  const result=await prepare();
  if(result?.ready||result?.status!=='NO_VERIFIED_INDEX_CLOSE')return result;
  const nextAt=now().getTime()+retryMs;
  if(attempt>=maxAttempts||nextAt>=deadline)return result;
  console.log(JSON.stringify({kind:'CLOSE_ARM_CORE_RETRY',date:first.date,
    attempt,status:'NO_VERIFIED_INDEX_CLOSE'}));
  await sleep(retryMs);
 }
 throw Error('TELEGRAM_CLOSE_RETRY_BOUND');
}
export async function deliverClose(payload,{now=()=>new Date(),token,chatId,attempt=1,send=sendTelegram}={}){
  const window=closeWindow(now());
  if(Number(attempt)!==1||!window.allowed||payload?.date!==window.date||payload?.artifactName!=='telegram-close-claim-'+window.date||!(Number.isSafeInteger(payload.nhConfirmed)&&payload.nhConfirmed>=0&&payload.nhConfirmed<=3)
  ||!(Number.isSafeInteger(payload.domesticConfirmed)&&payload.domesticConfirmed>=0&&payload.domesticConfirmed<=3)
  ||payload.nhConfirmed+payload.domesticConfirmed<1
  ||typeof payload.message!=='string'||!payload.message.length||payload.message.length>4000)throw Error('TELEGRAM_CLOSE_PAYLOAD_INVALID');
  let outgoing=payload.message,optionalDisplay=null;
  // All new live-futures payloads require the original public market inputs.
  // Recheck intraday quote age at SEND (not PREPARE) time; refresh the entire
  // AI commentary and futures block together. Older EOD-only payloads retain
  // the original compatibility path and cannot introduce a new futures quote.
  if(Object.hasOwn(payload,'futuresCount')){
    const r=payload.reportInputs;
    if(!r||typeof r!=='object'||!['nh','secondary','domestic','stocks','macros','markets','futures']
      .every(k=>Array.isArray(r[k]))||r.futures.length>4
      ||r.futures.length!==payload.futuresCount)throw Error('TELEGRAM_CLOSE_PAYLOAD_INVALID');
    const fresh=sanitizePreclose(window.date,r);
    if(!fresh)throw Error('TELEGRAM_CLOSE_PAYLOAD_INVALID');
    const rates=Array.isArray(r.rates)?verifyTreasuryCurve(window.date,r.rates):[];
    if((r.rates!==undefined&&!Array.isArray(r.rates))||
      (Array.isArray(r.rates)&&r.rates.length!==rates.length))
      throw Error('TELEGRAM_CLOSE_PAYLOAD_INVALID');
    const vkospi=Array.isArray(r.vkospi)?verifyClosingVkospi(window.date,r.vkospi):[];
    if((r.vkospi!==undefined&&!Array.isArray(r.vkospi))
      ||(Array.isArray(r.vkospi)&&r.vkospi.length!==vkospi.length)
      ||(payload.vkospiCount!==undefined&&payload.vkospiCount!==vkospi.length))
      throw Error('TELEGRAM_CLOSE_PAYLOAD_INVALID');
    // The public exact-date KRX turnover rows are optional. Do not allow a
    // forged/duplicated, stale or changed-count PREPARE payload to reach SEND.
    const turnover=Array.isArray(r.turnover)?verifyOfficialKrxTurnover(window.date,r.turnover):[];
    if((r.turnover!==undefined&&!Array.isArray(r.turnover))
      ||(Array.isArray(r.turnover)&&r.turnover.length!==turnover.length)
      ||(payload.turnoverCount!==undefined&&payload.turnoverCount!==turnover.length))
      throw Error('TELEGRAM_CLOSE_PAYLOAD_INVALID');
    // Recheck CNN reading at SEND time; stale inputs simply show 'unavailable'.
    const fearGreed=verifyFearGreed(r.fearGreed,{now:now()});
    const evidence=r.financialEvidence?.asOfKst===window.date
      &&r.financialEvidence.usSessionDate===expectedMorningDate('SPX',window.date)
       ?r.financialEvidence:null;
    outgoing=formatClose(window.date,fresh.nh,fresh.secondary,fresh.domestic,
      fresh.stocks,fresh.macros,fresh.markets,r.futures,now(),rates,vkospi,fearGreed,evidence,turnover,r.liquidity||null,r.investors||null);
    if(!outgoing||outgoing.length>4000)throw Error('TELEGRAM_CLOSE_PAYLOAD_INVALID');
    optionalDisplay=summarizeOptionalDelivery('close',{
      futures:selectCurrentFuturesRows(window.date,r.futures,now()).length,
      treasury:rates.length,vkospi:vkospi.length,
      turnover:turnover.length,
      liquidity:Number(Boolean(r.liquidity?.deposits))
        +Number(Boolean(r.liquidity?.margin)),
      investors:r.investors?.markets?.length||0
    },outgoing);
  }
  await send(token,chatId,outgoing);
  console.log(JSON.stringify({kind:'CLOSE_FINANCIAL_SENT_AUDIT',
    date:window.date,...auditSentFinancialEvidence(outgoing,
     expectedMorningDate('SPX',window.date))}));
  // Only successful sends are logged, and only verified source counts/status.
  // Never include quote values, dates of private records or message content.
  if(optionalDisplay)console.log(JSON.stringify({
    kind:'CLOSE_OPTIONAL_SENT_AUDIT',date:window.date,groups:optionalDisplay.groups
  }));
  // The latest report is re-rendered at SEND time. Log only the included
  // optional-indicator status, never the public score, token or full payload.
  const sentimentStatus=Object.hasOwn(payload,'futuresCount')
    ? fearGreedDisplayStatus(outgoing) : 'LEGACY_UNVERIFIED';
  console.log(JSON.stringify({kind:'CNN_FEAR_GREED_DELIVERY',briefing:'close',
    date:window.date,status:sentimentStatus}));
  return {status:'SENT',date:window.date};
}
// Late GitHub cron enqueue is expected occasionally. Do not report a false
// delivery failure when PREPARE starts after the guarded 17:00 window.
// SEND is deliberately excluded: if a claim exists but the send is too late,
// preserve the original hard failure and missing-SENT signal.
export function skipLateClosePrepare(mode,event,instant){
 return mode==='prepare'
  &&['schedule','workflow_dispatch'].includes(event)
  &&!closeWindow(instant).allowed;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    const invokedAt=new Date();
    const event=JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH,'utf8'));
    const eligible=deliveryTrigger('close',process.env,event,
      closeWindow(invokedAt).allowed);
    const latePrepare=skipLateClosePrepare(process.argv[2],
      process.env.GITHUB_EVENT_NAME,invokedAt);
    if(!eligible||latePrepare){
      if(process.argv[2]==='prepare')fs.appendFileSync(process.env.GITHUB_OUTPUT,'ready=false\n');
      if(latePrepare&&process.env.GITHUB_EVENT_NAME==='schedule'){
        // GitHub may start cron hours late. A green skip is only honest
        // when the authenticated SENT archive for the target close exists.
        // This gate NEVER sends or claims Telegram on a late execution.
        const proof=await verifyLateCloseSent({
          now:invokedAt,repository:process.env.GITHUB_REPOSITORY,
          token:process.env.GITHUB_TOKEN});
        console.log(JSON.stringify(proof));
        if(process.env.GITHUB_STEP_SUMMARY)fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
          'Closing schedule outside delivery window: '+proof.status+
          ' / target KRX session '+proof.date+' (Telegram sends 0)\n');
        process.exit(proof.verified?0:1);
      }
      console.log(JSON.stringify({status:'OUTSIDE_DELIVERY_WINDOW',
        telegramSends:0}));
      process.exit(0);
    }
    if(process.argv[2]==='prepare'){
      const args={githubToken:process.env.GITHUB_TOKEN,repository:process.env.GITHUB_REPOSITORY,
        attempt:process.env.GITHUB_RUN_ATTEMPT,loadPrepared:loadPreparedClose,
        loadFinancialEvidence:loadAiFinancialEvidenceArtifact};
      const armed=process.argv[3]==='armed';
      if(armed&&process.env.GITHUB_WORKFLOW!=='Telegram close early-armed fallback')
        throw Error('TELEGRAM_CLOSE_RETRY_CONFIG');
      const result=armed
        ?await prepareArmedCloseWithRetry(()=>prepareClose(args))
        :await prepareClose(args);
      if(result.ready){fs.mkdirSync('.telegram-close-runtime',{recursive:true});fs.writeFileSync('.telegram-close-runtime/payload.json',JSON.stringify(result));fs.writeFileSync('.telegram-close-runtime/claim.json',JSON.stringify({date:result.date,runId:process.env.GITHUB_RUN_ID}));}
      fs.appendFileSync(process.env.GITHUB_OUTPUT,`ready=${result.ready}\nartifact_name=${result.artifactName||''}\n`);
      console.log(JSON.stringify({status:result.status,date:result.date,
        nhConfirmed:result.nhConfirmed||0,domesticConfirmed:result.domesticConfirmed||0,
        coreCoverage:result.coverage?.core||null,referenceCoverage:result.coverage?.reference||null,
        stockCoverage:result.coverage?.stocks||null,macroCoverage:result.coverage?.macros||null,
        marketCoverage:result.coverage?.markets||null,futuresCount:result.futuresCount||0,
        cacheSource:result.cacheSource||'NONE',vkospiCount:result.vkospiCount||0,
        sourceStatuses:result.coverage?.statuses||null,failedGroups:result.coverage?.groupErrors||[]}));
    }else if(process.argv[2]==='send'){
      const payload=JSON.parse(fs.readFileSync('.telegram-close-runtime/payload.json','utf8'));
      const sent=await deliverAndRecordWeekday(payload,{
        kind:'close',deliver:deliverClose,
        token:process.env.TELEGRAM_BOT_TOKEN,chatId:process.env.TELEGRAM_CHAT_ID,
        attempt:process.env.GITHUB_RUN_ATTEMPT,
        path:'.telegram-close-runtime/sent.json',runId:process.env.GITHUB_RUN_ID||''
      });
      console.log(JSON.stringify(sent));
    }else throw Error('TELEGRAM_CLOSE_MODE_INVALID');
  }catch(e){console.error(/^TELEGRAM_CLOSE_[A-Z_]+$/.test(e?.message||'')?e.message:'TELEGRAM_CLOSE_FAILED');process.exitCode=1;}
}
