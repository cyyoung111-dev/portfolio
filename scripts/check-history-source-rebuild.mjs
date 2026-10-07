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
  종목코드: [['종목코드','이름']],
  스냅샷: [['날짜']],
  펀드기준가격: [['날짜','코드','명','NAV','공시일','좌수','평가금액','시각','클래스'], ...navRows],
  펀드좌수: [['코드','좌수']],
  환율이력: [['날짜','통화','환율'],['2026-10-06','USD',1300]],
};
const indexed = lib._buildSnapshotRangeIndexes({
  valuesByName: values, ss: {}, metrics: {}, readMs: 0,
}, ['2026-10-07','2026-10-08','2026-10-09','2026-10-21'], { historyOnly: true });
assert.equal(indexed.metrics.priceIntegrityBuildCount,0,'조회 전용 경로에서 무거운 Snapshot 정합성 계산 생략');
assert.equal(indexed.historyPriceSeriesByCode['005930'][0].price,150000,'자동 확정 종가가 같은 날짜 MANUAL보다 우선');
assert.equal(indexed.historyPriceSeriesByCode.AAPL.length,1,'미확정 Toss 시세가 과거 손익을 덮어쓰지 않음');
const july = lib._historySourceRows(indexed,'2026-10-07');
const map = Object.fromEntries(july.map(row => [row[1],row]));
assert.equal(map.F00002[7],150068);
assert.equal(map.F00002[10],'FUND_NAV_CARRY@2026-10-05');
assert.equal(map['005930'][7],150000);
assert.equal(map.AAPL[7],130650,'미국주식은 확정 종가 × 해당일 이전 확정 환율');
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
assert.match(sw,/portfolio-cache-20261007-4/);
console.log('✅ 펀드 직전 확정 NAV 이월·좌수 변경·0좌·미래값 차단·원자료 손익 회귀 검사 통과');
