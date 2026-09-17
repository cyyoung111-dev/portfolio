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
context.Utilities = { formatDate: date => new Date(date).toISOString().slice(0, 10), sleep: () => {} };
context.CacheService = { getScriptCache: () => ({ get: () => null, put: () => {} }) };

const tossCalls = [];
context._tossRequest_ = (path, query, group) => {
  tossCalls.push({ path, query, group });
  if (path.endsWith('/prices')) return { result: [{ symbol: 'KOSPI', lastPrice: 2600, timestamp: '2026-09-16T06:00:00Z' }, { symbol: 'KOSDAQ', lastPrice: 800, timestamp: '2026-09-16T06:00:00Z' }] };
  return { result: { candles: [{ timestamp: '2026-09-15T06:00:00Z', closePrice: 799 }, { timestamp: '2026-09-16T06:00:00Z', closePrice: 801 }] } };
};
const prices = context.fetchMarketIndicatorPricesToss(['KOSPI', 'KOSDAQ']);
if (prices.KOSPI.value !== 2600 || prices.KOSDAQ.value !== 800 || tossCalls[0].group !== 'MARKET_INDICATOR') throw new Error('KOSPI/KOSDAQ Toss prices mapping 실패');
const candles = context.fetchMarketIndicatorCandlesToss('KOSDAQ', '2026-09-15', '2026-09-16');
if (candles.length !== 2 || candles[0].value !== 799 || tossCalls[1].query.interval !== '1d') throw new Error('KOSDAQ Toss candles parsing 실패');

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
