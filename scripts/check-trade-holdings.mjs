import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync('src/web/domain/portfolio/portfolio_service.js', 'utf8');
const context = {
  rawTrades: [],
  rawHoldings: [{ acct: '기존', name: '잔존값', qty: 1 }],
  migrateLegacyTrades() {},
  getEP() { return null; },
  getEPType(_ep, fallback) { return fallback || '주식'; },
  getAcctTaxType() { return '일반'; },
  EDITABLE_PRICES: [],
  fundDirect: {},
  STOCK_CODE: {},
  epPush() {},
};
vm.runInNewContext(source, context, { filename: 'src/web/domain/portfolio/portfolio_service.js' });

context.syncHoldingsFromTrades({ clearWhenEmpty: true });
if (context.rawHoldings.length !== 0) {
  console.error('❌ 마지막 거래 삭제 후 보유현황이 비워지지 않았습니다.');
  process.exit(1);
}

const editorSource = fs.readFileSync('src/web/features/management/mgmt_editor.js', 'utf8');
const editorHoldingMatch = editorSource.match(/function\s+_isCurrentEditorHolding\s*\([^)]*\)\s*\{[\s\S]*?\n\}/);
if (!editorHoldingMatch) {
  console.error('❌ 현재가 편집기의 보유수량 필터 함수가 없습니다.');
  process.exit(1);
}
const editorContext = {
  rawHoldings: [],
  STOCK_CODE: {},
  normName: value => String(value || '').trim(),
  normalizeStockCode: value => String(value || '').trim(),
};
vm.runInNewContext(editorHoldingMatch[0], editorContext, { filename: 'editor-holding-filter.js' });
const worldBig4 = { name: '피델리티 월드Big4 (주식)', code: 'F00003', assetType: '펀드' };
editorContext.rawHoldings.push({ name: worldBig4.name, code: worldBig4.code, qty: 1 });
if (!editorContext._isCurrentEditorHolding(worldBig4)) {
  console.error('❌ 보유수량이 있는 펀드가 현재가 편집기에서 제외됐습니다.');
  process.exit(1);
}
editorContext.rawHoldings[0].qty = 0;
if (editorContext._isCurrentEditorHolding(worldBig4)) {
  console.error('❌ 전량 매도한 펀드가 현재가 편집기에 남았습니다.');
  process.exit(1);
}

if (!fs.readFileSync('src/web/domain/portfolio/data.js', 'utf8').includes("editor?.classList.contains('open')")) {
  console.error('❌ 거래 저장 후 열려 있는 현재가 편집기를 즉시 갱신해야 합니다.');
  process.exit(1);
}

const tradesViewSource = fs.readFileSync('src/web/views/views_trades.js', 'utf8');
const tradesViewContext = { console, Map, setTimeout, clearTimeout,
  _portfolioTradeDateKey: context._portfolioTradeDateKey };
vm.runInNewContext(tradesViewSource, tradesViewContext, { filename: 'src/web/views/views_trades.js' });
const worldBig4Buy = {
  date: '2025-12-29', tradeType: 'buy', acct: '우리',
  name: '피델리티 월드Big4 (주식)', qty: 1, price: 28060315,
};
const worldBig4Sell = {
  date: '2026-08-24', tradeType: 'sell', acct: '우리',
  name: '피델리티 월드Big4 (주식)', qty: 1, price: 42051905,
};
const realizedContext = tradesViewContext._buildTradeRealizedContext([worldBig4Sell, worldBig4Buy]);
const worldBig4Realized = realizedContext.realizedByTrade.get(worldBig4Sell);
if (!worldBig4Realized
    || Math.round(worldBig4Realized.pnl) !== 13991590
    || Number(worldBig4Realized.pct.toFixed(1)) !== 49.9) {
  console.error('❌ 최신순 화면에서도 월드Big4 매도의 실현손익을 날짜순 원장 기준으로 계산해야 합니다.');
  process.exit(1);
}

