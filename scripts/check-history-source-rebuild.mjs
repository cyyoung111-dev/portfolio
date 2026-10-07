import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const gas = fs.readFileSync('src/gas/apps_script.gs', 'utf8');
const web = fs.readFileSync('src/web/views/views_history_pipeline.js', 'utf8');
const indexHtml = fs.readFileSync('src/web/index.html', 'utf8');
const sw = fs.readFileSync('src/web/sw.js', 'utf8');

function pick(name) {
  const start = gas.indexOf('function ' + name + '(');
  assert(start >= 0, name + ' 정의 누락');
  const end = gas.indexOf('\n}', start);
  assert(end > start, name + ' 종료 누락');
  return gas.slice(start, end + 2);
}
const configs = [
  { code: 'F00002', provider: 'KB', name: 'KB 펀드', startDate: '2026-01-01', units: 100000 },
  { code: 'F00002', provider: 'KB', name: 'KB 펀드', startDate: '2026-10-07', units: 150000 },
  { code: 'F00002', provider: 'KB', name: 'KB 펀드', startDate: '2026-10-09', units: 0 },
];
const norm = value => {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  return '';
};
const getActive = (list, code, date) => [...list].filter(x => x.code === code && x.startDate <= date)
  .sort((a, b) => a.startDate.localeCompare(b.startDate)).at(-1) || null;
const latest = (rows, date) => [...(rows || [])].filter(row => row.date <= date)
  .sort((a, b) => a.date.localeCompare(b.date)).at(-1) || null;
