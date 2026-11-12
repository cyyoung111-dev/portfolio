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
assert.equal(context.calcDividends()[0].netReceivedCount,0,
  'gross checkbox is NOT proof of actual net cash');
context.DIVDATA['테스트 종목'].events[0].netReceived = 846;
context.DIVDATA['테스트 종목'].events[0].withheldTax = 154;
assert.equal(context.calcDividends()[0].netReceivedDiv,846);
assert.equal(context.calcDividends()[0].withheldTaxDiv,154);
context.DIVDATA['테스트 종목'].events.push({
 ...context.DIVDATA['테스트 종목'].events[0],source:'OTHER_PROVIDER'
});
assert.equal(context.calcDividends()[0].actualDiv,1000,
 'same economic provider event cannot count twice');
assert.equal(context.calcDividends()[0].receivedDiv,1000,
 'duplicate cash receipt must not be counted twice');
assert.equal(context.calcDividends()[0].netReceivedDiv,846);
context.DIVDATA['테스트 종목'].events.pop();
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
const eventInput={date:'2026-01-02',payDate:'2026-12-01',amount:'100',
 receivedConfirmed:true,netReceived:'846',withheldTax:'154'};
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
vm.runInContext(mgmtSource+'\n'+'globalThis.__setDividendName=name=>{_divManualName=name};',manualCtx);
manualCtx.__setDividendName('테스트 종목');
await manualCtx.saveDivManualEditor();
assert.equal(writes,0,'future payable receipt confirmation must not save');
assert.match(messages.at(-1),/입금 확인/);
eventInput.payDate='2026-01-15';
manualCtx.__setDividendName('테스트 종목');
await manualCtx.saveDivManualEditor();
assert.equal(writes,1);
assert.equal(manualCtx.DIVDATA['005930'].events[0].receivedConfirmed,true,
  'manual receipt marker must survive the actual event save path');
assert.equal(manualCtx.DIVDATA['005930'].events[0].payDate,'2026-01-15');
assert.equal(manualCtx.DIVDATA['005930'].events[0].netReceived,846);
assert.equal(manualCtx.DIVDATA['005930'].events[0].withheldTax,154);
eventInput.receivedConfirmed=false;
manualCtx.__setDividendName('테스트 종목');
await manualCtx.saveDivManualEditor();
assert.equal(writes,1,'cash amounts without payment confirmation must not save');
assert.match(messages.at(-1),/세후 실입금/);
eventInput.receivedConfirmed=true;
manualCtx.document.querySelectorAll=()=>[eventRow,eventRow];
manualCtx.__setDividendName('테스트 종목');
await manualCtx.saveDivManualEditor();
assert.equal(writes,1,'duplicate manual events must not save twice');
assert.match(messages.at(-1),/중복/);
manualCtx.document.querySelectorAll=()=>[eventRow];

const persisted=JSON.parse(JSON.stringify(manualCtx.DIVDATA));
const persistenceSource=fs.readFileSync('src/web/features/settings/settings_persistence_utils.js','utf8');
vm.runInContext(persistenceSource,manualCtx);
manualCtx.DIVDATA['005930'].events[0].receivedConfirmed=false; // simulate stale browser state
manualCtx._applyDivData(persisted); // same normalization as live GAS restoration
assert.equal(manualCtx.DIVDATA['005930'].events[0].receivedConfirmed,true,
  'verified cash deposit must survive actual _applyDivData reload');
assert.equal(manualCtx.DIVDATA['005930'].events[0].netReceived,846);
assert.equal(manualCtx.DIVDATA['005930'].events[0].withheldTax,154);
assert.equal(manualCtx._normalizeDivData({'005930':{events:[{date:'2026-01-02',
  payDate:'2026-01-15',amount:100,receivedConfirmed:'true'}]}})['005930'].events[0].receivedConfirmed,false,
  'untrusted string values cannot forge a payment receipt');
context.DIVDATA=JSON.parse(JSON.stringify(manualCtx.DIVDATA));
context.EDITABLE_PRICES=[{name:'테스트 종목',code:'005930'}];
context.getQtyAtDate=()=>10;
assert.equal(context.calcDividends()[0].receivedDiv,1_000,
  'restored manual receipt must appear in the actual portfolio dividend view');
assert.equal(context.calcDividends()[0].netReceivedDiv,846);
assert.equal(context.calcDividends()[0].withheldTaxDiv,154);
const ignored=manualCtx._normalizeDivData({'005930':{events:[{
 date:'2026-01-02',payDate:'2026-01-15',amount:100,
 receivedConfirmed:false,netReceived:846,withheldTax:154
}]}});
assert.equal(ignored['005930'].events[0].netReceived,undefined,
 'unconfirmed deposited cash must never survive normalization');