// Historical trade edits must yield the same realized P&L and remaining
// account-level cost in the trade tab and portfolio reducer. Real production
// functions operate on synthetic, nonfinancial ledger rows only.
{
  const buy = { id:'old-buy', date:'2026/6/5', tradeType:'buy', acct:'ISA',
    name:'Legacy ETF', qty:10, price:100, assetType:'ETF' };
  const sell = { id:'old-sell', date:'2026.06.10', tradeType:'sell', acct:'ISA',
    name:'Legacy ETF', qty:3, price:140, assetType:'ETF' };
  const pensionBuy = { id:'pension-buy', date:'2026-06-02', tradeType:'buy', acct:'IRP',
    name:'Legacy ETF', qty:5, price:80, assetType:'ETF' };
  const pensionSell = { id:'pension-sell', date:'2026-06-11', tradeType:'sell', acct:'IRP',
    name:'Legacy ETF', qty:1, price:100, assetType:'ETF' };
  const input=[sell,pensionSell,buy,pensionBuy]; // reverse chronology is deliberate
  context.rawTrades.length=0;
  context.rawTrades.push(...input);
  context.syncHoldingsFromTrades({clearWhenEmpty:true});
  const isa=context.rawHoldings.find(x=>x.acct==='ISA');
  const irp=context.rawHoldings.find(x=>x.acct==='IRP');
  if(!isa||isa.qty!==7||isa.costAmt!==700
      ||!irp||irp.qty!==4||irp.costAmt!==320
      ||context.calcRealizedPnl().totalPnl!==140)
    throw Error('legacy trade dates/account-aware holdings or realized P&L mismatch');
  const before=tradesViewContext._buildTradeRealizedContext(input);
  if(before.realizedByTrade.get(sell)?.pnl!==120
      ||before.realizedByTrade.get(pensionSell)?.pnl!==20
      ||before.currentAvgByKey['ISA||Legacy ETF']!==100)
    throw Error('trade tab P&L sorted before historical buy or mixes ISA/IRP');

  // Correct an earlier buy price; no other account or original trade day
  // may change and both UI/reducer must recalculate from that old trade.
  buy.price=110;
  context.syncHoldingsFromTrades({clearWhenEmpty:true});
  const corrected=tradesViewContext._buildTradeRealizedContext(input);
  if(context.rawHoldings.find(x=>x.acct==='ISA')?.costAmt!==770
      ||context.rawHoldings.find(x=>x.acct==='IRP')?.costAmt!==320
      ||context.calcRealizedPnl().totalPnl!==110
      ||corrected.realizedByTrade.get(sell)?.pnl!==90
      ||corrected.realizedByTrade.get(pensionSell)?.pnl!==20
      ||buy.date!=='2026/6/5')
    throw Error('historical buy price correction failed remaining cost / realized P&L');

  context._tradeFilter={acct:'',name:'',type:''};
  context._tradeSort={key:'date',dir:1};
  const ordered=context._getFilteredTrades();
  if(ordered[0]!==pensionBuy||ordered[1]!==buy
      ||ordered[2]!==sell||ordered[3]!==pensionSell)
    throw Error('trades display must sort legacy and ISO day formats chronologically');
  context._tradeSort={key:'date',dir:-1};
  if(context._getFilteredTrades()[0]!==pensionSell)
    throw Error('descending trade history sort must use normalized trade dates');
}
{
  const stockBuy={id:'split-buy', date:'2026-07-01',tradeType:'buy',
    acct:'ISA',name:'Split test',qty:10,price:100,assetType:'주식'};
  const split={id:'split',date:'2026.7.2',tradeType:'split',
    acct:'ISA',name:'Split test',ratio:2,assetType:'주식'};
  const sell={id:'split-sell',date:'2026/7/3',tradeType:'sell',
    acct:'ISA',name:'Split test',qty:5,price:60,assetType:'주식'};
  const trades=[sell,split,stockBuy];
  context.rawTrades.length=0;context.rawTrades.push(...trades);
  context.syncHoldingsFromTrades({clearWhenEmpty:true});
  const chart=tradesViewContext._buildTradeRealizedContext(trades);
  if(chart.realizedByTrade.get(sell)?.pnl!==50
      ||chart.realizedByTrade.get(sell)?.avgCost!==50
      ||context.calcRealizedPnl().totalPnl!==50
      ||context.rawHoldings[0]?.qty!==15||context.rawHoldings[0]?.costAmt!==750)
    throw Error('split-adjusted realized P&L must match the holdings reducer');
  const reverse={id:'reverse',date:'2026-07-04',tradeType:'reverse_split',
    acct:'ISA',name:'Split test',ratio:3,assetType:'주식'};
  const postReverse={id:'after-reverse',date:'2026-07-05',tradeType:'sell',
    acct:'ISA',name:'Split test',qty:1,price:175,assetType:'주식'};
  const second=[postReverse,reverse,...trades];
  context.rawTrades.length=0;context.rawTrades.push(...second);
  context.syncHoldingsFromTrades({clearWhenEmpty:true});
  const result=tradesViewContext._buildTradeRealizedContext(second);
  // The reverse split follows the first sale: 15 shares at 50 become 5 at 150.
  if(result.realizedByTrade.get(postReverse)?.avgCost!==150
      ||result.realizedByTrade.get(postReverse)?.pnl!==25
      ||context.calcRealizedPnl().totalPnl!==75
      ||context.rawHoldings[0]?.qty!==4||context.rawHoldings[0]?.costAmt!==600)
    throw Error('reverse split breaks chronological realized cost or remaining holdings');
}
// Deleting the last legacy-date transaction must inform the explicit-empty
// remote sync of the original affected day, not an empty rebuildFrom.
{
  const lone={id:'legacy-only',date:'2026.6.5',tradeType:'buy',acct:'ISA',
    name:'Old ETF',qty:2,price:100};
  const commits=[];
  tradesViewContext.rawTrades=[lone];
  tradesViewContext.document={querySelectorAll:()=>[{dataset:{id:'legacy-only'}}]};
  tradesViewContext.confirm=()=>true;
  tradesViewContext.showToast=msg=>{throw Error('unexpected deletion error: '+msg);};
  tradesViewContext._commitTrades=options=>commits.push(options);
  tradesViewContext.deleteSelectedTrades();
  if(tradesViewContext.rawTrades.length!==0||commits.length!==1
    ||commits[0].allowEmptyTradeSync!==true
    ||commits[0].emptyTradeSyncFrom!=='2026-06-05')
    throw Error('deleting last legacy trade lost earliest Snapshot rebuild date');
}

