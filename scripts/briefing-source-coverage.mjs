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
const unwired=Object.freeze([
  'VKOSPI','SAMSUNG','SKHYNIX','NVDA','MU',
  'USDKRW','DXY','UST2Y','UST3Y','UST10Y','YIELD_SPREAD',
  'WTI','BRENT','GOLD','COPPER','BTC','KRX_TURNOVER',
  'FOREIGN_INSTITUTION_FLOW','INVESTOR_DEPOSITS','MARGIN_BALANCE',
  'US_INDEX_FUTURES'
]);

export const CLOSE_SOURCE_CATALOG=Object.freeze({
  core:Object.freeze(core.map(([id,label,market])=>Object.freeze({id,label,market,role:'REQUIRED_INDEX'}))),
  reference:Object.freeze(references.map(([id,label,source])=>Object.freeze({id,label,source,role:'OPTIONAL_REFERENCE'}))),
  notConnected:Object.freeze([...unwired])
});
export const MORNING_NOT_CONNECTED=Object.freeze([
  'US_INDEX_FUTURES','KRX_TURNOVER','FOREIGN_INSTITUTION_FLOW',
  'MARKET_BREADTH','ADR20','VKOSPI','UST2Y','UST3Y','YIELD_SPREAD',
  'INVESTOR_DEPOSITS','MARGIN_BALANCE'
]);

const allowedFailureGroups=new Set(['NH','DOMESTIC','SECONDARY']);
const validRow=r=>r&&Number.isFinite(r.value)&&r.value>0;
function state(found,failed){
  return found?'VERIFIED':failed?'FETCH_FAILED':'NO_VERIFIED_ROW';
}
export function summarizeCloseCoverage(date,{nh=[],domestic=[],secondary=[],expectedUsDate=null,
  failedGroups=[]}={}){
  if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)
    ||!Array.isArray(nh)||!Array.isArray(domestic)||!Array.isArray(secondary)
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
  for(const id of CLOSE_SOURCE_CATALOG.notConnected)
    statuses.push({id,role:'NOT_CONNECTED',status:'NOT_CONNECTED'});
  const verified=id=>statuses.find(x=>x.id===id)?.status==='VERIFIED';
  const domesticCount=core.slice(0,3).filter(([id])=>verified(id)).length;
  const usCount=core.slice(3).filter(([id])=>verified(id)).length;
  return {
    schemaVersion:1,sessionDate:date,expectedUsDate,
    core:{verified:domesticCount+usCount,total:6,domestic:domesticCount,us:usCount},
    reference:{verified:references.filter(([id])=>verified(id)).length,total:3},
    groupErrors:[...failed].sort(),
    statuses,
  };
}
export function formatCloseCoverageSummary(coverage){
  if(coverage?.schemaVersion!==1||!Array.isArray(coverage.statuses))
    throw Error('BRIEFING_COVERAGE_SCHEMA_INVALID');
  const c=coverage.core,aux=coverage.reference;
  return [
    '■ 데이터 QC: 핵심지수 '+c.verified+'/'+c.total
      +' (국내 '+c.domestic+'/3 · 미국 '+c.us+'/3)'
      +' · 참고 '+aux.verified+'/'+aux.total,
    '핵심 미확보: '+(coverage.statuses.filter(x=>x.role==='REQUIRED_INDEX'
      &&x.status!=='VERIFIED').map(x=>x.id+':'+x.status).join(', ')||'없음'),
    '미연결: '+coverage.statuses.filter(x=>x.status==='NOT_CONNECTED').map(x=>x.id).join(', '),
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
