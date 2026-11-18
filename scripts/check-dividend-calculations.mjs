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
accountCtx.DIVDATA['테스트 종목'].events.push({
  date:'2026-01-02',payDate:'2026-01-15',amount:100,
  receivedConfirmed:true,source:'PUBLIC_DATA'
});
assert.equal(accountCtx.calcDividends()[0].netReceivedDiv,846,
 'duplicate confirmed gross cannot erase an earlier real bank receipt');
accountCtx.DIVDATA['테스트 종목'].events.pop();
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

// The issuer-level public API can return SK common 6,500 and preferred
// 6,550 under a single company registration. Neither may be silently picked
// for the held 034730 common shares without a security-class match.
const shareClassCtx=vm.createContext({
 DIVDATA:{'SK':{source:'PUBLIC_DATA',perShare:6525,months:[4],events:[
  {date:'2026-04-01',payDate:'2026-04-24',amount:6500,source:'PUBLIC_DATA'},
  {date:'2026-04-01',payDate:'2026-04-24',amount:6550,source:'PUBLIC_DATA'},
  {date:'2026-08-18',payDate:'2026-08-31',amount:1500,source:'PUBLIC_DATA'}
 ]}},
 EDITABLE_PRICES:[],rawHoldings:[{name:'SK',acct:'일반',qty:2}],
 _kstYear:()=>2026,_kstTodayStr:()=> '2026-11-16',
 getQtyAtDate:()=>2,getEP:()=>null,getDivRefDate:(y,m)=>y+'-'+String(m).padStart(2,'0')+'-30'
});
vm.runInContext(source,shareClassCtx);
const shareClassRow=shareClassCtx.calcDividends().find(r=>r.name==='SK');
assert.equal(shareClassRow.ambiguousPublicEvents,1);
assert.equal(shareClassRow.actualDiv,3000,
 'only unambiguous August public distribution counts');
assert.equal(shareClassRow.annualDiv,3000,
 'uncertain April amount must not be replaced by a forecast');
assert.equal(shareClassRow.monthlyDiv[4],undefined);
assert.equal(shareClassRow.monthlyDiv[8],3000);
assert.match(source,/배당 기준일의 보통주·우선주 금액이 충돌/);

console.log('PASS: declared distribution vs manually verified deposit and actual editor save');

const planCalc=fs.readFileSync('src/web/domain/plan/plan_calculations.js','utf8');
vm.runInContext(planCalc,accountCtx);
accountCtx.ACCT_TAX_TYPES={'일반':'일반','ISA':'ISA','연금':'연금저축','IRP':'IRP'};
accountCtx.DIVDATA['테스트 종목']={perShare:50,months:[2],events:[
 {date:'2026-01-02',payDate:'2026-01-15',amount:100,receivedConfirmed:true,netReceived:846,withheldTax:154}
]};
accountCtx.rawHoldings=[{name:'테스트 종목',acct:'ISA',qty:10}];
accountCtx.rawTrades=[{name:'테스트 종목',acct:'일반'},{name:'테스트 종목',acct:'ISA'}];
accountCtx.getQtyAtDate=(_n,day,acct)=>day==='2026-01-02'?(acct==='일반'?4:acct==='ISA'?6:10):(acct==='일반'?0:acct==='ISA'?10:10);
const splitRows=accountCtx.calcDividends();
const split=accountCtx._divTaxSummary(splitRows);
assert.equal(split.all.annual,1500);
assert.equal(split.normal.annual,400);
assert.equal(split.isa.annual,1100);
assert.equal(split.normal.actual,400);
assert.equal(split.isa.actual,600);
assert.equal(split.normal.received,400);
assert.equal(split.isa.received,600);
assert.equal(split.normal.monthly[1],400);
assert.equal(split.normal.monthly[2],undefined);
assert.equal(split.isa.monthly[2],500);
const general=accountCtx._divTaxFilteredRows(splitRows,'normal')[0];
assert.equal(general.annualDiv,400);
assert.equal(general.totalQty,0,'historical general dividends survive a transfer to ISA');
assert.equal(general.monthlyDiv[1],400);
assert.equal(splitRows[0].netReceivedDiv,846,'bank net stays full-scope; never allocate without evidence');
const entries2=planCtx._getPlanDividendEntries(splitRows);
const planFlow=accountCtx.PlanCalculations.calculateDividendCashflow({dividends:entries2});
assert.equal(planFlow.normalGross,split.normal.annual);
assert.equal(planFlow.isaInternal,split.isa.annual);
assert.equal(planFlow.totalGross,split.all.annual);
assert.match(accountCtx._divTaxPanel(split,'normal'),/data-div-tax="normal" aria-pressed="true"/);
assert.match(accountCtx._divTaxPanel(split,'normal'),/고배당기업 분리과세/);
accountCtx.getQtyAtDate=(_n,_day,acct)=>acct?3:10;
const unresolved=accountCtx._divTaxSummary(accountCtx.calcDividends());
assert.equal(unresolved.unclassified.annual,1500,'quantity mismatch remains unallocated');
assert.equal(unresolved.normal.annual,0);
assert.equal(unresolved.isa.annual,0);
assert.equal(unresolved.all.annual,1500);
console.log('PASS: entitlement-date tax group, monthly filter, plan reconciliation and unknown allocation');