context.rawHoldings.push({ acct: '기존', name: '잔존값', qty: 1 });
context.rawTrades.push(
  { date: '2026-01-01', tradeType: 'buy', acct: '계좌1', name: '테스트', qty: 10, price: 1000, assetType: '주식' },
  { date: '2026-01-02', tradeType: 'sell', acct: '계좌1', name: '테스트', qty: 10, price: 1100, assetType: '주식' },
);
context.syncHoldingsFromTrades({ clearWhenEmpty: true });
if (context.rawHoldings.length !== 0) {
  console.error('❌ 전량 매도 후 과거 보유현황이 남았습니다.');
  process.exit(1);
}

context.rawTrades.length = 0;
context.rawTrades.push(
  { date: '2026-01-03', tradeType: 'buy', acct: '계좌1', name: '테스트', qty: 3, price: 1200, assetType: '주식' },
  { date: '2026-01-04', tradeType: 'buy', acct: '계좌1', name: '테스트', qty: 2, price: 1201, assetType: '주식' },
);
context.syncHoldingsFromTrades({ clearWhenEmpty: true });
if (context.rawHoldings.length !== 1
    || context.rawHoldings[0].qty !== 5
    || context.rawHoldings[0].cost !== 1200
    || context.rawHoldings[0].costAmt !== 6002) {
  console.error('❌ 거래 저장 후 보유수량·평균단가·실제 매입금액 계산이 실패했습니다.');
  process.exit(1);
}

context.rawTrades.length = 0;
context.rawTrades.push(
  { date: '2026-02-01', tradeType: 'buy', acct: '계좌1', name: '분할종목', qty: 10, price: 100, assetType: '주식' },
  { date: '2026-02-02', tradeType: 'split', acct: '계좌1', name: '분할종목', qty: 10, price: 0, ratio: 2, fractionalCash: 0, assetType: '주식' },
  { date: '2026-02-03', tradeType: 'sell', acct: '계좌1', name: '분할종목', qty: 5, price: 60, assetType: '주식' },
);
context.syncHoldingsFromTrades({ clearWhenEmpty: true });
if (context.rawHoldings.length !== 1
    || context.rawHoldings[0].qty !== 15
    || context.rawHoldings[0].costAmt !== 750
    || Math.round(context.calcRealizedPnl().totalPnl) !== 50) {
  console.error('❌ SPLIT의 수량·주당원가·총취득원가 및 이후 매도 손익 반영이 실패했습니다.');
  process.exit(1);
}

