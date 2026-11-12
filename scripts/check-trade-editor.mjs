import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync('src/web/features/trade/editor/mgmt_trade.js', 'utf8');
const elements = {
  'te-name-btns': { innerHTML: '' },
  'te-no-ep-hint': { style: {} },
  'te-name': { value: '' },
  'te-code': { value: '' },
  'te-selected-name': { style: {}, textContent: '' },
  'te-acct': { value: '' },
  'te-acct-group': { innerHTML: '' },
};
const context = {
  window: {},
  rawTrades: [{ id: 101, acct: '계좌1', name: '주식종목' }],
  EDITABLE_PRICES: [
    { name: '주식종목', assetType: '주식' },
    { name: 'ETF종목', assetType: 'ETF' },
  ],
  STOCK_CODE: {},
  getAcctList() { return ['전체','현재계좌']; },
  $el(id) { return elements[id] || null; },
  getEPType(item, fallback) { return item?.assetType || fallback; },
  _escapeHtml(value) { return String(value); },
  _fBtnClass(active) { return active ? 'active' : ''; },
};

vm.runInNewContext(`${source}\n
  globalThis.__testRefresh = _refreshTeCodeList;
  globalThis.__testRefreshAcct = _refreshTeAcctList;
  globalThis.__testEdit = editTrade;
  globalThis.__setOpen = fn => { openAddTrade = fn; };
`, context, { filename: 'src/web/features/trade/editor/mgmt_trade.js' });

let selectedTrade = null;
context.__setOpen(trade => { selectedTrade = trade; });
context.__testEdit('101');
if (!selectedTrade || selectedTrade.id !== 101) {
  console.error('❌ 문자열 dataset ID로 숫자형 기존 거래를 선택하지 못했습니다.');
  process.exit(1);
}

context.__testRefresh('', '', '계좌1', 'ETF');
if (!elements['te-name-btns'].innerHTML.includes('ETF종목') || elements['te-name-btns'].innerHTML.includes('주식종목')) {
  console.error('❌ 거래 유형 선택에 따라 종목 목록이 필터링되지 않았습니다.');
  process.exit(1);
}

if (source.includes("f('te-price').value")) {
  console.error('❌ 존재하지 않는 기존 단가 입력 필드를 참조하고 있습니다.');
  process.exit(1);
}

// A legacy holding may use an account no longer included in the current
// account picker. Opening its editor must not silently reassign the trade.
context.__testRefreshAcct('보관계좌');
assert.equal(elements['te-acct'].value,'보관계좌');
assert.match(elements['te-acct-group'].innerHTML,/data-value="보관계좌"/);
assert.match(elements['te-acct-group'].innerHTML,/data-value="현재계좌"/);
context.__testRefreshAcct('현재계좌');
assert.equal(elements['te-acct'].value,'현재계좌');
context.__testRefreshAcct('');
assert.equal(elements['te-acct'].value,'현재계좌',
  'a brand-new trade without an account still selects the active default');
console.log('✅ 기존 거래 선택·과거 계좌 보존·유형별 종목 필터 검사 통과');

