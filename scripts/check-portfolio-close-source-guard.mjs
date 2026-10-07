import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync('src/gas/apps_script.gs', 'utf8');
const extract = name => {
  const start = source.indexOf('function ' + name + '(');
  assert.ok(start >= 0, name + ' must exist');
  const end = source.indexOf('\n}', start);
  assert.ok(end > start, name + ' must have closing brace');
  return source.slice(start, end + 2);
};
const closeSection = extract('saveDailyPriceHistory');
const freshnessCall = closeSection.indexOf('_assessDailyKrxStockClose(items, krxPrev, requestedPrevDay)');
const firstPriceWrite = closeSection.indexOf('batchUpsertPriceHistory(ss, actualDate');
assert.ok(freshnessCall >= 0 && firstPriceWrite > freshnessCall,
  'KRX 거래일/coverage 검증은 가격이력 쓰기보다 먼저 해야 함');
assert.match(closeSection, /snapshotDate = closeVerification\.required\s*\? closeVerification\.date/,
  '펀드 NAV 가격행의 최근 날짜로 일반 종가 마감 성공 처리 금지');
assert.doesNotMatch(closeSection, /fetchedRowCount === 0 && !_getLatestPriceHistoryDate/,
  '기존 가격이력 존재를 신규 종가 조회 성공으로 오판하지 않아야 함');

const context = vm.createContext({
  _cleanCode: v => String(v || '').trim(),
  _isFundCode: v => /^F\d{5}$/.test(v),
  _normalizeDate: v => String(v || ''),
  _fundDateOffset: (v, days) => {
    const d = new Date(v + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0,10);
  },
  FUND_PROVIDERS: {
    KB_VALUE_ST: { source:'FUNETF' },
    HANWHA_2045_CRPE: { source:'HANWHA' }
  },
  FUND_NAV_FETCH_BATCH_DAYS: 14,
  FUND_NAV_FETCH_RETRIES: 1,
  _fundRecoveryDiagnosticStart() {},
  _fundRecoveryDiagnosticFinish() {},
});
const holidayStart = source.indexOf('var KRX_CONFIRMED_CLOSED_DATES_2026 =');
assert.ok(holidayStart >= 0, '공식 휴장일 판별 자료 누락');
const holidayEnd = source.indexOf('\n};',holidayStart);
assert.ok(holidayEnd > holidayStart, '공식 휴장일 자료 문법 오류');
vm.runInContext([
  source.slice(holidayStart,holidayEnd+3),
  extract('_countBusinessWeekdaysBetween'),extract('_assessDailyKrxStockClose'),
  extract('_fetchMissingFundNavBatches')
].join('\n'), context);
const clone = obj => JSON.parse(JSON.stringify(obj));
const items = [
  {code:'005930',currency:'KRW'}, {code:'000660',currency:'KRW'},
  {code:'091160',currency:'KRW'}, {code:'133690',currency:'KRW'},
  {code:'F00002',currency:'KRW'}, {code:'AAPL',currency:'USD'}
];
const close = (date,source='KRX')=>({usedDate:date,source,price:1500});
const full = Object.fromEntries(items.slice(0,4).map(x=>[x.code,close('2026-10-06')]));
const good = clone(context._assessDailyKrxStockClose(items, full,'2026-10-06'));
assert.deepEqual(good,{required:true,date:'2026-10-06',confirmed:4,expected:4,lag:0});
const holiday = clone(context._assessDailyKrxStockClose(items,Object.fromEntries(items.slice(0,4).map(x=>[x.code,close('2026-10-02')])), '2026-10-05'));
assert.equal(holiday.date,'2026-10-02','월요일 대체공휴일은 직전 확정 KRX 거래일을 허용');
assert.equal(holiday.lag,0,'공식 휴장일은 거래일 시차에서 제외');
assert.equal(context._countBusinessWeekdaysBetween('2026-02-13','2026-02-19'),1,
  '설날 연휴 3평일(2/16~18)은 정상 휴장으로 간주');
assert.equal(context._countBusinessWeekdaysBetween('2026-09-29','2026-10-06'),4,
  '실제 거래일 9/30,10/1,10/2,10/6을 휴일로 잘못 처리하지 않음');
assert.throws(()=>context._assessDailyKrxStockClose(items, {},'2026-10-06'),/KRX 확정 종가 0건/,
  '기존 펀드 NAV/가격이력이 있어도 일반 KRX 조회 0건이면 실패');
