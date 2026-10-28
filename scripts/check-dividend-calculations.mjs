import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync('src/web/views/views_div_asset.js', 'utf8');
const context = {
  DIVDATA: {
    '테스트 종목': {
      perShare: 0,
      months: [],
      events: [
        { date: '2025-12-29', payDate: '2026-01-15', amount: 100 },
        { date: '2026-12-29', payDate: '2027-01-15', amount: 200 },
      ],
    },
  },
  EDITABLE_PRICES: [],
  rawHoldings: [{ name: '테스트 종목', acct: '일반', qty: 10 }],
  _kstYear: () => 2026,
  getQtyAtDate: (_name, date) => date === '2025-12-29' ? 10 : 20,
  getEP: () => null,
  getDivRefDate: (year, month) => `${year}-${String(month).padStart(2, '0')}-01`,
};

vm.createContext(context);
vm.runInContext(source, context);

const rows = context.calcDividends();
assert.equal(rows.length, 1, '예상값이 없어도 실제 배당 이벤트를 표시해야 합니다.');
assert.equal(rows[0].actualDiv, 1_000, '전년도 기준일·올해 지급 이벤트를 올해 확정 배당으로 집계해야 합니다.');
assert.equal(rows[0].annualDiv, 1_000);
assert.deepEqual({ ...rows[0].monthlyDiv }, { 1: 1_000 });

console.log('배당 지급연도 및 실제 이벤트 집계 검사 통과');

// 동일 배당 탭 재렌더가 수동 갱신 결과를 새 자동 조회로 덮지 않도록 확인한다.
const routerSource = fs.readFileSync('src/web/views/views_system.js', 'utf8');
const routerStart = routerSource.indexOf('function renderView(forceRender) {');
const routerEnd = routerSource.indexOf('\n// ═', routerStart);
const area = { dataset: {} };
const dividendRefreshCalls = [];
const routerContext = vm.createContext({
  currentView: 'div', $el: () => area, _viewCache: {}, _getDataHash: () => 'unchanged',
  _perfRun: (_label, callback) => callback(),
  renderDivView: (_area, skipFetch) => dividendRefreshCalls.push(skipFetch),
  renderAcctView: () => {},
});
vm.runInContext(routerSource.slice(routerStart, routerEnd), routerContext);
routerContext.renderView();
routerContext.renderView(true);
routerContext.currentView = 'acct';
routerContext.renderView(true);
routerContext.currentView = 'div';
routerContext.renderView(true);
assert.deepEqual(dividendRefreshCalls, [false, true, false], '배당 최초 진입·재렌더·탭 복귀의 자동 조회 구분');
console.log('배당 탭 재렌더 중복 조회 방지 검사 통과');