context.rawTrades.length = 0;
context.rawTrades.push(
  { date: '2026-03-01', tradeType: 'buy', acct: '계좌1', name: '병합종목', qty: 10, price: 100, assetType: 'ETF' },
  { date: '2026-03-02', tradeType: 'reverse_split', acct: '계좌1', name: '병합종목', qty: 10, price: 0, ratio: 4, fractionalCash: 12.5, assetType: 'ETF' },
);
context.syncHoldingsFromTrades({ clearWhenEmpty: true });
if (context.rawHoldings.length !== 1
    || context.rawHoldings[0].qty !== 2.5
    || context.rawHoldings[0].costAmt !== 1000) {
  console.error('❌ REVERSE_SPLIT의 단주 보존·총취득원가 유지가 실패했습니다.');
  process.exit(1);
}

// Regression: a historical quantity/price edit can leave row/trade counts and
// lastUpdated unchanged. Re-render must not reuse the old portfolio view cache.
const systemViewCode = fs.readFileSync('src/web/views/views_system.js','utf8');
const outerDataKey = systemViewCode.match(/function _getDataHash\(\) \{[\s\S]*?\n\}/)?.[0];
if(!outerDataKey)throw new Error('outer view hash unavailable');
const outerContext = { rawTrades:[],rawHoldings:[],EDITABLE_PRICES:[],DIVDATA:{},
  lastUpdated:'unchanged',acctFilter:'전체',typeFilter:'전체',
  _portfolioDataKey:()=>JSON.stringify(outerContext.model) };
outerContext.model={rowPrice:100,assetType:'주식'};
vm.runInNewContext(outerDataKey,outerContext,{filename:'views_system_hash.js'});
const beforeOuter=outerContext._getDataHash();
outerContext.model.rowPrice=150;
if(beforeOuter===outerContext._getDataHash())throw new Error('outer renderView cache ignores same-day price change');
const afterOuter=outerContext._getDataHash();
outerContext.model.assetType='ETF';
if(afterOuter===outerContext._getDataHash())throw new Error('outer renderView cache ignores asset-type change');

outerContext.DIVDATA={ payout:{ date:'2026-10-01',amount:3000 } };
const dividendBefore=outerContext._getDataHash();
outerContext.DIVDATA.payout.amount=7000;
if(dividendBefore===outerContext._getDataHash())
  throw new Error('outer renderView cache ignores changed dividend amount with unchanged number of entries');

const portfolioViewCode = fs.readFileSync('src/web/views/views_portfolio.js','utf8');
const keyFunction = portfolioViewCode.match(/function _portfolioDataKey\(\) \{[\s\S]*?\n\}/)?.[0];
if (!keyFunction) throw new Error('portfolio view cache key function unavailable');
const cacheContext = {
  rows:[{acct:'ISA',name:'ETF A',code:'123456',type:'ETF',sector:'기타',
    qty:5,price:120,cost:100,costAmt:500,evalAmt:600,pnl:100,pct:20}],
  EDITABLE_PRICES:[{name:'ETF A',code:'123456',assetType:'ETF'}],
  rawTrades:[{qty:5}],rawHoldings:[{qty:5}],lastUpdated:'same-update',
  taxSettings:{ ISA:'ISA' },
  getAcctTaxType: acct => cacheContext.taxSettings[acct] || '일반',
};
vm.runInNewContext(keyFunction,cacheContext,{filename:'views_portfolio_cache_key.js'});
const beforeKey=cacheContext._portfolioDataKey();
assertCacheChange('quantity', () => {cacheContext.rows[0].qty=7;});
assertCacheChange('evaluation', () => {cacheContext.rows[0].evalAmt=840;});
assertCacheChange('cost', () => {cacheContext.rows[0].costAmt=700;});
assertCacheChange('P/L', () => {cacheContext.rows[0].pnl=140;});
assertCacheChange('type', () => {cacheContext.EDITABLE_PRICES[0].assetType='주식';});
assertCacheChange('account tax settings', () => {cacheContext.taxSettings.ISA='일반';});
assertCacheChange('row tax type', () => {cacheContext.rows[0].taxType='ISA';});
function assertCacheChange(reason,mutate) {
  const oldKey=cacheContext._portfolioDataKey();
  mutate();
  if (cacheContext._portfolioDataKey()===oldKey)
    throw new Error('portfolio cache retained stale '+reason+' despite changed input');
}
if(beforeKey===cacheContext._portfolioDataKey())
  throw new Error('portfolio view cache remained stale across multiple edits');