const holdings = {
  'KB 펀드': { code: 'F00002', name: 'KB 펀드', qty: 200, costAmt: 140000 },
  '삼성전자': { code: '005930', name: '삼성전자', qty: 1, costAmt: 120000 },
  '애플': { code: 'AAPL', name: '애플', qty: 1, costAmt: 180000 },
};
const ctx = {
  CONFIG: { SHEET_TRADES: '거래', SHEET_PH: '가격이력', SHEET_CODES: '종목코드', SHEET_SNAPSHOT: '스냅샷' },
  FUND_NAV_SHEET: '펀드기준가격', FUND_UNITS_SHEET: '펀드좌수',
  PRICE_HISTORY_UNVERIFIED_SOURCES: /REALTIME|INDICATIVE|DAILY_CANDLE|UNVERIFIED_CLOSE/i,
  _normalizeDate: norm, _normalizeDatetime: String, _cleanCode: value => String(value || '').trim(),
  _fundUnitsAtDate: getActive, _isFundCode: code => /^F\d{5}$/.test(String(code || '')),
  _indexedLatest: latest, _dedupeSnapshotRows: rows => rows,
  _readFundUnits: () => configs,
  _priceIntegrityRows: () => [],
  getCodeItems: () => [{ code: '005930', name: '삼성전자', currency: 'KRW' },
    { code: 'AAPL', name: '애플', currency: 'USD' }, { code: 'F00002', name: 'KB 펀드', currency: 'KRW' }],
  _buildHoldingsByRequestedDate: (trades, dates) => Object.fromEntries(dates.map(date => [date, holdings])),
  _applyFundUnitLifecycleToSnapshotHoldings: (items, list, date) => {
    Object.keys(items).forEach(key => {
      const h = items[key];
      if (!/^F\d{5}$/.test(h.code)) return;
      const config = getActive(list, h.code, date);
      if (config?.units === 0) delete items[key];
      else h.qty = 1;
    });
  },
  _dateOffset: (date, days) => {
    const d = new Date(date + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  },
  today: () => '2026-10-10',
};
const functions = ['_fundNavEvaluationFromRows','_indexedFundEvaluation',
  '_buildSnapshotRangeIndexes','_historySourceRows','_historySourceSummary','_historySourceDates'];
vm.runInNewContext(functions.map(pick).join('\n') + '\nglobalThis.funcs={' +
  functions.map(name => name + ':' + name).join(',') + '};', ctx);
const lib = ctx.funcs;

const navRows = [
  ['2026-10-05','F00002','KB 펀드',1000.45,'2026-10-05',100000,100045,'','KB'],
  ['2026-10-08','F00002','KB 펀드',1010.00,'2026-10-08',150000,151500,'','KB'],
];
const fund = lib._fundNavEvaluationFromRows(navRows, configs, 'F00002','2026-10-07');
assert.equal(fund.sourceDate,'2026-10-05','평가일 다음 공시일 NAV는 사용하지 않음');
assert.equal(fund.carried,true,'미공시일은 직전 확정 NAV 이월');
assert.equal(fund.units,150000,'해당 평가일에 적용되는 좌수');
assert.equal(fund.evalAmt,150068,'과거 저장 금액이 아니라 NAV × 해당일 좌수');
assert.equal(lib._fundNavEvaluationFromRows(navRows, configs,'F00002','2026-10-09'),null,'0좌일에 평가하지 않음');
assert.equal(lib._fundNavEvaluationFromRows([navRows[1]],configs,'F00002','2026-10-07'),null,'미래 NAV로 최초 날짜 채우지 않음');

const priceRows = [
  ['날짜','코드','이름','가격','입력시각','소스'],
  ['2026-10-07','005930','삼성전자',999,'2026-10-07T16:00:00','MANUAL'],
  ['2026-10-07','005930','삼성전자',150000,'2026-10-07T16:05:00','KRX_CONFIRMED_CLOSE'],
  ['2026-10-07','AAPL','애플',100.50,'2026-10-07T21:00:00','STORED_CONFIRMED_CLOSE'],
  ['2026-10-07','AAPL','애플',200.00,'2026-10-07T22:00:00','TOSS_INDICATIVE'],
];
const values = {
  거래: [['날짜','', '', '이름','코드'],['2026-01-01','','','KB 펀드','F00002']],
  가격이력: priceRows,
  종목코드: [
    ['종목코드','이름','종류','섹터','통화','시장'],
    ['005930','삼성전자','주식','','KRW','KRX'],
    ['AAPL','애플','주식','','USD','NASDAQ'],
    ['F00002','KB 펀드','펀드','','KRW','FUND']
  ],
  스냅샷: [['날짜']],
  펀드기준가격: [['날짜','코드','명','NAV','공시일','좌수','평가금액','시각','클래스'], ...navRows],
  펀드좌수: [['코드','좌수']],
  환율이력: [['날짜','통화','환율'],['2026-10-06','USD',1300]],
};
const indexed = lib._buildSnapshotRangeIndexes({
  valuesByName: values, ss: {}, metrics: {}, readMs: 0,
}, ['2026-10-07','2026-10-08','2026-10-09','2026-10-21'], { historyOnly: true });
assert.equal(indexed.metrics.priceIntegrityBuildCount,0,'조회 전용 경로에서 무거운 Snapshot 정합성 계산 생략');
const regularIndex = lib._buildSnapshotRangeIndexes({
  valuesByName: values, ss: {}, metrics: {}, readMs: 0,
}, ['2026-10-07'], {});
assert.equal(regularIndex.metrics.priceIntegrityBuildCount,1,'일반 기간 진단 모드는 가격 정합성 계산 유지');
assert.equal(indexed.historyPriceSeriesByCode['005930'][0].price,150000,'자동 확정 종가가 같은 날짜 MANUAL보다 우선');
assert.equal(indexed.historyPriceSeriesByCode.AAPL.length,1,'미확정 Toss 시세가 과거 손익을 덮어쓰지 않음');
const july = lib._historySourceRows(indexed,'2026-10-07');
const map = Object.fromEntries(july.map(row => [row[1],row]));
assert.equal(map.F00002[7],150068);
assert.equal(map.F00002[10],'FUND_NAV_CARRY@2026-10-05');

// 같은 공시일에 NAV가 충돌하면 자동 선택하지 않고 계산 불가로 처리해야 합니다.
function indexedWithExtraNav(extraRow) {
  return lib._buildSnapshotRangeIndexes({
    valuesByName: { ...values, 펀드기준가격: [...values.펀드기준가격, extraRow] },
    ss: {}, metrics: {}, readMs: 0,
  }, ['2026-10-06','2026-10-07','2026-10-08','2026-10-09'], { historyOnly: true });
}
const conflictingNav = ['2026-10-07','F00002','KB 펀드',1080,'2026-10-05',150000,162000,'','KB'];
const conflictIndex = indexedWithExtraNav(conflictingNav);
assert.equal(lib._indexedFundEvaluation(conflictIndex,'F00002','2026-10-06').nav,1000.45,
  '상충 행 입력일 전에는 과거 확정 NAV를 그대로 허용');
assert.throws(() => lib._historySourceRows(conflictIndex,'2026-10-07'), /펀드 확정 NAV 충돌: F00002 2026-10-05/,
  '원자료 손익 조회에서 동일 기관·공시일 NAV 충돌 차단');
assert.throws(() => lib._indexedFundEvaluation(conflictIndex,'F00002','2026-10-08'), /펀드 확정 NAV 충돌/,
  '이후 NAV가 정상이어도 과거 공시일 충돌을 무시하면 안 됨');
assert.equal(lib._indexedFundEvaluation(conflictIndex,'F00002','2026-10-09'),null,
  '잔여 좌수 0일 때 해당 펀드 평가를 수행하지 않음');
assert.throws(() => lib._fundNavEvaluationFromRows([...navRows, conflictingNav],configs,'F00002','2026-10-07'),
  /펀드 확정 NAV 충돌/, '기존 NAV 평가 경로와 충돌 검증 규칙 일치');
const sameNavDuplicate = indexedWithExtraNav([...conflictingNav.slice(0,3),1000.45,...conflictingNav.slice(4)]);
assert.equal(lib._indexedFundEvaluation(sameNavDuplicate,'F00002','2026-10-07').nav,1000.45,
  '동일 NAV의 중복 공시 행은 충돌로 오인하지 않음');
const anotherProvider = indexedWithExtraNav([...conflictingNav.slice(0,8),'OTHER']);
assert.equal(lib._indexedFundEvaluation(anotherProvider,'F00002','2026-10-07').nav,1000.45,
  '다른 제공기관의 NAV 충돌은 현재 선택 기관에 전파하지 않음');
const blankProvider = indexedWithExtraNav([...conflictingNav.slice(0,8),'']);
assert.throws(() => lib._indexedFundEvaluation(blankProvider,'F00002','2026-10-07'),/펀드 확정 NAV 충돌/,
  '제공기관이 없는 행은 기존 경로처럼 현재 제공기관과 충돌 검사');
const laterInput = indexedWithExtraNav(['2026-10-08',...conflictingNav.slice(1)]);
assert.equal(lib._indexedFundEvaluation(laterInput,'F00002','2026-10-07').nav,1000.45,
  '미래 입력일의 상충 NAV는 과거 평가에 사용하지 않음');
assert.throws(() => lib._indexedFundEvaluation(laterInput,'F00002','2026-10-08'), /펀드 확정 NAV 충돌/,
  '상충 NAV 입력일 도달 시 검증 거부');

assert.equal(map['005930'][7],150000);
assert.equal(map.AAPL[7],130650,'미국주식은 확정 종가 × 해당일 이전 확정 환율');
const noCurrencyIndex = { ...indexed, historyCurrencyByCode: { ...indexed.historyCurrencyByCode } };
delete noCurrencyIndex.historyCurrencyByCode.AAPL;
assert.throws(() => lib._historySourceRows(noCurrencyIndex,'2026-10-07'),/종목 통화 원자료 누락/,
  '종목코드에서 통화를 확인할 수 없는 해외 종목은 KRW로 잘못 계산하지 않음');
const wronglyWonValues = { ...values, 종목코드: values.종목코드.map(row => row[0] === 'AAPL'
  ? ['AAPL','애플','주식','','KRW','NASDAQ'] : row) };
const incorrectlyTagged = lib._buildSnapshotRangeIndexes({
  valuesByName: wronglyWonValues, ss: {}, metrics: {}, readMs: 0
}, ['2026-10-07'], { historyOnly: true });
assert.throws(() => lib._historySourceRows(incorrectlyTagged,'2026-10-07'),/종목 통화 원자료 누락/,
  '미국 종목에 KRW가 입력되었더라도 해외시장 메타데이터와 불일치 시 제외');
const marketCurrencyRows = [
  ['7203','토요타','주식','','KRW','TSE'],
  ['0700','텐센트','주식','','KRW','HKEX'],
  ['6758','소니','주식','','JPY','JP'],
  ['0005','HSBC','주식','','HKD','HK']
];
const marketIndex = lib._buildSnapshotRangeIndexes({
  valuesByName: { ...values, 종목코드: [...values.종목코드, ...marketCurrencyRows] },
  ss: {}, metrics: {}, readMs: 0,
}, ['2026-10-07'], { historyOnly: true });
assert.equal(marketIndex.historyCurrencyByCode['7203'],undefined,'TSE의 KRW 통화 불일치를 허용하지 않음');
assert.equal(marketIndex.historyCurrencyByCode['0700'],undefined,'HKEX의 KRW 통화 불일치를 허용하지 않음');
assert.equal(marketIndex.historyCurrencyByCode['6758'],'JPY','JP의 정상 JPY 통화 허용');
assert.equal(marketIndex.historyCurrencyByCode['0005'],'HKD','HK의 정상 HKD 통화 허용');

for (const action of ['split','reverse_split']) {
  const actionTrade = ['2026-10-08',action,'','삼성전자','005930',0,0,'주식','',2];
  const actionIndex = lib._buildSnapshotRangeIndexes({
    valuesByName: { ...values, 거래: [...values.거래, actionTrade] },
    ss: {}, metrics: {}, readMs: 0,
  }, ['2026-10-08'], { historyOnly: true });
  assert.throws(() => lib._historySourceRows(actionIndex,'2026-10-08'), /주식분할 이후 종가 미확정/,
    action + ' 발생 후 분할 전 종가를 그대로 이월하여 평가하지 않음');
}
const summary = lib._historySourceSummary(july,'2026-10-07');
assert.equal(summary.carriedFunds[0].sourceDate,'2026-10-05');
assert.equal(summary.navInputRequired,false,'이월 NAV는 수기입력 강제 대상이 아님');
const following = lib._historySourceRows(indexed,'2026-10-08');
const followingSummary = lib._historySourceSummary(following,'2026-10-08');
assert.equal(followingSummary.carriedPrices.length,2,'직전 종가로 평가한 일반종목 2건 별도 표시');
assert.equal(followingSummary.carriedPrices[0].sourceDate,'2026-10-07','종가 이월에 원천일 기록');
const zeroUnit = lib._historySourceRows(indexed,'2026-10-09');
assert(!zeroUnit.some(row => row[1] === 'F00002'),'0좌 전환 뒤 펀드는 제외');
assert.throws(() => lib._historySourceRows(indexed,'2026-10-21'),/확정 종가 원자료 없음|확정 환율 오래됨/,'10일 초과 가격/환율 이월 차단');
const days = lib._historySourceDates(values,'2026-10-03','2026-10-07');
assert.deepEqual(Array.from(days),['2026-10-05','2026-10-06','2026-10-07'],'주말 제외 일별 날짜 구성');

assert.match(gas,/function handleGetHistorySource\(/);
assert.match(gas,/function handleGetHistorySourceDetail\(/);
assert.match(gas,/historyOnly: true/,'Snapshot 중복과 독립적으로 조회');
assert.match(gas,/function _buildSnapshotRangeReadContext\(ss, options\)/);
assert.match(gas,/function _getFundEvaluationAtDate[\s\S]*_fundNavEvaluationFromRows/);
assert.doesNotMatch(gas, /if \(throwOnError && \(currency !== 'KRW' \|\| !\(price > 0\)\)\)/,'외화 보유자산을 무조건 불완전 처리하던 조건 제거');
assert.match(web, /_historyRequestJson\('getHistorySource'/);
assert.match(web, /_historyRequestJson\('getHistorySourceDetail'/);
assert.match(web, /sourceRecomputed \? \[\] : snapshots\.filter/,'원자료 재구성 시 Snapshot 정합성 중복 진단 생략');
assert.match(web, /원자료 기준 자동 손익/);
assert.match(web, /일반 종목.*해당일 확정 종가가 없어 직전 확정 종가로 이월 평가/);
assert.match(web, /_renderHistorySourceCoverage\(coverageEl, data\.sourceSummary, \[\]\)/,'전부 결측이어도 원자료 부족 사유 렌더링');
assert.match(indexHtml,/views_history_pipeline\.js\?v=20261007-4/);
assert.match(sw,/portfolio-cache-20261007-6/);
console.log('✅ 펀드 직전 확정 NAV 이월·좌수 변경·0좌·미래값 차단·원자료 손익 회귀 검사 통과');