assert.equal(ignored['005930'].events[0].withheldTax,undefined);
const forged=manualCtx._normalizeDivData({'005930':{events:[{
 date:'2026-01-02',payDate:'2026-01-15',amount:100,
 receivedConfirmed:true,netReceived:'846',withheldTax:'154'
}]}});
assert.equal(forged['005930'].events[0].netReceived,undefined,
 'untrusted string is not a verified net payment');
assert.equal(forged['005930'].events[0].withheldTax,undefined);

assert.match(source,/올해 입금 확인 \(수동·세전\)/);
assert.doesNotMatch(source,/올해 수령 \(/);
// #734 P1–P3: cash is never inferred from a provider event, and a later
// account transfer must not reclassify an earlier entitlement.
const accountCtx=vm.createContext({
  DIVDATA:{'테스트 종목':{perShare:0,months:[],events:[
    {date:'2026-01-02',payDate:'2026-01-15',amount:100,source:'SEIBRO',
     receivedConfirmed:true,netReceived:846,withheldTax:154},
    {date:'2026-01-02',payDate:'2026-01-15',amount:200,source:'PUBLIC_DATA',
     receivedConfirmed:false}
  ]}},
  EDITABLE_PRICES:[],
  rawHoldings:[{name:'테스트 종목',acct:'ISA',qty:10}],
  rawTrades:[{name:'테스트 종목',acct:'일반'},{name:'테스트 종목',acct:'ISA'}],
  _kstYear:()=>2026,_kstTodayStr:()=> '2026-11-04',
  getQtyAtDate:(name,day,acct)=> acct === '일반' ? 4 : acct === 'ISA' ? 6 : 10,
  getEP:()=>null, getDivRefDate:(y,m)=>y+'-'+String(m).padStart(2,'0')+'-01',
});
vm.runInContext(source,accountCtx);
const accounted=accountCtx.calcDividends()[0];
assert.equal(accounted.annualDiv,1000,'same event with changed amount must replace, not double count');
assert.equal(accounted.monthlyDeclaredGross[1],1000);
assert.equal(accounted.monthlyReceivedGross[1],1000);
assert.equal(accounted.monthlyNetReceived[1],846);
assert.equal(accounted.monthlyWithheldTax[1],154);
assert.equal(accounted.monthlyNetCount[1],1);
assert.equal(accounted.monthlyTaxCount[1],1);
assert.equal(accounted.accountAnnualDiv['일반'],400);
assert.equal(accounted.accountAnnualDiv['ISA'],600);
assert.equal(accounted.unallocatedAnnualDiv,0);
const planSource=fs.readFileSync('src/web/views/views_plan_overview.js','utf8');
const planStart=planSource.indexOf('function _getPlanDividendEntries(');
const planEnd=planSource.indexOf('\n}',planStart)+2;
assert(planStart>=0&&planEnd>planStart);
const planCtx=vm.createContext({
  rows:[{name:'테스트 종목',acct:'ISA',qty:10}],
  ACCT_TAX_TYPES:{'일반':'일반','ISA':'ISA'}
});
vm.runInContext(planSource.slice(planStart,planEnd),planCtx);
const entries=planCtx._getPlanDividendEntries([accounted]);
assert.equal(entries.find(e=>e.acct==='일반')?.amount,400,
  'past general-account dividend cannot move into current ISA');
assert.equal(entries.find(e=>e.acct==='ISA')?.amount,600);
assert.equal(entries.reduce((sum,e)=>sum+e.amount,0),accounted.annualDiv);
accountCtx.DIVDATA['테스트 종목'].events[0].receivedConfirmed=false;
const corrected=accountCtx.calcDividends()[0];
assert.equal(corrected.annualDiv,2000,'latest unconfirmed source correction replaces stale amount');
assert.equal(corrected.netReceivedCount,0,'source correction never fabricates bank deposit');
assert.match(source,/월별 배당 현금흐름/);
assert.match(source,/m\.netCount \? fmtW\(Math\.round\(m\.net\)\) : '미등록'/,
  'missing bank evidence must be labeled missing, not zero');
console.log(JSON.stringify({kind:'ISSUE734_DIVIDEND_CASHFLOW_SOURCE_PASS',
  historicalGeneralGross:400,historicalIsaGross:600,
  declaredGross:1000,bankNetConfirmed:846,verifiedTax:154,
  correctionDeduplicated:true,financeWrites:0,remoteCalls:0}));

console.log('PASS: declared distribution vs manually verified deposit and actual editor save');