if(cacheContext._portfolioDataKey()!==cacheContext._portfolioDataKey())
  throw new Error('portfolio view cache key is not deterministic');

// Account view and donut must show the same slice after type and account
// filters change, even when EDITABLE_PRICES lacks an ETF/fund entry.
const fakeCanvasContext={clearRect(){},beginPath(){},moveTo(){},arc(){},closePath(){},fill(){}};
const fakeCanvas={getContext:()=>fakeCanvasContext};
const donutLabels={};
const viewContext={
  window:{__pfPerfMode:false},
  currentView:'acct',
  acctFilter:'전체',
  rows:[
    {acct:'ISA',name:'KODEX 은행',type:'ETF',sector:'금융',qty:5,costAmt:1000,evalAmt:1500,pnl:500},
    {acct:'IRP',name:'한화 TDF',type:'TDF',fund:true,qty:1,costAmt:450,evalAmt:500,pnl:50},
    {acct:'ISA',name:'삼성전자',type:'주식',sector:'반도체',qty:2,costAmt:1500,evalAmt:2000,pnl:500},
    {acct:'일반',name:'신규 인덱스 ETF',type:'ETF',sector:'반도체',qty:4,costAmt:800,evalAmt:1000,pnl:200},
  ],
  rawTrades:[],rawHoldings:[],lastUpdated:'unchanged',
  EDITABLE_PRICES:[{name:'삼성전자',assetType:'주식'},{name:'KODEX 반도체',assetType:'ETF'}],
  getEP:name=>viewContext.EDITABLE_PRICES.find(x=>x.name===name)||null,
  getEPType:(ep,fallback)=>(ep&&(ep.assetType||ep.type))||fallback||'주식',
  getAcctTaxType:()=> '일반',
  $el:id=>id==='donut-canvas'?fakeCanvas:(donutLabels[id]||(donutLabels[id]={})),
  resolveColor:x=>x,
  fmt:x=>String(x),
  SECTOR_COLORS:{},renderView(){},
};
vm.createContext(viewContext);
vm.runInContext(portfolioViewCode+'\nglobalThis.__donutModel=()=>_donutModelCache.model; globalThis.__setTypeFilter=setTypeFilter; globalThis.__setAcctFilter=setAcctFilter; globalThis.__portfolioAssetType=_portfolioAssetType;',viewContext);
if(viewContext.__portfolioAssetType({name:'신규 인덱스 ETF',type:'ETF',fund:false})!=='ETF')
  throw new Error('explicit ETF row type was lost when no price master classification or known ETF prefix exists');
if(viewContext.__portfolioAssetType(viewContext.rows[0])!=='ETF'
  || viewContext.__portfolioAssetType(viewContext.rows[1])!=='TDF')
  throw new Error('missing master ETF/TDF classification incorrectly defaults to stock');
viewContext.__setTypeFilter('전체');
if(viewContext.__donutModel().total!==5000)throw new Error('full account donut total mismatch');
if(Number(viewContext.__donutModel().entries?.find?.(entry=>entry[0]==='ETF')?.[1])!==2500)
  throw new Error('full donut must classify non-prefix explicit ETF as ETF');
viewContext.__setTypeFilter('ETF');
if(viewContext.__donutModel().total!==2500 || !viewContext.__donutModel().title.includes('ETF'))
  throw new Error('donut ignores selected ETF filter');
viewContext.__setAcctFilter('ISA');
if(viewContext.__donutModel().total!==1500)
  throw new Error('donut ignores combined account/type filters');