// Exercise the actual dividend view and its local-only filter, not just math.
accountCtx.getQtyAtDate=(_n,day,acct)=>day==='2026-01-02'?(acct==='일반'?4:acct==='ISA'?6:10):(acct==='일반'?0:acct==='ISA'?10:10);
accountCtx.GSHEET_API_URL='';
accountCtx._kstNow=()=>new Date('2026-11-18T15:00:00Z');
accountCtx._dividendLinkState={state:'idle',message:'테스트'};
accountCtx.rows=[{name:'테스트 종목',acct:'ISA',costAmt:2000}];
accountCtx.window={innerWidth:1440};
accountCtx.ACCT_COLORS={'일반':'#123456','ISA':'#234567'};
accountCtx.fmtW=String;
accountCtx._escapeHtml=String;
accountCtx.buildDivMgmt=()=>{};
const divArea={innerHTML:'',querySelector:()=>null};
accountCtx.$el=()=>divArea;
accountCtx.renderDivView(divArea,true);
assert.match(divArea.innerHTML,/세제 유형별 연간 배당/);
assert.match(divArea.innerHTML,/일반계좌 연간 세후 참고/);
assert.match(divArea.innerHTML,/<td>일반계좌<\/td><td>400<\/td><td>400<\/td><td>0<\/td><td>400<\/td>/);
assert.match(divArea.innerHTML,/<td>ISA<\/td><td>1,100<\/td><td>600<\/td><td>500<\/td><td>600<\/td>/);
accountCtx._setDivTaxFilter('normal');
assert.match(divArea.innerHTML,/data-div-tax="normal" aria-pressed="true"/);
assert.match(divArea.innerHTML,/2026년 월별 배당 · 일반계좌/);
assert.match(divArea.innerHTML,/1월 배당 400원/);
assert.match(divArea.innerHTML,/2월 배당 0원/);
assert.match(divArea.innerHTML,/<td>합계<\/td><td>1,500<\/td>/,'aggregate never changes with detail filter');
accountCtx._setDivMonthFilter(1);
assert.match(divArea.innerHTML,/종목별 배당 상세 · 일반계좌 · 1월/);
accountCtx._setDivTaxFilter('isa');
assert.match(divArea.innerHTML,/1월 배당 600원/);
assert.match(divArea.innerHTML,/2월 배당 500원/);
assert.match(divArea.innerHTML,/은행 실입금 <b>846<\/b>/,'net receipt stays unallocated and full-scope');
console.log('PASS: actual rendering of dividend totals and tax/month filter');

// Real calculation, legal brackets, year boundaries, exact security classes and
// entitlement-day account attribution; never auto-exclude future forecasts.
const P=accountCtx.PlanCalculations;
for(const [gross,expected] of [[0,0],[20000000,3080000],[21000000,3300000],[300000000,64680000],[301000000,64955000],[5000000000,1357180000],[5001000000,1357510000]])assert.equal(P.calculateSpecialDividendTax(gross,2026),expected);
assert.equal(P.calculateSpecialDividendTax(30000000,2030),null);
const exact={code:'005930',assetType:'주식',recordDate:'2025-12-31',payDate:'2026-04-17',amount:566,year:2026,declared:true};
assert.equal(P.specialDividendEvidence(exact).status,'reviewed');
for(const patch of [{code:'005935'},{amount:567},{recordDate:'2026-03-31'},{payDate:''},{declared:false},{year:2027},{code:'034730'}])assert.notEqual(P.specialDividendEvidence({...exact,...patch}).status,'reviewed');
assert.equal(P.specialDividendEvidence({...exact,assetType:'ETF'}).status,'ordinary');
const sc=P.calculateDividendTaxScenario({normalGross:28000000,reviewedGross:12000000,pendingGross:5000000,interest:2000000,year:2026});
assert.equal(sc.ordinaryWithoutApplication,30000000);assert.equal(sc.ordinaryWithApplication,18000000);assert.equal(sc.headroom,2000000);assert.equal(sc.specialTax,1848000);
assert.equal(P.calculateDividendTaxScenario({normalGross:28000000,reviewedGross:12000000,year:2030}).ordinaryWithApplication,28000000);
assert.equal(P.calculateDividendTaxScenario({normalGross:100}).interestKnown,false);
accountCtx.EDITABLE_PRICES=[{code:'005930',name:'삼성전자',assetType:'주식'}];
accountCtx.getEP=()=>accountCtx.EDITABLE_PRICES[0];
accountCtx.rawHoldings=[{name:'삼성전자',acct:'ISA',qty:10}];
accountCtx.rawTrades=[{name:'삼성전자',acct:'일반'},{name:'삼성전자',acct:'ISA'}];
accountCtx.DIVDATA={'005930':{perShare:100,months:[12],events:[{date:'2025-12-31',payDate:'2026-04-17',amount:566}]}};
accountCtx.getQtyAtDate=(_n,day,acct)=>day==='2025-12-31'?(acct==='일반'?4:acct==='ISA'?6:10):(acct==='일반'?0:acct==='ISA'?10:10);
const hiRows=accountCtx.calcDividends(),hi=accountCtx._divTaxSummary(hiRows);
assert.equal(hi.normal.specialReviewed,2264);assert.equal(hi.isa.specialReviewed,3396);assert.equal(hi.isa.specialPending,1000);
const hiPlan=P.calculateDividendCashflow({dividends:planCtx._getPlanDividendEntries(hiRows),year:2026});
assert.equal(hiPlan.specialTaxScenario.reviewedGross,2264);assert.equal(hiPlan.specialTaxScenario.ordinaryWithApplication,0);
assert.match(accountCtx._divTaxPanel(hi,'normal',hiRows),/2,264원/);
assert.match(accountCtx._divTaxPanel(hi,'normal',hiRows),/이자·기타 금융소득 미포함/);
console.log('PASS: progressive dividend special tax, date/security checks, account attribution and plan reconciliation');

