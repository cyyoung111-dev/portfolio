import {validClosingStockReference} from './closing-extra-daily-sources.mjs';
import {verifyTreasuryCurve} from './closing-us-treasury-curve.mjs';
import {verifyOfficialKrxTurnover} from './closing-krx-turnover.mjs';
// Read-only coverage inventory. "Connected" means that a production formatter
// has a validated source path, NOT that the provider returned data today.
// Never log raw provider bodies, credentials, prices or private portfolio rows.
const core=Object.freeze([
  ['KOSPI','KOSPI','KR'],['KOSDAQ','KOSDAQ','KR'],['KOSPI200','KOSPI 200','KR'],
  ['SPX','S&P 500','US'],['NASDAQ','NASDAQ','US'],['NDX','NASDAQ100','US']
]);
const references=Object.freeze([
  ['DOW','다우존스','FRED_DJIA'],
  ['SOX','SOX','FRED_NASDAQSOX'],
  ['VIX','VIX','CBOE_VIX_DAILY']
]);
const extraStocks=Object.freeze([
  ['SAMSUNG','삼성전자','005930.KS'],['SKHYNIX','SK하이닉스','000660.KS'],
  ['NVDA','엔비디아','NVDA'],['MU','마이크론','MU']
]);
const extraMacros=Object.freeze([
  ['USDKRW','원/달러','KRW=X'],['DXY','DXY','DX-Y.NYB'],['UST10Y','미 10년물','^TNX']
]);
const rateIds=Object.freeze([['UST2Y','미 국채 2년'],['UST3Y','미 국채 3년'],['YIELD_SPREAD','장단기금리차']]);
const extraMarkets=Object.freeze([
 ['WTI','WTI','CL=F'],['BRENT','Brent','BZ=F'],['GOLD','금','GC=F'],
 ['COPPER','구리','HG=F'],['BTC','BTC','BTC-USD']
]);
const turnoverMarkets=Object.freeze([['KOSPI','코스피 거래대금'],['KOSDAQ','코스닥 거래대금']]);
const unwired=Object.freeze([
  'FOREIGN_INSTITUTION_FLOW','INVESTOR_DEPOSITS','MARGIN_BALANCE'
]);

export const CLOSE_SOURCE_CATALOG=Object.freeze({
  core:Object.freeze(core.map(([id,label,market])=>Object.freeze({id,label,market,role:'REQUIRED_INDEX'}))),
  reference:Object.freeze(references.map(([id,label,source])=>Object.freeze({id,label,source,role:'OPTIONAL_REFERENCE'}))),
  extraStocks:Object.freeze(extraStocks.map(([id,label,symbol])=>Object.freeze({id,label,symbol,role:'OPTIONAL_STOCK'}))),
  extraMacros:Object.freeze(extraMacros.map(([id,label,symbol])=>Object.freeze({id,label,symbol,role:'OPTIONAL_MACRO'}))),
  extraMarkets:Object.freeze(extraMarkets.map(([id,label,symbol])=>Object.freeze({id,label,symbol,role:'OPTIONAL_MARKET'}))),
  treasuryRates:Object.freeze(rateIds.map(([id,label])=>Object.freeze({id,label,role:'OPTIONAL_MACRO'}))),
  volatility:Object.freeze([{id:'VKOSPI',label:'VKOSPI',role:'OPTIONAL_REFERENCE'}]),
  turnover:Object.freeze(turnoverMarkets.map(([market,label])=>Object.freeze({
    id:'KRX_TURNOVER_'+market,label,market,role:'OPTIONAL_REFERENCE'}))),
  notConnected:Object.freeze([...unwired])
});
// Connected means formatter + validated read-only provider exist. It does
// NOT imply that an authorized key or same-day observation is available.
export const MORNING_OPTIONAL_CONNECTED=Object.freeze([
  'US_INDEX_FUTURES','KRX_TURNOVER','MARKET_BREADTH',
  'VKOSPI','UST2Y','UST3Y','YIELD_SPREAD'
]);
export const MORNING_NOT_CONNECTED=Object.freeze([
  'FOREIGN_INSTITUTION_FLOW','ADR20','INVESTOR_DEPOSITS','MARGIN_BALANCE',
  'FEDWATCH','FINVIZ_HEATMAP','ECONOMIC_EVENTS'
]);

