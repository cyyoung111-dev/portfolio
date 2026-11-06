// Diagnostic-only company coverage for the weekday SEC/DART prefetch.
// Whitelist fixed issuer symbols and public status codes. Never copy request
// URLs, user agents, DART tokens, original API payloads, or financial amounts.
const US=Object.freeze(['MSFT','AAPL','GOOGL','AMZN','META','NVDA','MU','ORCL','SNDK']);
const KR=Object.freeze(['005930','000660']);
const NETWORK=Object.freeze(['FETCH_FAILED','SEC_HTTP_UNAVAILABLE',
 'SEC_CONTENT_TYPE_INVALID','SEC_BODY_TOO_LARGE',
 'SEC_USER_AGENT_NOT_CONFIGURED']);
const TTM=new Set([...NETWORK,'VERIFIED_TTM','FY_ONLY','PARTIAL_TTM',
 'NO_REPORTED_ANNUAL_ANCHOR','QUARTER_ANCHOR_CONFLICT']);
const FY=new Set([...NETWORK,'VERIFIED_FY_BPS_PBR','PARTIAL_FY_VALUE','NO_REPORTED_FY']);
const DART=new Set(['DART_KEY_NOT_CONFIGURED','DART_KEY_REJECTED',
 'DART_RATE_LIMITED','DART_HTTP_UNAVAILABLE','DART_FETCH_FAILED',
 'NO_PUBLISHED_REPORT','DART_SCHEMA_UNVERIFIED','DART_IDENTITY_MISMATCH',
 'DART_PERIOD_OR_FILING_UNVERIFIED','DART_PARENT_EQUITY_UNVERIFIED',
 'DART_SHARES_PERIOD_UNVERIFIED','DART_SHARE_CLASSES_UNVERIFIED',
 'DART_SHARE_TOTAL_MISMATCH','DART_BPS_ARITHMETIC_INVALID',
 'INDICATIVE_MULTICLASS_BPS','VERIFIED_SINGLECLASS_BPS']);
function selectStatus(symbols,source,allowed){
 return symbols.map(symbol=>{
  const found=Array.isArray(source?.statuses)
   ?source.statuses.filter(x=>x?.symbol===symbol):[];
  return {symbol,status:found.length===1&&allowed.has(found[0]?.status)
   ?found[0].status:'UNVERIFIED'};
 });
}
export function financialSourceCoverageStatus({ttm,fy,dart}={}){
 return {
  kind:'PUBLIC_SEC_DART_SOURCE_COVERAGE',
  ttm:selectStatus(US,ttm,TTM),
  fyPbr:selectStatus(US,fy,FY),
  domestic:selectStatus(KR,dart,DART)
 };
}
export function isFinancialSourceCoverageStatus(value){
 if(value?.kind!=='PUBLIC_SEC_DART_SOURCE_COVERAGE')return false;
 const test=(key,symbols,allowed)=>{
  const group=value?.[key];
  return Array.isArray(group)&&group.length===symbols.length&&
   group.every((x,i)=>x?.symbol===symbols[i]&&
    (x.status==='UNVERIFIED'||allowed.has(x.status))&&
    Object.keys(x).length===2);
 };
 return Object.keys(value).sort().join(',')==='domestic,fyPbr,kind,ttm'
  &&test('ttm',US,TTM)&&test('fyPbr',US,FY)&&test('domestic',KR,DART);
}