viewContext.__setTypeFilter('TDF');
if(viewContext.__donutModel().total!==0)
  throw new Error('donut ignores account/type zero-results');
viewContext.__setAcctFilter('전체');
if(viewContext.__donutModel().total!==500)
  throw new Error('donut ignores TDF classification from unregistered master item');
viewContext.__setTypeFilter('전체');
if(viewContext.__donutModel().total!==5000)
  throw new Error('donut fails to invalidate cache when type filter resets');


// #507 live reconciliation regression: server Snapshot uses exact trade cost,
// while the old web holdings-sync mistakenly recomputed rounded average * qty.
// Test the actual production sender with two accounts and legacy fallback.
{
  const syncSource=fs.readFileSync('src/web/features/settings/settings_sync.js','utf8');
  const syncFn=syncSource.match(/async function syncHoldingsToGsheet\(options\) \{[\s\S]*?\n\}/)?.[0];
  if (!syncFn) throw Error('missing actual holdings sync production function');
  let eligible=false;
  const writes=[];
  const fixtureHoldings=[
    {acct:'ISA',name:'ETF test',qty:3,cost:1200,costAmt:3601,assetType:'ETF'},
    {acct:'IRP',name:'ETF test',qty:2,cost:1200,costAmt:2401,assetType:'ETF'},
    {acct:'Legacy',name:'legacy share',qty:2,cost:999,assetType:'주식'},
    {acct:'Legacy',name:'invalid prior cost',qty:1,cost:500,costAmt:'invalid',assetType:'주식'}
  ];
  const ctx=vm.createContext({
    rawHoldings:fixtureHoldings,
    fundDirect:{},GSHEET_API_URL:'https://script.google.com/macros/s/fake/exec',
    getEP:name=>({code: name==='ETF test'?'441800':name==='legacy share'?'005930':'000660'}),
    getEPType:(ep,fallback)=>fallback,
    STOCK_CODE:{},_normalizeSyncCode:value=>String(value||''),
    isGsheetPortfolioWriteReady:()=>eligible,
    requestGsheetFormJson:async (action,body,options)=>{
      writes.push({action,body:JSON.parse(body.data),options});
      return {status:'ok',synced:JSON.parse(body.data).length};
    },
    _syncWarn:()=>{}
  });
  vm.runInContext(syncFn,ctx,{filename:'production-holdings-sync.js'});
  await ctx.syncHoldingsToGsheet();
  if (writes.length!==0)throw Error('holdings sync bypassed restore/write readiness gate');
  eligible=true;
  await ctx.syncHoldingsToGsheet();
  if (writes.length!==1||writes[0].action!=='syncHoldings')
    throw Error('unexpected GAS holdings write path');
  const rows=writes[0].body,etf=rows.find(x=>x.code==='441800');
  if (!etf||etf.qty!==5||etf.costAmt!==6002||etf.acct!=='ISA,IRP')
    throw Error('exact per-account trade acquisition cost was lost in GAS sync');
  const legacy=rows.find(x=>x.code==='005930');
  const invalid=rows.find(x=>x.code==='000660');
  if (!legacy||legacy.costAmt!==1998||!invalid||invalid.costAmt!==500)
    throw Error('legacy fallback for missing/invalid exact cost changed');
  // During authoritative restore, pinned master must also preserve exact cost.
  writes.length=0;
  await ctx.syncHoldingsToGsheet({
    targetUrl:'https://script.google.com/macros/s/fake/exec',
    allowDuringRestore:true,
    holdingsOverride:[{acct:'ISA',name:'ETF test',code:'441800',
      qty:5,cost:1200,costAmt:6002,assetType:'ETF'}],
    masterCodesOverride:[{name:'ETF test',code:'441800',type:'ETF'}],
    fundDirectOverride:{}
  });
  if (writes.length!==1||writes[0].body.length!==1
      ||writes[0].body[0].costAmt!==6002)
    throw Error('pinned restore recalculated exact trade cost');
  console.log('PASS #507 exact trade cost survives normal and pinned holdings sync; write gate unchanged');
}

console.log('✅ 거래 저장·전량 매도·마지막 거래 삭제의 보유현황 반영 검사 통과');