// Production saveTrade with synthetic DOM; never sends requests or writes live data.
function run(trades,qty,date='2026-02-23',opts={}){
const fields={'te-name':opts.name||'시험','te-qty':String(qty),'te-date':date,
 'te-price-krw':String(opts.price ?? 100),
 'te-price-fx':String(opts.fxPrice ?? 150),
 'te-fx-rate':String(opts.fxRate ?? 1300),
 'te-price-fx-krw':String(opts.fxPreview ?? 1),
 'te-acct':opts.acct||'계좌','te-code':'005930','te-assettype':'주식',
 'te-memo':'','te-ratio':String(opts.ratio||'')};
const elements=Object.fromEntries(Object.entries(fields).map(([k,value])=>[k,{value,style:{}}]));elements['te-error']={style:{},textContent:''};elements['te-fx-wrap']={style:{display:opts.fx ? '' : 'none'}};
const ctx={window:{_currentTradeType:opts.type||'sell'},rawTrades:JSON.parse(JSON.stringify(trades)),EDITABLE_PRICES:[{name:'시험',code:'005930',assetType:'주식'}],STOCK_CODE:{},$el:id=>elements[id]||null,normName:x=>x,getEP:()=>({currency:opts.fx?'USD':'KRW'}),getAccountId:()=> 'A',genTradeId:()=>999};
ctx.rawHoldings=[];ctx.migrateLegacyTrades=()=>{};ctx.getEPType=()=> '주식';
ctx.saveHoldings=()=>{ctx.saved=true};ctx.refreshAll=()=>{};
const dataSource=fs.readFileSync('src/web/domain/portfolio/data.js','utf8');
const start=dataSource.indexOf('function _commitTrades('),end=dataSource.indexOf('\n}',start)+2;
const commitSource=dataSource.slice(start,end);
vm.runInNewContext(fs.readFileSync('src/web/domain/portfolio/portfolio_service.js','utf8')+'\n'+commitSource+'\n'+source+'\ncloseTradeEdit=()=>{};'+(opts.editId!=null?'_editingTradeId='+JSON.stringify(opts.editId)+';':'')+'saveTrade();',ctx);
return {saved:!!ctx.saved,error:elements['te-error'].textContent,trades:ctx.rawTrades,holdings:ctx.rawHoldings,pnl:ctx.calcRealizedPnl()};
}
const row=(date,tradeType,qty,ratio)=>({date,tradeType,qty,ratio,name:'시험',code:'005930',acct:'계좌',price:100});
assert.equal(run([row('2026-03-01','buy',10)],1).saved,false,'future buy cannot fund past sale');
assert.equal(run([row('2026-02-01','buy',100),row('2026-03-01','reverse_split',100,10)],20).saved,true,'historical sale before reverse split must use historical quantity');
assert.equal(run([row('2026-02-01','buy',10),row('2026-03-01','sell',8)],4).saved,false,'late sale must not invalidate a later sale');
assert.equal(run([row('2026-02-01','buy',10)],10).saved,true,'exact available quantity is accepted');
assert.equal(run([row('2026-02-01','buy',10)],11).saved,false,'overselling is rejected');
assert.equal(run([row('2026-03-01','buy',100),row('2026-02-01','buy',10)],5).saved,true,'unsorted input uses chronological order');
const renamed=row('2026-02-01','buy',10);renamed.name='이전이름';
assert.equal(run([renamed],5).saved,false,'do not merge names only in validator while downstream accounting groups by name');
const other=row('2026-02-01','buy',10);other.acct='다른계좌';
assert.equal(run([other],1).saved,false,'other account cannot fund sale');
const rejected=run([row('2026-03-01','buy',10)],1);
assert.equal(rejected.trades.length,1,'rejection must not mutate ledger');
const integrated=run([row('2026-02-01','buy',100),row('2026-03-01','reverse_split',100,10)],20);
assert.equal(integrated.holdings[0].qty,8,'actual commit and holdings reducer apply historical sale before later reverse split');
assert.equal(integrated.holdings[0].costAmt,8000);
const cheapBuy=row('2026-02-01','buy',10);cheapBuy.price=50;
const realized=run([cheapBuy],5);
assert.equal(realized.holdings[0].qty,5);assert.equal(realized.holdings[0].costAmt,250);
assert.equal(realized.pnl.totalPnl,250,'actual realized-PnL service agrees with saved trade');
console.log('실제 saveTrade → commit → 보유현황·실현손익 및 소급매도 검증 PASS');


// Existing transactions may be edited years later. Re-validate every subsequent
// sale in both the old and new account+security groups BEFORE ledger mutation.
const historicBuy={id:1,...row('2026-02-01','buy',10)};
const laterSale={id:2,...row('2026-03-01','sell',8)};
const reducePastBuy=run([historicBuy,laterSale],5,'2026-02-01',{type:'buy',editId:1});
assert.equal(reducePastBuy.saved,false,'cannot reduce an old buy below a later sell');
assert.match(reducePastBuy.error,/2026-03-01/);
assert.equal(reducePastBuy.trades[0].qty,10,'rejected correction preserves original buy');

const legacyIdString=run([historicBuy,laterSale],12,'2026-02-01',
 {type:'buy',editId:'1'});
assert.equal(legacyIdString.saved,true,
 'a string dataset ID must update a numeric legacy ID, not silently skip');
assert.equal(legacyIdString.trades.length,2);
assert.equal(legacyIdString.trades[0].qty,12);
assert.equal(legacyIdString.trades[0].id,1,
 'legacy immutable numeric ID must retain its original type after string UI selection');
