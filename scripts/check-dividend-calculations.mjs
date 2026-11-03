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
  _kstTodayStr: () => '2026-11-04',
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
assert.equal(rows[0].receivedDiv, 0,
  'provider event with past payable date is NOT verified as received cash');
context.DIVDATA['테스트 종목'].events[0].receivedConfirmed = true;
assert.equal(context.calcDividends()[0].receivedDiv, 1_000,
  'explicitly confirmed cash receipt must use historical entitlement units');
context.DIVDATA['테스트 종목'].events[0].receivedConfirmed = false;
context.DIVDATA['테스트 종목'].events[1].receivedConfirmed = true;
assert.equal(context.calcDividends()[0].receivedDiv, 0,
  'a future payment confirmation must not be counted in cash received');
context.DIVDATA['테스트 종목'].events[1].receivedConfirmed = false;
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


// Exercise the production manual-event save function, not just the rendered
// checkbox source: future payable dates must fail before remote persistence.
const mgmtSource=fs.readFileSync('src/web/features/dividend/mgmt_div.js','utf8');
const messages=[];
let writes=0;
const manualFields={
  'dv_amt_manual':{value:''},
  'dv_freq_manual':{value:'-'},
  'dv_months_manual':{value:''},
  'divManualModal':{style:{}},
};
const eventInput={date:'2026-01-02',payDate:'2026-12-01',amount:'100',receivedConfirmed:true};
const eventRow={querySelector:selector=>{
  const key=selector.match(/data-div-event="([^"]+)"/)?.[1];
  return key==='receivedConfirmed'?{checked:eventInput[key]}:{value:eventInput[key]||''};
}};
const manualCtx=vm.createContext({
  window:{},document:{
    querySelectorAll:()=>[eventRow],
    querySelector:()=>({disabled:false,textContent:''})
  },
  DIVDATA:{},$el:id=>manualFields[id]||null,getDivKey:()=> '005930',
  _kstTodayStr:()=> '2026-11-04',
  persistDividendSettings:async()=>{writes++;return true},
  showToast:message=>messages.push(message),
});
vm.runInContext(mgmtSource+String.raw