// Unknown identity is never treated as a confirmed exclusion. Session-local
// interest assumption is shared with the plan and does not mutate records.
assert.equal(P.specialDividendEvidence({...exact,assetType:'',code:''}).status,'pending');
assert.equal(P.specialDividendEvidence({...exact,code:'0347K0'}).status,'pending');
let otherValue='2,000,000';
accountCtx.$el=id=>id==='div-other-income-scenario'?{value:otherValue}:divArea;
accountCtx._applyDivOtherIncome();
assert.equal(accountCtx._getDivOtherIncome(2026),2000000);
assert.match(accountCtx._divTaxPanel(hi,'normal',hiRows),/입력 가정 포함/);
const withInterest=P.calculateDividendCashflow({dividends:planCtx._getPlanDividendEntries(hiRows),year:2026,otherFinancialIncome:accountCtx._getDivOtherIncome(2026)});
assert.equal(withInterest.specialTaxScenario.ordinaryWithApplication,2000000);
otherValue='';accountCtx._applyDivOtherIncome();assert.equal(accountCtx._getDivOtherIncome(2026),null);
console.log('PASS: shared session-only non-dividend income scenario and missing identity protection');

// Quarterly/interim eligibility must not be limited to final dividends.
// Official dates and class-specific amounts are required for exact matches.
for(const code of ['005930','005935']){
 for(const [recordDate,payDate,amount] of [['2026-03-31','2026-05-29',372],['2026-06-30','2026-08-28',374],['2026-09-30','2026-11-27',4601]]){
  const event={...exact,code,recordDate,payDate,amount};
  assert.equal(P.specialDividendEvidence(event).status,'reviewed');
  assert.equal(P.specialDividendEvidence({...event,payDate:'2026-12-31'}).status,'pending');
  assert.equal(P.specialDividendEvidence({...event,amount:amount+1}).status,'pending');
 }
}
assert.equal(P.specialDividendEvidence({...exact,payDate:'2026-12-31'}).status,'pending');
const conflict=P.calculateDividendCashflow({dividends:[{taxType:'NORMAL',amount:100,specialReviewed:100,specialPending:100},{taxType:'NORMAL',amount:100}],year:2026});
assert.equal(conflict.specialTaxScenario.reviewedGross,100);
assert.equal(conflict.specialTaxScenario.pendingGross,0);
console.log('PASS: quarterly cash dividends, date bounds, no overlapping reviewed and pending tax amounts');

// Negative/review-required reference overrides earlier positive evidence.
for(const status of ['revoked','reviewRequired','ineligible'])assert.equal(P.specialDividendEvidence(exact,[...P.DIVIDEND_SPECIAL_REFERENCE,{code:'005930',year:2026,status}]).status,'pending');
assert.match(accountCtx._divSpecialEvidenceTable(hiRows,2026),/2026-09-30 배당/);
console.log('PASS: disclosure correction precedence and payment-specific source links');