assert.equal(legacyIdString.holdings[0].qty,4);
const expandPastBuy=run([historicBuy,laterSale],12,'2026-02-01',{type:'buy',editId:1});
assert.equal(expandPastBuy.saved,true,'valid historical buy correction is accepted');
assert.equal(expandPastBuy.trades[0].qty,12);
assert.equal(expandPastBuy.holdings[0].qty,4,'recomputes current holding from amended buy and prior sale');
assert.equal(expandPastBuy.holdings[0].costAmt,400,'preserves exact remaining acquisition cost');

const oldSell={id:3,...row('2026-02-10','sell',5)};
const anotherSell={id:4,...row('2026-03-10','sell',3)};
const expandPastSell=run([historicBuy,oldSell,anotherSell],8,'2026-02-10',{type:'sell',editId:3});
assert.equal(expandPastSell.saved,false,'edit of old sale cannot consume units needed by later sale');
assert.match(expandPastSell.error,/2026-03-10/);
assert.equal(expandPastSell.trades[1].qty,5,'rejected sale edit preserves ledger');

const validPastSell=run([historicBuy,oldSell,anotherSell],6,'2026-02-10',{type:'sell',editId:3,price:120});
assert.equal(validPastSell.saved,true,'non-overselling sale edit is accepted');
assert.equal(validPastSell.holdings[0].qty,1);
assert.equal(validPastSell.holdings[0].costAmt,100);
assert.equal(validPastSell.pnl.totalPnl,120,'edited sale proceeds change realized PnL');

const newAcct=run([historicBuy,laterSale],10,'2026-02-01',{type:'buy',editId:1,acct:'다른계좌'});
assert.equal(newAcct.saved,false,'moving an old buy must revalidate the old account later sale');
assert.equal(newAcct.trades[0].acct,'계좌');
const originalSeller={id:5,...row('2026-01-01','sell',2)};
const anyEdit=run([historicBuy,originalSeller],10,'2026-02-01',{type:'buy',editId:1});
assert.equal(anyEdit.saved,false,'reject an affected ledger already invalid at earlier date');
const missingId=run([historicBuy],10,'2026-02-01',{type:'buy',editId:'not-found'});
assert.equal(missingId.saved,false,'fail closed if edited ID was concurrently deleted');

// A revised split ratio must also preserve every downstream sale.
const split={id:7,...row('2026-02-10','split',10,2)};
const postSplitSale={id:8,...row('2026-03-01','sell',15)};
const unsafeSplit=run([historicBuy,split,postSplitSale],10,'2026-02-10',{type:'split',editId:7,ratio:1});
assert.equal(unsafeSplit.saved,false,'split correction cannot create downstream overselling');
const safeSplit=run([historicBuy,split,postSplitSale],10,'2026-02-10',{type:'split',editId:7,ratio:3});
assert.equal(safeSplit.saved,true);
assert.equal(safeSplit.holdings[0].qty,15,'historical split replays before subsequent sale');
// Editing an existing USD trade previously reused the old hidden KRW
// preview when FX-price/rate listeners had not been attached. Persist the
// newly calculated KRW amount, then recompute real holdings and PnL.
const oldFx={id:99,...row('2026-02-01','buy',10),price:195000,
  priceRaw:150,fxRateAtBuy:1300};
const correctedFx=run([oldFx],10,'2026-02-01',
  {type:'buy',editId:99,fx:true,fxPrice:155.5,fxRate:1350,
   fxPreview:195000});
const fxPriceKrw=Math.round(155.5*1350);
assert.equal(correctedFx.saved,true);
assert.equal(correctedFx.trades[0].price,fxPriceKrw,
 'a stale hidden preview must not overwrite amended foreign unit price');
assert.equal(correctedFx.trades[0].priceRaw,155.5);
assert.equal(correctedFx.trades[0].fxRateAtBuy,1350);
assert.equal(correctedFx.holdings[0].costAmt,fxPriceKrw*10,
 'holdings and graph cost basis must derive from the saved conversion');
const invalidFx=run([oldFx],10,'2026-02-01',
  {type:'buy',editId:99,fx:true,fxPrice:'1e309',fxRate:1350,fxPreview:195000});
assert.equal(invalidFx.saved,false);
assert.equal(invalidFx.trades[0].price,195000,
 'rejected infinite FX input must preserve the original cost and ledger');
