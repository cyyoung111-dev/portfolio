import assert from 'node:assert/strict';
import fs from 'node:fs';

const gas = fs.readFileSync('src/gas/apps_script.gs', 'utf8');
const web = fs.readFileSync('src/web/views/views_history_state.js', 'utf8');
const ui = fs.readFileSync('src/web/core/core_ui.js', 'utf8');
const history = fs.readFileSync('src/web/views/views_history.js', 'utf8');
const pipeline = fs.readFileSync('src/web/views/views_history_pipeline.js', 'utf8');
const html = fs.readFileSync('src/web/index.html', 'utf8');

function holdingsAtDate(rows, date) {
  const map = {};
  for (const row of rows) {
    const [rowDate, type, , name, code, rawQty, rawPrice, assetType, , rawRatio] = row;
    if (!rowDate || rowDate > date || !name) continue;
    const qty = Number(rawQty) || 0;
    const price = Number(rawPrice) || 0;
    const ratio = Number(rawRatio) || 0;
    map[name] ||= { name, code, qty: 0, costAmt: 0, assetType: assetType || '주식' };
    const position = map[name];
    if (type === 'buy') {
      position.qty += qty;
      position.costAmt += qty * price;
    } else if (type === 'sell') {
      const sold = Math.min(qty, position.qty);
      const avg = position.qty > 0 ? position.costAmt / position.qty : 0;
      position.qty -= sold;
      position.costAmt -= sold * avg;
    } else if (type === 'split' && ratio > 0) {
      position.qty *= ratio;
    } else if (type === 'reverse_split' && ratio > 0) {
      position.qty /= ratio;
    }
    if (position.qty < 0.0001) { position.qty = 0; position.costAmt = 0; }
  }
  return Object.fromEntries(Object.entries(map).filter(([, p]) => p.qty > 0.0001));
}

// 과거일 수량, 매도 후 과거 오염 방지, 전량매도 후 0, 분할·병합 원가 불변
const trades = [
  ['2026-01-02', 'buy', 'A', '삼성전자', '005930', 10, 100, '주식', '', ''],
  ['2026-01-05', 'split', 'A', '삼성전자', '005930', 10, 0, '주식', '', 2],
  ['2026-01-07', 'sell', 'A', '삼성전자', '005930', 5, 0, '주식', '', ''],
];
assert.equal(holdingsAtDate(trades, '2026-01-03').삼성전자.qty, 10);
assert.equal(holdingsAtDate(trades, '2026-01-06').삼성전자.qty, 20);
assert.equal(holdingsAtDate(trades, '2026-01-08').삼성전자.qty, 15);
assert.equal(holdingsAtDate(trades, '2026-01-08').삼성전자.costAmt, 750);
assert.deepEqual(holdingsAtDate([...trades, ['2026-01-09', 'sell', 'A', '삼성전자', '005930', 15, 0, '주식', '', '']], '2026-01-10'), {});
const reverse = holdingsAtDate([...trades, ['2026-01-09', 'reverse_split', 'A', '삼성전자', '005930', 15, 0, '주식', '', 3]], '2026-01-10').삼성전자;
assert.equal(reverse.qty, 5);
assert.equal(reverse.costAmt, 750);

// 가격·환율이 확정되지 않으면 기존 Snapshot을 덮지 않는 정책 모델
function buildValue(position, close, fx = 1) {
  if (!(close > 0) || !(fx > 0)) return null;
  const evalAmt = Math.round(position.qty * close * fx);
  return { evalAmt, pnl: evalAmt - position.costAmt };
}
const position = { qty: 2, costAmt: 1000 };
assert.equal(buildValue(position, 0), null);
assert.equal(buildValue(position, 100, 0), null);
assert.deepEqual(buildValue(position, 700), { evalAmt: 1400, pnl: 400 });

// 주말·휴장일 carry-forward와 미래 가격 차단 모델
const confirmed = [{ date: '2026-01-07', price: 700 }, { date: '2026-01-09', price: 720 }];
const carry = confirmed.filter(x => x.date < '2026-01-10').at(-1);
assert.equal(carry.price, 720);
assert.equal(confirmed.filter(x => x.date <= '2026-01-06').at(-1)?.price, undefined);

