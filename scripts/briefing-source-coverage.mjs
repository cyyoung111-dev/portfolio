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
const extraMarkets=Object.freeze([
 ['WTI','WTI','CL=F'],['BRENT','Brent','BZ=F'],['GOLD','금','GC=F'],
 ['COPPER','구리','HG=F'],['BTC','BTC','BTC-USD']
]);
const unwired=Object.freeze([
  'VKOSPI',
  'UST2Y','UST3Y','YIELD_SPREAD',
  'KRX_TURNOVER',
  'FOREIGN_INSTITUTION_FLOW','INVESTOR_DEPOSITS','MARGIN_BALANCE',
  'US_INDEX_FUTURES'
]);

export const CLOSE_SOURCE_CATALOG=Object.freeze({
  core:Object.freeze(core.map(([id,label,market])=>Object.freeze({id,label,market,role:'REQUIRED_INDEX'}))),
  reference:Object.freeze(references.map(([id,label,source])=>Object.freeze({id,label,source,role:'OPTIONAL_REFERENCE'}))),
  extraStocks:Object.freeze(extraStocks.map(([id,label,symbol])=>Object.freeze({id,label,symbol,role:'OPTIONAL_STOCK'}))),
  extraMacros:Object.freeze(extraMacros.map(([id,label,symbol])=>Object.freeze({id,label,symbol,role:'OPTIONAL_MACRO'}))),
  extraMarkets:Object.freeze(extraMarkets.map(([id,label,symbol])=>Object.freeze({id,label,symbol,role:'OPTIONAL_MARKET'}))),
  notConnected:Object.freeze([...unwired])
});
export const MORNING_NOT_CONNECTED=Object.freeze([
  'US_INDEX_FUTURES','KRX_TURNOVER','FOREIGN_INSTITUTION_FLOW',
  'MARKET_BREADTH','ADR20','VKOSPI','UST2Y','UST3Y','YIELD_SPREAD',
  'INVESTOR_DEPOSITS','MARGIN_BALANCE'
]);

const allowedFailureGroups=new Set(['NH','DOMESTIC','SECONDARY','STOCKS','MACROS','MARKETS']);
const validRow=r=>r&&Number.isFinite(r.value)&&r.value>0;
function state(found,failed){
  return found?'VERIFIED':failed?'FETCH_FAILED':'NO_VERIFIED_ROW';
}
export function summarizeCloseCoverage(date,{nh=[],domestic=[],secondary=[],stocks=[],macros=[],markets=[],expectedUsDate=null,
  failedGroups=[]}={}){
  if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)
    ||!Array.isArray(nh)||!Array.isArray(domestic)||!Array.isArray(secondary)
    ||!Array.isArray(stocks)||!Array.isArray(macros)||!Array.isArray(markets)
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
    const rows=secondary.filter(x=>x?.label===entry.label&&x?.source===entry.source
      &&x?.role==='NON_NH_REFERENCE_ONLY'&&x?.date===expectedUsDate&&validRow(x));
    statuses.push({id:entry.id,role:entry.role,
      status:state(rows.length===1,failed.has('SECONDARY'))});
  }
  for(const entry of CLOSE_SOURCE_CATALOG.extraStocks){
    const rows=stocks.filter(x=>x?.id===entry.id&&x.label===entry.label
      &&x.symbol===entry.symbol&&x.source==='NH_REGULAR_CLOSE'
      &&x.date===(entry.id==='SAMSUNG'||entry.id==='SKHYNIX'?date:expectedUsDate)
      &&validRow(x));
    statuses.push({id:entry.id,role:entry.role,status:state(rows.length===1,failed.has('STOCKS'))});
  }
  for(const entry of CLOSE_SOURCE_CATALOG.extraMacros){
    const rows=macros.filter(x=>x?.id===entry.id&&x.label===entry.label
      &&x.symbol===entry.symbol&&x.source==='YAHOO_DAILY_REFERENCE'
      &&(entry.id!=='UST10Y'||x.value<20)
      &&x.date===expectedUsDate&&validRow(x));
    statuses.push({id:entry.id,role:entry.role,status:state(rows.length===1,failed.has('MACROS'))});
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
   ...CLOSE_SOURCE_CATALOG.extraMarkets
  ].map(x=>[x.id,x.label]));
  const missing=coverage.statuses.filter(x=>x.status!=='VERIFIED'
    &&x.status!=='NOT_CONNECTED').map(x=>displayNames[x.id]||x.id);
  const notConnected=coverage.statuses.filter(x=>x.status==='NOT_CONNECTED').length;
  return [
    '■ 데이터 확인: 핵심지수 '+c.verified+'/'+c.total
      +' (국내 '+c.domestic+'/3 · 미국 '+c.us+'/3)'
      +' · 참고 '+aux.verified+'/'+aux.total
      +' · 주요 종목 '+coverage.stocks.verified+'/4 · 환율·금리 '+coverage.macros.verified+'/3'
      +' · 원자재/BTC '+coverage.markets.verified+'/5',
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