const invalidKrw=run([row('2026-02-01','buy',10)],10,
 '2026-02-01',{type:'buy',price:'1e309'});
assert.equal(invalidKrw.saved,false,'infinite KRW purchase price must not persist');
const badRate=run([oldFx],10,'2026-02-01',
  {type:'buy',editId:99,fx:true,fxPrice:150,fxRate:'1e309'});
assert.equal(badRate.saved,false);

// The delegated FX preview handler must be bound once on overlay creation,
// regardless of whether the user first clicked a ticker or reopened a trade.
{
 const callbacks={};
 const overlay={
  addEventListener:(type,cb)=>{(callbacks[type] ||= []).push(cb);}
 };
 const fxFields={
  'te-name':{value:'시험'},'te-price-fx':{value:'160'},
  'te-fx-rate':{value:'1300'},'te-fx-preview':{textContent:''},
  'te-price-fx-krw':{value:'195000'}
 };
 const fxCtx={
  window:{},rawTrades:[],EDITABLE_PRICES:[],STOCK_CODE:{},
  $el:id=>fxFields[id]||null,normName:v=>v,
  getEP:()=>({currency:'USD'})
 };
 vm.runInNewContext(source
  +'\nglobalThis.__bind=_bindTradeEditEvents;',fxCtx);
 fxCtx.__bind(overlay);
 fxCtx.__bind(overlay);
 assert.equal(callbacks.input.length,1,'only one FX listener per overlay');
 callbacks.input[0]({target:{id:'te-fx-rate'}});
 assert.equal(fxFields['te-price-fx-krw'].value,208000,
   'existing trade FX preview must update after editing exchange rate');
 fxFields['te-price-fx'].value='1e309';
 callbacks.input[0]({target:{id:'te-price-fx'}});
 assert.equal(fxFields['te-price-fx-krw'].value,'',
   'infinite derived KRW must be removed from preview');
}
console.log('PASS: historical buy/sell/account/split + legacy account + existing foreign unit-price correction, nonfinite rejection');


// Bulk-import UI explicitly accepts dotted dates. Its writer must store ISO
// so the GAS transaction ledger and historical Snapshot date keys align.
const bulkSource=fs.readFileSync('src/web/features/import/mgmt_bulk.js','utf8');
const bulkContext=vm.createContext({});
vm.runInContext(bulkSource+'\nglobalThis.__date=_normalizeBulkTradeDate;',bulkContext);
assert.equal(bulkContext.__date('2026.02.01'),'2026-02-01');
assert.equal(bulkContext.__date('2026/2/1'),'2026-02-01');
assert.equal(bulkContext.__date('2026-02-01'),'2026-02-01');
assert.equal(bulkContext.__date('2026.02.30'),'','invalid dates are rejected');
assert.match(bulkSource,/date: _normalizeBulkTradeDate\(r\.buyDate\)/);
assert.match(bulkSource,/date: _normalizeBulkTradeDate\(r\.sellDate\)/);
assert.match(bulkSource,/date: _normalizeBulkTradeDate\(r\.date\)/);

const dottedBuy={id:21,...row('2026.02.01','buy',10)};
const dottedSale={id:22,...row('2026-03-01','sell',8)};
const acceptedLegacy=run([dottedBuy],4,'2026-02-20');
assert.equal(acceptedLegacy.saved,true,'legacy dotted buy may fund a later ISO sale');
assert.equal(acceptedLegacy.holdings[0].qty,6);
assert.equal(acceptedLegacy.holdings[0].costAmt,600);
const correctedLegacy=run([dottedBuy,dottedSale],12,'2026-02-01',{type:'buy',editId:21});
assert.equal(correctedLegacy.saved,true,'legacy imported buy may be corrected');
assert.equal(correctedLegacy.holdings[0].qty,4);
const rejectedLegacy=run([dottedBuy,dottedSale],5,'2026-02-01',{type:'buy',editId:21});
assert.equal(rejectedLegacy.saved,false,'legacy dotted buy correction protects later ISO sale');