// Current company index changes independently of the application release.
{
 const row={listedCode:'005930',issuerName:'삼성전자',market:'KOSPI',businessYear:2025,identityState:'EXACT_LISTED_ISSUER',taxEligibility:'UNVERIFIED'};
 const base={schemaVersion:1,classification:'CANDIDATE_ONLY',source:'https://kind.krx.co.kr/valueup/dividend.do?method=valueupHighDividendMain',businessYear:2025,retrievedAt:new Date().toISOString(),total:1,rows:[row],unresolved:[],recheckCodes:[],reviewChanges:[]};
 assert.equal(P.setDividendCompanyCatalog({...base,businessYear:2024},2026),false);
 assert.equal(P.setDividendCompanyCatalog(base,2026),true);
 assert.equal(P.dividendCompanyCandidate('005930',2026).state,'candidate');
 assert.equal(P.specialDividendEvidence({...exact,declared:false}).status,'candidate');
 const s=P.calculateDividendTaxScenario({normalGross:300,reviewedGross:100,pendingGross:100,candidateGross:100,year:2026});
 assert.equal(s.ordinaryWithApplication,200);assert.equal(s.ordinaryIfCandidatesQualify,100);
 assert.equal(P.setDividendCompanyCatalog({...base,recheckCodes:['005930']},2026),true);
 assert.equal(P.specialDividendEvidence(exact).status,'pending');
 assert.equal(P.specialDividendEvidence({...exact,code:'005935',amount:567}).status,'pending');
 assert.equal(P.dividendCompanyCandidate('005930',2026).state,'reviewRequired');
}
console.log('PASS: public company list, candidate-only scenario and persistent correction hold');

{
 const input={normalGross:60000000,reviewedGross:30000000,interest:0,year:2026,taxDetails:{otherTaxBase:70000000,grossUpOrdinary:0,grossUpSpecial:0}};
 const result=P.calculateDividendTaxScenario(input);
 assert.equal(result.comparison.withoutApplication,16302000);assert.equal(result.comparison.withApplication,11000000);assert.equal(result.comparison.savings,5302000);
 const low=P.calculateDividendTaxScenario({...input,taxDetails:{...input.taxDetails,otherTaxBase:10000000}});
 assert.equal(low.comparison.withoutApplication,9284000);assert.equal(low.comparison.withApplication,9900000);assert.equal(low.comparison.savings,-616000);
 const ex=P.calculateDividendTaxScenario({normalGross:28000000,reviewedGross:5000000,candidateGross:5000000,pendingGross:5000000,interest:2000000,year:2026,
   taxDetails:{capitalExempt:2000000,etfTaxDifference:1000000,certificateSpecial:10000000,otherTaxBase:50000000,grossUpOrdinary:15000000,grossUpSpecial:10000000}});
 assert.equal(ex.taxableGross,25000000);assert.equal(ex.selectedSpecialGross,10000000);assert.equal(ex.ordinaryWithApplication,17000000);assert.equal(ex.comparison.unapplied.grossUp,700000);assert.equal(ex.comparison.applied.grossUp,0);assert.equal(ex.ordinaryIfCandidatesQualify,17000000);assert.equal(ex.normalGross,28000000);
 assert.equal(P.calculateDividendTaxScenario({...input,interest:null}).comparison,null);
 assert.equal(P.calculateDividendTaxScenario({...input,taxDetails:{otherTaxBase:0,capitalExempt:70000000}}).adjustmentValid,false);
 assert.equal(P.calculateDividendTaxScenario({...input,taxDetails:{otherTaxBase:0,grossUpOrdinary:90000000}}).comparison,null);
 assert.equal(P.calculateDividendTaxScenario({...input,year:2027}).comparison,null);
 assert.equal(P.estimateOrdinaryFinancialTax({financialGross:30000000,otherTaxBase:0,grossUpEligible:30000000}).incrementalTax,4620000);
 assert.equal(P.progressiveIncomeTax(50000000),6240000);assert.equal(P.progressiveIncomeTax(88000000),15360000);
 assert.equal(accountCtx.calcDividends(2025).reduce((n,x)=>n+x.annualDiv,0),0);
 assert.match(accountCtx._divTaxComparisonPanel(hi,2026),/과세 제외 감액배당/);
 assert.match(accountCtx._divTaxComparisonPanel(hi,2026),/다른 종합소득 과세표준/);
}
console.log('PASS: tax comparison, credit floor, non-tax cash adjustments and historical year');

const sharedTaxSource=fs.readFileSync('src/web/views/views_plan_tax.js','utf8');
assert.match(sharedTaxSource,/const taxRows=calcDividends\(taxYear\)/);
for(const [name,group] of [['normalDiv','normal'],['isaDiv','isa'],['irpDiv','irp'],['pensionDiv','pension']])assert.ok(sharedTaxSource.includes('const '+name+' = sharedSummary.'+group+'.annual;'));
assert.doesNotMatch(sharedTaxSource,/_qtyAtDateFast|_divSum\(/,'no second dividend entitlement engine');
assert.match(accountCtx._divTaxComparisonPanel(hi,2026),/계좌 귀속 미확인/);