const allowedFailureGroups=new Set(['NH','DOMESTIC','SECONDARY','STOCKS','MACROS','MARKETS','VKOSPI','TURNOVER']);
const validRow=r=>r&&Number.isFinite(r.value)&&r.value>0;
function state(found,failed){
  return found?'VERIFIED':failed?'FETCH_FAILED':'NO_VERIFIED_ROW';
}
export function summarizeCloseCoverage(date,{nh=[],domestic=[],secondary=[],stocks=[],macros=[],markets=[],rates=[],vkospi=[],turnover=[],expectedUsDate=null,
  failedGroups=[]}={}){
  if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)
    ||!Array.isArray(nh)||!Array.isArray(domestic)||!Array.isArray(secondary)
    ||!Array.isArray(stocks)||!Array.isArray(macros)||!Array.isArray(markets)||!Array.isArray(rates)||!Array.isArray(vkospi)||!Array.isArray(turnover)
    ||!Array.isArray(failedGroups)||failedGroups.some(x=>!allowedFailureGroups.has(x))
    ||(expectedUsDate!==null&&(typeof expectedUsDate!=='string'
      ||!/^\d{4}-\d{2}-\d{2}$/.test(expectedUsDate))))
    throw Error('BRIEFING_COVERAGE_INPUT_INVALID');
  const failed=new Set(failedGroups),statuses=[];
  for(const entry of CLOSE_SOURCE_CATALOG.core){
    const isKr=entry.market==='KR';
    const rows=(isKr?domestic:nh).filter(x=>
      x?.label===entry.label&&x?.date===(isKr?date:expectedUsDate)&&validRow(x));
    statuses.push({id:entry.id,role:entry.role,
      status:state(rows.length===1,failed.has(isKr?'DOMESTIC':'NH'))});
  }
  for(const entry of CLOSE_SOURCE_CATALOG.reference){
    const rows=secondary.filter(x=>x?.label===entry.label&&(x?.source===entry.source||(entry.id==='SOX'&&x?.source==='YAHOO_SOX_DAILY_REFERENCE'))
      &&x?.role==='NON_NH_REFERENCE_ONLY'&&x?.date===expectedUsDate&&validRow(x));
    statuses.push({id:entry.id,role:entry.role,
      status:state(rows.length===1,failed.has('SECONDARY'))});
  }
  for(const entry of CLOSE_SOURCE_CATALOG.extraStocks){
    const rows=stocks.filter(x=>x?.id===entry.id&&x.label===entry.label
      &&x.symbol===entry.symbol&&x.date===(entry.id==='SAMSUNG'||entry.id==='SKHYNIX'?date:expectedUsDate)
      &&validClosingStockReference(date,x));
    statuses.push({id:entry.id,role:entry.role,status:state(rows.length===1,failed.has('STOCKS'))});
  }
  for(const entry of CLOSE_SOURCE_CATALOG.extraMacros){
    const rows=macros.filter(x=>x?.id===entry.id&&x.label===entry.label
      &&x.symbol===entry.symbol&&x.source==='YAHOO_DAILY_REFERENCE'
      &&(entry.id!=='UST10Y'||x.value<20)
      &&x.date===expectedUsDate&&validRow(x));
    const fred10=entry.id==='UST10Y'&&rates.filter(x=>x?.id==='UST10Y_FRED'
      &&x.label==='미 국채 10년'&&x.source==='FRED_H15_DAILY'
      &&x.date===expectedUsDate&&validRow(x)&&x.value<30).length===1;
    statuses.push({id:entry.id,role:entry.role,status:state(rows.length===1||fred10,failed.has('MACROS'))});
  }
  for(const entry of CLOSE_SOURCE_CATALOG.extraMarkets){
    const expected=entry.id==='BTC'
      ?new Date(Date.parse(date+'T00:00:00Z')-86400000).toISOString().slice(0,10)
      :expectedUsDate;
    const rows=markets.filter(x=>x?.id===entry.id&&x.label===entry.label
      &&x.symbol===entry.symbol&&x.source==='YAHOO_DAILY_REFERENCE'
      &&x.date===expected&&validRow(x));
    statuses.push({id:entry.id,role:entry.role,status:state(rows.length===1,failed.has('MARKETS'))});
  }
  // H.15 can be published after its observation day. Use the same dated
  // validator as the displayed Treasury panel instead of requiring yesterday's
  // US close for every rate. Never compute a spread across different dates.
  const verifiedRates=verifyTreasuryCurve(date,rates);
  const rate=id=>verifiedRates.find(x=>x.id===id)||null;
  const rate2=rate('UST2Y'),rate3=rate('UST3Y'),rate10=rate('UST10Y_FRED');
  for(const [id] of rateIds)
    statuses.push({id,role:'OPTIONAL_MACRO',status:state(
      id==='UST2Y'?Boolean(rate2):id==='UST3Y'?Boolean(rate3)
        :Boolean(rate2&&rate10&&rate2.date===rate10.date),false)});
  const volatilityRows=vkospi.filter(x=>x?.id==='VKOSPI'&&x.label==='VKOSPI'
    &&x.date===date&&x.source==='KRX_OFFICIAL'
    &&x.role==='NON_NH_REFERENCE_ONLY'&&Number.isFinite(x.value)
    &&x.value>0&&x.value<200);
  statuses.push({id:'VKOSPI',role:'OPTIONAL_REFERENCE',
    status:state(volatilityRows.length===1,failed.has('VKOSPI'))});
  const acceptedTurnover=verifyOfficialKrxTurnover(date,turnover);
  for(const entry of CLOSE_SOURCE_CATALOG.turnover)
    statuses.push({id:entry.id,role:entry.role,
      status:state(acceptedTurnover.some(x=>x.market===entry.market),failed.has('TURNOVER'))});
  for(const id of CLOSE_SOURCE_CATALOG.notConnected)
    statuses.push({id,role:'NOT_CONNECTED',status:'NOT_CONNECTED'});
  const verified=id=>statuses.find(x=>x.id===id)?.status==='VERIFIED';
  const domesticCount=core.slice(0,3).filter(([id])=>verified(id)).length;
  const usCount=core.slice(3).filter(([id])=>verified(id)).length;
  return {
    schemaVersion:1,sessionDate:date,expectedUsDate,
    core:{verified:domesticCount+usCount,total:6,domestic:domesticCount,us:usCount},
    reference:{verified:references.filter(([id])=>verified(id)).length,total:3},
    stocks:{verified:extraStocks.filter(([id])=>verified(id)).length,total:4},
    macros:{verified:extraMacros.filter(([id])=>verified(id)).length,total:3},
    markets:{verified:extraMarkets.filter(([id])=>verified(id)).length,total:5},
    treasury:{verified:rateIds.filter(([id])=>verified(id)).length,total:3},
    volatility:{verified:verified('VKOSPI')?1:0,total:1},
    turnover:{verified:turnoverMarkets.filter(([m])=>verified('KRX_TURNOVER_'+m)).length,total:2},
    groupErrors:[...failed].sort(),
    statuses,
  };
}
export function formatCloseCoverageSummary(coverage){
  if(coverage?.schemaVersion!==1||!Array.isArray(coverage.statuses))
    throw Error('BRIEFING_COVERAGE_SCHEMA_INVALID');
  const c=coverage.core,aux=coverage.reference;
  const displayNames=Object.fromEntries([
   ...CLOSE_SOURCE_CATALOG.core,...CLOSE_SOURCE_CATALOG.reference,
   ...CLOSE_SOURCE_CATALOG.extraStocks,...CLOSE_SOURCE_CATALOG.extraMacros,
   ...CLOSE_SOURCE_CATALOG.extraMarkets,...CLOSE_SOURCE_CATALOG.treasuryRates,
   ...CLOSE_SOURCE_CATALOG.volatility,...CLOSE_SOURCE_CATALOG.turnover
  ].map(x=>[x.id,x.label]));
  const missing=coverage.statuses.filter(x=>x.status!=='VERIFIED'
    &&x.status!=='NOT_CONNECTED').map(x=>displayNames[x.id]||x.id);
  const notConnected=coverage.statuses.filter(x=>x.status==='NOT_CONNECTED').length;
  return [
    '■ 데이터 확인: 핵심지수 '+c.verified+'/'+c.total
      +' (국내 '+c.domestic+'/3 · 미국 '+c.us+'/3)'
      +' · 참고 '+aux.verified+'/'+aux.total
      +' · 주요 종목 '+coverage.stocks.verified+'/4 · 환율·금리 '+coverage.macros.verified+'/3'
      +' · 원자재/BTC '+coverage.markets.verified+'/5'
      +' · 국채금리·스프레드 '+coverage.treasury.verified+'/3'
      +' · VKOSPI '+coverage.volatility.verified+'/1'
      +' · KRX 거래대금 '+coverage.turnover.verified+'/2',
    '미확보: '+(missing.length
      ?missing.length<=8?missing.join(' · '):missing.slice(0,8).join(' · ')+' 외 '+(missing.length-8)+'개'
      :'없음'),
    '미연결 참고지표: '+notConnected+'개 (상세는 시스템 진단 로그)',
  ].join('\n');
}
// "READY" remains the existing gate (>= 1 verified core index) until a
// separately reviewed minimum-quality delivery policy is approved.
export function closeQualityDecision(coverage){
  if(coverage?.schemaVersion!==1||!coverage.core)throw Error('BRIEFING_COVERAGE_SCHEMA_INVALID');
  return Object.freeze({
    currentDeliveryGateSatisfied:coverage.core.verified>=1,
    fullCoreCoverage:coverage.core.verified===coverage.core.total,
    domesticComplete:coverage.core.domestic===3,
    usComplete:coverage.core.us===3
  });
}