// Dividend entitlement / projected amount must use units from the corrected
// historical ledger, not the currently displayed holding snapshot.
const dataFull=fs.readFileSync('src/web/domain/portfolio/data.js','utf8');
const qtyStart=dataFull.indexOf('function getQtyAtDate(');
const qtyEnd=dataFull.indexOf('\n}',qtyStart)+2;
const serviceFull=fs.readFileSync('src/web/domain/portfolio/portfolio_service.js','utf8');
const keyStart=serviceFull.indexOf('function _portfolioTradeDateKey(');
const keyEnd=serviceFull.indexOf('\n}',keyStart)+2;
assert.ok(qtyStart>=0&&qtyEnd>qtyStart&&keyStart>=0&&keyEnd>keyStart);
const entitlementContext=vm.createContext({rawTrades:[dottedBuy,dottedSale],rawHoldings:[],
  _kstTodayStr:()=> '2026-11-04'});
vm.runInContext(serviceFull.slice(keyStart,keyEnd)+'\n'+dataFull.slice(qtyStart,qtyEnd)
  +'\nglobalThis.__qty=getQtyAtDate;',entitlementContext);
assert.equal(entitlementContext.__qty('시험','2026-02-15'),10);
assert.equal(entitlementContext.__qty('시험','2026-03-02'),2);
entitlementContext.rawTrades[0]={...dottedBuy,qty:12};
assert.equal(entitlementContext.__qty('시험','2026-02-15'),12);
assert.equal(entitlementContext.__qty('시험','2026-03-02'),4);
console.log('PASS: bulk dotted-date ISO normalization, legacy trading chronology and dividend entitlement units');


// Exercise production applyBulkImport, not just source snippets. A mixed batch
// with an invalid date must fail atomically across buy/sell/mixed modes.
{
  const errorBox={style:{display:'none'},textContent:''};
  const ctx=vm.createContext({
    rawTrades:[],STOCK_CODE:{},$el:id=>id==='bulkError'?errorBox:null,
    normName:x=>x,getAccountId:()=> 'acct-A',
    genTradeId:()=> 900,
    getEP:()=>({name:'시험',code:'005930',assetType:'주식'}),
    epPush:()=>{ctx.masterWrites++},
    _commitTrades:()=>{ctx.commits++},
    closeBulkImport:()=>{ctx.closed++},
    showToast:()=>{},commits:0,masterWrites:0,closed:0
  });
  const exposeImport=[
    "globalThis.__setImport=(mode,rows)=>{",
    " _bulkMode=mode;",
    " if(mode==='buy')_bulkRows=rows;",
    " else if(mode==='sell')_bulkRowsSell=rows;",
    " else _bulkRowsMix=rows;",
    "};",
    "globalThis.__applyImport=applyBulkImport;"
  ].join('\n');
  vm.runInContext(bulkSource+'\n'+exposeImport,ctx);
  // The production module defines closeBulkImport; replace only that UI side-effect after evaluation.
  ctx.closeBulkImport=()=>{ctx.closed++};
  for(const [mode,dateKey,priceKey] of [
    ['buy','buyDate','buyPrice'],
    ['sell','sellDate','sellPrice'],
    ['mixed','date','price']
  ]){
    const good={name:'시험',acct:'계좌',code:'005930',qty:'2',
      [dateKey]:'2026.02.01',[priceKey]:'100',tradeType:'buy'};
    const bad={...good,[dateKey]:'2026.02.30'};
    ctx.rawTrades.length=0;ctx.commits=0;ctx.masterWrites=0;ctx.closed=0;
    ctx.__setImport(mode,[good,bad]);
    ctx.__applyImport();
    assert.equal(ctx.rawTrades.length,0,mode+': invalid batch must not append any trade');
    assert.equal(ctx.commits,0,mode+': invalid batch must not persist');
    assert.equal(ctx.masterWrites,0,mode+': invalid batch must not mutate master');
    assert.equal(ctx.closed,0,mode+': invalid batch must retain editor');
    assert.match(errorBox.textContent,/날짜가 잘못/);
    ctx.__setImport(mode,[good]);
    ctx.__applyImport();
    assert.equal(ctx.rawTrades.length,1,mode+': valid batch adds one trade');
    assert.equal(ctx.rawTrades[0].date,'2026-02-01',mode+': normalized ISO persisted');
    assert.equal(ctx.commits,1,mode+': commits exactly once');
    assert.equal(ctx.closed,1,mode+': closes only after commit');
  }
}
console.log('PASS: REAL bulk buy/sell/mixed atomic date rejection and ISO persistence');