// 구현 계약: Snapshot은 원자료만 읽고, persist=false는 Snapshot 저장 경로를 타지 않는다.
assert.match(gas, /function rebuildDailySnapshots\(fromStr, toStr\)/);
assert.match(gas, /function _collectDailySnapshotDates\(ss, fromDate, toDate\)/);
assert.match(gas, /function _getHistoricalExchangeRates\(ss, currencies, dateStr\)/);
assert.match(gas, /function _getFundEvaluationAtDate\(ss, code, dateStr\)/);
assert.match(gas, /getRange\(2, 1, tradeSh\.getLastRow\(\) - 1, Math\.min\(11, tradeSh\.getLastColumn\(\)\)\)/);
assert.match(gas, /var ratio = parseFloat\(row\[9\]\) \|\| 0/);
assert.match(gas, /if \(throwOnError\) \{\s*var invalid = \[\]/);
assert.match(gas, /확정 원자료 부족으로 기존 Snapshot 보존/);
assert.match(gas, /_getFundEvaluationAtDate\(ss, fundCode, dateStr\)/);
assert.match(gas, /sourceMap\[fundCode\] = \{ src: fundValue\.carried \? 'FUND_NAV_CARRY' : 'FUND_NAV'/);
assert.match(gas, /cachedPayload\.priceLookup\.snapshotCreated = persist && cachedLatestDate/);
const priceBody = gas.slice(gas.indexOf('function handleGetPricesCompat'), gas.indexOf('function _latestDateFromPriceDates'));
assert.doesNotMatch(priceBody, /persists*=s*false/);
assert.match(priceBody, /if \(persist && confirmedPersistDates\.length\) _rebuildSnapshotForDateFromHistory/);
assert.match(gas, /var smoke = _tossPriceSmoke_\(\)/);
assert.match(gas, /fetchMarketIndicatorCandlesToss\(key, fromDate, toDate\)/);
assert.match(gas, /fetchYahooIndexSeries\(key, fromDate, toDate\)/);
assert.doesNotMatch(gas.slice(gas.indexOf('function rebuildDailySnapshots'), gas.indexOf('function _readSnapshotRowsByDate')), /GOOGLEFINANCE\s*\(/);
assert.doesNotMatch(gas.slice(gas.indexOf('function rebuildDailySnapshots'), gas.indexOf('function _readSnapshotRowsByDate')), /fetchExchangeRates\(/);

// 기존 원자료/스냅샷/펀드·배당 시트 보호와 대상 날짜 비교 후 upsert
assert.match(gas, /var existing = _readSnapshotRowsByDate\(ss, date\)/);
assert.match(gas, /if \(before === after\) unchanged\+\+/);
assert.match(gas, /catch \(error\) \{\s*\/\/ 원자료 부족/);
assert.match(gas, /function _getHistoricalExchangeRates[\s\S]*?header\[0\] !== '날짜' \|\| header\[1\] !== '통화' \|\| header\[2\] !== '환율'/);
assert.match(gas, /SHEET_ETF_DIVIDENDS/);
assert.match(gas, /FUND_NAV_SHEET, \[0, 4\]/);
assert.match(gas, /addSheetDates\(CONFIG\.SHEET_SNAPSHOT, \[0\]\)/,'기존 Snapshot도 과거 거래 변경 비교 대상에 포함');
assert.match(gas, /var affectedFrom = _earliestChangedTradeDate\(previousRows, currentRows\)/,'거래 추가·수정·삭제 최초 영향일 계산');
assert.match(gas, /rebuildDailySnapshots\(affectedFrom, affectedTo\)/,'최초 영향일부터 마지막 확정 Snapshot까지 공통 계산기로 갱신');
assert.match(gas, /_snapshotBackupOperationId = 'rebuildDailySnapshots\|'/,'다일자 재생성은 작업 단위 백업 재사용');

// KOSDAQ 선택·라벨·시각화·확정 기준 표시
assert.match(web, /\['KOSPI', 'KOSDAQ', 'SP500'/);
assert.match(web, /HIST_BENCHMARK_STORAGE_KEY/);
assert.match(web, /localStorage\.setItem\(HIST_BENCHMARK_STORAGE_KEY/);
assert.match(ui, /KOSDAQ:'KOSDAQ'/);
assert.match(history, /KOSDAQ: \{ color:/);
assert.match(pipeline, /확정 기준 \$\{latestDate\}/);
assert.match(html, /core\/core_ui\.js\?v=20260917-2/);

// TWR은 별도 도입하지 않고 기존 현금흐름 조정 지수만 유지
assert.match(fs.readFileSync('src/web/views/views_history_utils.js', 'utf8'), /_buildCashflowAdjustedReturnIndex/);
assert.doesNotMatch(gas, /function\s+calculateTwr\s*\(/i);

console.log('✅ 일별 Snapshot 원자료·날짜·환율·펀드·Corporate Action·KOSDAQ 회귀 검사 통과');
