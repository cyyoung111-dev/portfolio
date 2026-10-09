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
const tradesViewContext = { console, Map, setTimeout, clearTimeout };
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
const portfolioViewCode = fs.readFileSync('src/web/views/views_portfolio.js','utf8');
const keyFunction = portfolioViewCode.match(/function _portfolioDataKey\(\) \{[\s\S]*?\n\}/)?.[0];
if (!keyFunction) throw new Error('portfolio view cache key function unavailable');
const cacheContext = {
  rows:[{acct:'ISA',name:'ETF A',code:'123456',type:'ETF',sector:'기타',
    qty:5,price:120,cost:100,costAmt:500,evalAmt:600,pnl:100,pct:20}],
  EDITABLE_PRICES:[{name:'ETF A',code:'123456',assetType:'ETF'}],
  rawTrades:[{qty:5}],rawHoldings:[{qty:5}],lastUpdated:'same-update',
};
vm.runInNewContext(keyFunction,cacheContext,{filename:'views_portfolio_cache_key.js'});
const beforeKey=cacheContext._portfolioDataKey();
assertCacheChange('quantity', () => {cacheContext.rows[0].qty=7;});
assertCacheChange('evaluation', () => {cacheContext.rows[0].evalAmt=840;});
assertCacheChange('cost', () => {cacheContext.rows[0].costAmt=700;});
assertCacheChange('P/L', () => {cacheContext.rows[0].pnl=140;});
assertCacheChange('type', () => {cacheContext.EDITABLE_PRICES[0].assetType='주식';});
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

console.log('✅ 거래 저장·전량 매도·마지막 거래 삭제의 보유현황 반영 검사 통과');
