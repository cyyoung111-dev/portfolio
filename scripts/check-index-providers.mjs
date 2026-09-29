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
context.UrlFetchApp={fetchAll:()=>{throw new Error('simulated KRX timeout');}};
const isolated=context._fetchKrxOfficialIndexClosesSafe_(['KOSPI','KOSDAQ'],'2026-09-18');
if(Object.keys(isolated.data).length||isolated.error!=='simulated KRX timeout')throw new Error('KRX 공식 조회 예외 격리 실패');
const nightRows=[
 {BAS_DD:'20260918',MKT_NM:'야간시장',PROD_NM:'코스피 200 선물',ISU_NM:'코스피 200 선물 202612',TDD_CLSPRC:'351.25'},
 {BAS_DD:'20260918',MKT_NM:'야간시장',PROD_NM:'코스피 200 선물',ISU_NM:'코스피 200 선물 202703',TDD_CLSPRC:'350.10'},
];
const selectedNight=context._selectKrxK200NightClose_(nightRows,'2026-09-18');
if(!selectedNight||selectedNight.close!==351.25||selectedNight.expiry!=='202612')throw new Error('KRX 야간 KOSPI200 최근 미만기 월물 선택 실패');
for(const invalid of [
 [{...nightRows[0],MKT_NM:'정규시장'}],
 [{...nightRows[0],BAS_DD:'20260917'}],
 [{...nightRows[0],TDD_CLSPRC:'0'}],
 [{...nightRows[0],PROD_NM:'미니코스피 200 선물',ISU_NM:'미니코스피 200 선물 202612'}],
 [nightRows[0],{...nightRows[0],TDD_CLSPRC:'352.00'}],
])if(context._selectKrxK200NightClose_(invalid,'2026-09-18')!==null)throw new Error('KRX 야간 종가 invalid/ambiguous 차단 실패');
context.UrlFetchApp={fetch:()=>({getResponseCode:()=>200,getContentText:()=>JSON.stringify({OutBlock_1:nightRows})})};
context.CONFIG={TIMEZONE:'UTC'};
const night=context.fetchKrxK200NightClose('2026-09-18',new Date('2026-09-18T06:15:00Z'));
if(!night||night.status!=='FINAL'||night.finality!=='NIGHT_FINAL'||night.observedAt!=='2026-09-18T06:00:00+09:00'||night.source!=='KRX_OFFICIAL')throw new Error('KRX 공식 야간 종가 observation 실패');
if(context.fetchKrxK200NightClose('2026-09-18',new Date('2026-09-18T05:59:59Z'))!==null)throw new Error('06:00 이전 NIGHT_FINAL 차단 실패');

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
if (Object.keys(symbols).length !== 7 || symbols.SP500 !== '^GSPC' || symbols.NASDAQ !== '^IXIC' || symbols.NASDAQ100 !== '^NDX' || symbols.DOW !== '^DJI' || symbols.KOSPI200 !== '^KS200' || symbols.SOX !== '^SOX' || symbols.VIX !== '^VIX') throw new Error('Yahoo 7개 지수 mapping 실패');
console.log('✅ Toss KOSPI/KOSDAQ 및 Yahoo 7개 지수 provider 계약/파싱 테스트 통과');
