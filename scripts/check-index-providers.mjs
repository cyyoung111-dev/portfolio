import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync('src/gas/apps_script.gs', 'utf8');
if (!source.includes("KOSDAQ: ['KOSDAQ']")
    || !source.includes("SP500: '^GSPC'")
    || !source.includes("NASDAQ: '^IXIC'")
    || !source.includes("NASDAQ100: '^NDX'")
    || !source.includes("DOW: '^DJI'")) throw new Error('지수 symbol mapping 누락');
const benchmarkBody = source.match(/function handleGetBenchmarks\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/)?.[1] || '';
if (/GOOGLEFINANCE\s*\(/.test(benchmarkBody)) throw new Error('미국/국내 비교지수 운영 경로에 GOOGLEFINANCE가 남아 있습니다.');
if (!source.includes('unofficial endpoint') || !source.includes('TIMEOUT_OR_NETWORK_ERROR')) throw new Error('Yahoo 장애/비공식 endpoint 계약 누락');

const context = vm.createContext({ console, isFinite, Number, String, Array, Date, Math, encodeURIComponent });
new vm.Script(source, { filename: 'src/gas/apps_script.gs' }).runInContext(context);
context.CONFIG = { TIMEZONE: 'UTC' };
context.Utilities = { formatDate: (date,tz,format) => format==='HHmm'?new Date(date).toISOString().slice(11,16).replace(':',''):new Date(date).toISOString().slice(0, 10), sleep: () => {} };
const cache=new Map();
context.CacheService = { getScriptCache: () => ({ get:key=>cache.get(key)||null, put:(key,value)=>cache.set(key,value) }) };

const tossCalls = [];
let candleClose=801;
context._tossRequest_ = (path, query, group) => {
  tossCalls.push({ path, query, group });
  if (path.endsWith('/prices')) return { result: [{ symbol: 'KOSPI', lastPrice: 2600, timestamp: '2026-09-16T06:00:00Z' }, { symbol: 'KOSDAQ', lastPrice: 800, timestamp: '2026-09-16T06:00:00Z' }] };
  return { result: { candles: [{ timestamp: '2026-09-15T06:00:00Z', closePrice: 799 }, { timestamp: '2026-09-16T06:00:00Z', closePrice: candleClose }] } };
};
const prices = context.fetchMarketIndicatorPricesToss(['KOSPI', 'KOSDAQ']);
if (prices.KOSPI.value !== 2600 || prices.KOSDAQ.value !== 800 || tossCalls[0].group !== 'MARKET_INDICATOR') throw new Error('KOSPI/KOSDAQ Toss prices mapping 실패');
const candles = context.fetchMarketIndicatorCandlesToss('KOSDAQ', '2026-09-15', '2026-09-16');
if (candles.length !== 2 || candles[0].value !== 799 || tossCalls[1].query.interval !== '1d') throw new Error('KOSDAQ Toss candles parsing 실패');
candleClose=805;
const staleCandles=context.fetchMarketIndicatorCandlesToss('KOSDAQ','2026-09-15','2026-09-16');
if(staleCandles[1].value!==801)throw new Error('오전 indicator cache 재사용 시나리오 실패');
const freshCandles=context.fetchMarketIndicatorCandlesToss('KOSDAQ','2026-09-15','2026-09-16',true);
if(freshCandles[1].value!==805||tossCalls.filter(call=>call.group==='MARKET_INDICATOR_CHART').length!==2)throw new Error('마감 indicator cache bypass/refresh 실패');
if(freshCandles[1].observedAt!=='2026-09-16T06:00:00.000Z')throw new Error('Toss candle provider timestamp 보존 실패');
if(!/confirmedClose: false/.test(source)||/confirmedClose: !!forceRefresh/.test(source))throw new Error('fresh 요청을 confirmedClose 증거로 사용하면 안 됩니다.');
if(context._isKrxOfficialCloseAvailableTime_(new Date('2026-09-18T15:59:59Z'))!==false||context._isKrxOfficialCloseAvailableTime_(new Date('2026-09-18T16:00:00Z'))!==true)throw new Error('KRX 공식 종가 16:00 publication 경계 실패');
context._getKrxAuthKey=()=> 'test-key';
context.UrlFetchApp={fetchAll:requests=>requests.map(request=>({getResponseCode:()=>200,getContentText:()=>JSON.stringify({OutBlock_1:[request.url.includes('kosdaq_dd_trd')?{BAS_DD:'20260918',IDX_NM:'코스닥',CLSPRC_IDX:'900.25'}:{BAS_DD:'20260918',IDX_NM:'코스피',CLSPRC_IDX:'3,420.50'}]})}))};
const official=context.fetchKrxOfficialIndexCloses(['KOSPI','KOSDAQ'],'2026-09-18');
if(official.KOSPI.value!==3420.5||official.KOSDAQ.value!==900.25||official.KOSPI.source!=='KRX_OFFICIAL'||official.KOSPI.observedAt!=='2026-09-18T15:30:00+09:00')throw new Error('KRX 공식 exact-date 대표지수 종가 파싱 실패');
if(context._isKrxOfficialCloseAvailableTime_(new Date('2026-09-19T07:30:00Z'),'2026-09-18')!==true)
  throw new Error('다음 거래일 장전 직전 KRX 정규장 종가 조회 허용 실패');
if(context._isKrxOfficialCloseAvailableTime_(new Date('2026-09-18T15:59:59Z'),'2026-09-18')!==false)
  throw new Error('당일 16시 이전 KRX 확정 종가 조회 차단 실패');
context.UrlFetchApp={fetchAll:requests=>requests.map(request=>
  request.url.includes('kosdaq_dd_trd')?{getResponseCode:()=>403,getContentText:()=>''}:
  {getResponseCode:()=>200,getContentText:()=>JSON.stringify({OutBlock_1:[{BAS_DD:'20260918',IDX_NM:'코스피',CLSPRC_IDX:'3,420.50'}]})})};
const partialOfficial=context.fetchKrxOfficialIndexCloses(['KOSPI','KOSDAQ'],'2026-09-18');
if(partialOfficial.KOSPI.value!==3420.5||partialOfficial.KOSDAQ||partialOfficial._errors.KOSDAQ!=='HTTP_403')
  throw new Error('KRX 지수 부분 승인 오류 시 성공한 시장 보존 및 403 노출 실패');
context.UrlFetchApp={fetchAll:()=>{throw new Error('simulated KRX timeout');}};
const isolated=context._fetchKrxOfficialIndexClosesSafe_(['KOSPI','KOSDAQ'],'2026-09-18');
if(Object.keys(isolated.data).length||isolated.error!=='simulated KRX timeout')throw new Error('KRX 공식 조회 예외 격리 실패');
context.jsonOk=value=>({status:'ok',...value});context.jsonError=message=>({status:'error',message});
context.UrlFetchApp={fetchAll:requests=>requests.map(request=>({getResponseCode:()=>200,
  getContentText:()=>JSON.stringify({OutBlock_1:[request.url.includes('kosdaq_dd_trd')
    ?{BAS_DD:'20260918',IDX_NM:'코스닥',CLSPRC_IDX:'900.25'}
    :{BAS_DD:'20260918',IDX_NM:'코스피',CLSPRC_IDX:'3,420.50'}]})}))};
context.fetchMarketIndicatorCandlesToss=()=>{throw new Error('Toss OAuth 실패(403)');};
const historicalMorning=context.handleGetBenchmarks('KOSPI,KOSDAQ','2026-09-11','2026-09-18',true);
if(historicalMorning.status!=='ok'||historicalMorning.series.KOSPI.at(-1).value!==3420.5
  ||historicalMorning.series.KOSDAQ.at(-1).value!==900.25
  ||historicalMorning.seriesMeta.KOSPI.confirmedClose!==true)
  throw new Error('Toss 403 시 과거 KRX 정규장 공식 종가 자동 대체 실패');
const krxAttempts=[];
context.UrlFetchApp={fetchAll:requests=>requests.map(request=>{
  const market=request.url.includes('kosdaq_dd_trd')?'KOSDAQ':'KOSPI';
  const date=new URL(request.url).searchParams.get('basDd');
  krxAttempts.push({market,date});
  if(date==='20260918')return {getResponseCode:()=>200,getContentText:()=>JSON.stringify({OutBlock_1:[]})};
  return {getResponseCode:()=>200,getContentText:()=>JSON.stringify({OutBlock_1:[market==='KOSDAQ'
    ?{BAS_DD:'20260917',IDX_NM:'코스닥',CLSPRC_IDX:'890.00'}
    :{BAS_DD:'20260917',IDX_NM:'코스피',CLSPRC_IDX:'3,410.00'}]})};
})};
const missingCalendarDate=context.handleGetBenchmarks('KOSPI,KOSDAQ','2026-09-16','2026-09-18',true);
if(missingCalendarDate.status!=='ok'
  ||missingCalendarDate.series.KOSPI.at(-1).date!=='2026-09-17'
  ||missingCalendarDate.series.KOSDAQ.at(-1).value!==890
  ||missingCalendarDate.seriesMeta.KOSPI.verifiedClosedDates.length!==0
  ||missingCalendarDate.seriesMeta.KOSPI.verificationToDate!=='2026-09-18'
  ||!krxAttempts.some(v=>v.date==='20260917'))
  throw new Error('Codex P2: 원천 200 + 빈 날짜 응답 후 전일 KRX 공식 종가 재조회 실패');
context.UrlFetchApp={fetchAll:requests=>requests.map(request=>{
  const kosdaq=request.url.includes('kosdaq_dd_trd');
  const date=new URL(request.url).searchParams.get('basDd');
  krxAttempts.push({market:kosdaq?'KOSDAQ':'KOSPI',date});
  if(kosdaq)return {getResponseCode:()=>403,getContentText:()=>''};
  return {getResponseCode:()=>200,getContentText:()=>JSON.stringify({OutBlock_1:date==='20260918'?[]:
    [{BAS_DD:'20260917',IDX_NM:'코스피',CLSPRC_IDX:'3,410.00'}]})};
})};
// 실제 휴장 10/09 + 주말 10/10-11: 전체 공식 CLOSED 날짜만 검증된 범위에 포함.
const priorToday=context.today;
context.today=()=> '2026-10-12';
context.UrlFetchApp={fetchAll:requests=>requests.map(request=>{
  const market=request.url.includes('kosdaq_dd_trd')?'KOSDAQ':'KOSPI';
  const date=new URL(request.url).searchParams.get('basDd');
  if(date!=='20261008')throw new Error('확정 휴장일은 불필요한 API 호출을 하지 않아야 함: '+date);
  return {getResponseCode:()=>200,getContentText:()=>JSON.stringify({OutBlock_1:[market==='KOSDAQ'
    ?{BAS_DD:'20261008',IDX_NM:'코스닥',CLSPRC_IDX:'900'}
    :{BAS_DD:'20261008',IDX_NM:'코스피',CLSPRC_IDX:'3520'}]})};
})};
const holiday=context.handleGetBenchmarks('KOSPI,KOSDAQ','2026-10-07','2026-10-11',true);
if(holiday.status!=='ok'||holiday.seriesMeta.KOSPI.officialDate!=='2026-10-08'
 ||holiday.seriesMeta.KOSPI.verificationToDate!=='2026-10-11'
 ||holiday.seriesMeta.KOSPI.verifiedClosedDates.join(',')!=='2026-10-11,2026-10-10,2026-10-09')
 throw new Error('확정 휴장일에는 증거 날짜 목록 및 기준일이 유지되어야 함');
context.today=priorToday;
// 인증 오류는 이전 거래일로 재시도하지 않습니다.
context.UrlFetchApp={fetchAll:requests=>requests.map(request=>{
  const kosdaq=request.url.includes('kosdaq_dd_trd');
  const date=new URL(request.url).searchParams.get('basDd');
  krxAttempts.push({market:kosdaq?'KOSDAQ':'KOSPI',date});
  if(kosdaq)return {getResponseCode:()=>403,getContentText:()=>''};
  return {getResponseCode:()=>200,getContentText:()=>JSON.stringify({OutBlock_1:date==='20260918'?[]:
    [{BAS_DD:'20260917',IDX_NM:'코스피',CLSPRC_IDX:'3,410.00'}]})};
})};
const attemptStart=krxAttempts.length;
const partialRetry=context.handleGetBenchmarks('KOSPI,KOSDAQ','2026-09-16','2026-09-18',true);
if(partialRetry.series.KOSPI.at(-1).value!==3410||partialRetry.series.KOSDAQ.length
  ||!String(partialRetry.errors.KRX_OFFICIAL).includes('KOSDAQ:HTTP_403')
  ||krxAttempts.slice(attemptStart).filter(v=>v.market==='KOSDAQ').length!==1)
  throw new Error('KRX 403은 과거 반복 조회 금지, 타 시장은 독립 재탐색');
context.fetchMarketIndicatorCandlesToss=()=>[{date:'2026-09-18',value:3450,observedAt:'2026-09-18T15:30:00+09:00'}];
const attemptedMixed=context.handleGetBenchmarks('KOSPI','2026-09-16','2026-09-18',true);
if(attemptedMixed.status!=='ok'||attemptedMixed.series.KOSPI.at(-1).source!=='TOSS')
  throw new Error('공식 이전 날짜와 혼합된 최신 Toss candle 출처가 KRX로 오인됨');
context.fetchPricesKrx=()=>({'005930':{price:80500,usedDate:'2026-09-18',source:'KRX'},'000660':{price:187000,usedDate:'2026-09-17',source:'KRX'}});
const officialStocks=context.handleGetKrxOfficialStockCloses('2026-09-18','005930,000660,123456');
if(officialStocks.closes['005930'].source!=='KRX_OFFICIAL'||officialStocks.closes['005930'].price!==80500||officialStocks.closes['000660'])throw new Error('브리핑 KRX 주식 exact-date 종가/fallback 차단 실패');
const nightRows=[
 {BAS_DD:'20260904',MKT_NM:'야간',PROD_NM:'코스피200 선물',ISU_NM:'코스피200 F 202609 (야간)',TDD_CLSPRC:'351.25'},
 {BAS_DD:'20260904',MKT_NM:'야간',PROD_NM:'코스피200 선물',ISU_NM:'코스피200 F 202612 (야간)',TDD_CLSPRC:'350.10'},
];
if(context._parseKrxK200NightExpiry_(' 코스피200  F  202609  (야간) ')!=='202609')throw new Error('KRX 실제 ISU_NM 만기 파싱 실패');
const selectedNight=context._selectKrxK200NightClose_(nightRows,'2026-09-04');
if(!selectedNight||selectedNight.close!==351.25||selectedNight.expiry!=='202609')throw new Error('KRX 야간 KOSPI200 최근 미만기 월물 선택 실패');
for(const invalid of [
 [{...nightRows[0],MKT_NM:'정규'}],
 [{...nightRows[0],BAS_DD:'20260903'}],
 [{...nightRows[0],TDD_CLSPRC:'0'}],
 [{...nightRows[0],PROD_NM:'미니코스피200 선물',ISU_NM:'미니코스피200 F 202609 (야간)'}],
 [nightRows[0],{...nightRows[0],TDD_CLSPRC:'352.00'}],
])if(context._selectKrxK200NightClose_(invalid,'2026-09-04')!==null)throw new Error('KRX 야간 종가 invalid/ambiguous 차단 실패');
context.UrlFetchApp={fetch:()=>({getResponseCode:()=>200,getContentText:()=>JSON.stringify({OutBlock_1:nightRows})})};
context.CONFIG={TIMEZONE:'UTC'};
const night=context.fetchKrxK200NightClose('2026-09-04',new Date('2026-09-04T06:15:00Z'));
if(!night||night.status!=='FINAL'||night.finality!=='NIGHT_FINAL'||night.observedAt!=='2026-09-04T06:00:00+09:00'||night.source!=='KRX_OFFICIAL'||night.value!==351.25)throw new Error('KRX 공식 야간 종가 observation 실패');
if(context.fetchKrxK200NightClose('2026-09-04',new Date('2026-09-04T05:59:59Z'))!==null)throw new Error('06:00 이전 NIGHT_FINAL 차단 실패');

const yahoo = { chart: { result: [{ meta: { symbol: '^GSPC', regularMarketPrice: 105, previousClose: 100, regularMarketTime: 1790000000 }, timestamp: [1790000000, 1790086400], indicators: { quote: [{ close: [100, 105] }] } }] } };
const parsed = context._parseYahooChart_(yahoo, 'UTC');
if (!parsed || parsed.current !== 105 || parsed.previousClose !== 100 || parsed.points.length !== 2) throw new Error('Yahoo current/previous/series parsing 실패');
const changePct = (parsed.current - parsed.previousClose) / parsed.previousClose * 100;
if (changePct !== 5) throw new Error('Yahoo 등락률 계산 실패');
if (context._parseYahooChart_({ chart: { result: null } }, 'UTC') !== null
    || context._parseYahooChart_({ chart: { result: [{ indicators: { quote: [{ close: [null] }] }, timestamp: [1790000000] }] } }, 'UTC').points.length !== 0) throw new Error('Yahoo null/휴장 응답 보존 계약 실패');

let retryCount = 0;
context.UrlFetchApp = { fetch: () => { retryCount++; return { getResponseCode: () => 429, getHeaders: () => ({ 'Retry-After': '0' }), getContentText: () => '' }; } };
const limited = context._yahooRequest_('^GSPC', { range: '5d' });
if (limited.status !== 429 || limited.error !== 'RATE_LIMITED' || retryCount !== 3) throw new Error('Yahoo 429 재시도/실패 보존 계약 실패');
context.UrlFetchApp = { fetch: () => { throw new Error('simulated timeout'); } };
const timedOut = context._yahooRequest_('^GSPC', { range: '5d' });
if (timedOut.status !== 0 || timedOut.error !== 'TIMEOUT_OR_NETWORK_ERROR') throw new Error('Yahoo timeout 실패 보존 계약 실패');

const symbols = context.YAHOO_INDEX_SYMBOLS;
if (Object.keys(symbols).length !== 12 || symbols.SP500 !== '^GSPC' || symbols.NASDAQ !== '^IXIC' || symbols.NASDAQ100 !== '^NDX' || symbols.DOW !== '^DJI' || symbols.KOSPI200 !== '^KS200' || symbols.SOX !== '^SOX' || symbols.VIX !== '^VIX' || symbols.DXY !== 'DX-Y.NYB' || symbols.UST10Y !== '^TNX' || symbols.WTI !== 'CL=F' || symbols.GOLD !== 'GC=F' || symbols.BTC !== 'BTC-USD') throw new Error('Yahoo 12개 지수·거시 mapping 실패');
console.log('✅ Toss KOSPI/KOSDAQ 및 Yahoo 12개 지수·거시 provider 계약/파싱 테스트 통과');