assert.throws(()=>context._assessDailyKrxStockClose(items,Object.fromEntries(items.slice(0,4).map(x=>[x.code,close('2026-09-29')])), '2026-10-06'),/확정 종가 오래됨/,
  '휴장 일괄 처리로 오래된 KRX 종가 무기한 이월 금지');
assert.throws(()=>context._assessDailyKrxStockClose(items, {'005930':close('2026-10-06')},'2026-10-06'),/부분 누락/,
  '삼성전자 1개 종가만 확보해 4종목 전체를 성공 처리하면 안 됨');
assert.equal(context._assessDailyKrxStockClose([{code:'F00001'},{code:'AAPL',currency:'USD'}],{},'2026-10-06').required,false,
  '국내 상장종목이 없는 환경은 별도 처리');
assert.equal(context._assessDailyKrxStockClose(items,Object.fromEntries(items.slice(0,4).map(x=>[x.code,close('2026-10-06','KRX_OTP')])), '2026-10-06').confirmed,4,
  'KRX OTP의 실제 날짜 종가도 확정 소스로 허용');
const segmented = Array.from({length:10},(_,i)=>({code:String(100000+i),currency:'KRW',type:i>=8?'ETF':'주식',market:i>=8?'KR':'KOSPI'}));
const onlyStocks = Object.fromEntries(segmented.slice(0,8).map(x=>[x.code,close('2026-10-06')]));
assert.throws(()=>context._assessDailyKrxStockClose(segmented,onlyStocks,'2026-10-06'),/ETF/,
  'KOSPI 8개만 성공하고 ETF 2개가 전부 누락되면 전체 80% 성공이라도 실패');
const allSegmented = Object.fromEntries(segmented.map(x=>[x.code,close('2026-10-06')]));
allSegmented._krxMarketEvidence = {
  KOSPI:{count:200,date:'2026-10-06'}, KOSDAQ:{count:0,date:'2026-10-06'}, ETF:{count:300,date:'2026-10-06'}
};
assert.throws(()=>context._assessDailyKrxStockClose(segmented,allSegmented,'2026-10-06'),/KOSDAQ/,
  'KRX OpenAPI KOSDAQ pack 통째 누락은 전체 종목 커버리지에 가려지면 안 됨');
allSegmented._krxMarketEvidence.KOSDAQ = {count:600,date:'2026-10-02'};
assert.throws(()=>context._assessDailyKrxStockClose(segmented,allSegmented,'2026-10-06'),/KOSDAQ/,
  '시장별 조회 날짜가 서로 다르면 신선도 검증 실패');
allSegmented._krxMarketEvidence.KOSDAQ = {count:600,date:'2026-10-06'};
assert.equal(context._assessDailyKrxStockClose(segmented,allSegmented,'2026-10-06').confirmed,10,
  '세 시장 pack 모두 같은 확정 거래일에 정상 제공하면 통과');

const calls = [];
context._fetchFundNav = (provider,from,to) => {
  calls.push({provider,from,to});
  return [
    {date:'2026-09-22',nav:2100},
    {date:'2026-09-23',nav:2101},
    {date:'2026-09-25',nav:2102},
    {date:'2026-09-28',nav:2103},
    {date:'2026-10-02',nav:2104},
  ];
};
const missing = ['2026-09-22','2026-09-23','2026-09-25','2026-09-28','2026-10-02'];
let recovered = clone(context._fetchMissingFundNavBatches('KB_VALUE_ST',missing,'2026-10-06',null,'F00002'));
assert.deepEqual(calls,[{provider:'KB_VALUE_ST',from:'2026-09-22',to:'2026-10-05'}],
  '주말·기존 공시값 사이의 누락은 연속 날짜 API 호출로 묶어야 함');
assert.equal(recovered.rows.length,5);
assert.deepEqual(recovered.errors,[]);
calls.length = 0;
recovered = clone(context._fetchMissingFundNavBatches('KB_VALUE_ST',['2026-09-22','2026-10-06'],'2026-10-06',null,'F00002'));
assert.equal(calls.length,2,'14일을 초과하는 누락은 범위별 분할');
assert.equal(calls[1].from,'2026-10-06');
assert.equal(calls[1].to,'2026-10-06');

console.log('✅ KRX 원본 날짜/커버리지, 펀드 NAV 혼입 방지, KB 누락 날짜 배치 회귀검사 통과');
