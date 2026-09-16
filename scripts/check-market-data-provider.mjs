import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync('src/web/domain/market/market_data_provider.js', 'utf8');
const c = {}; vm.runInNewContext(`${source}; globalThis.api={normalizeMarketPrice,resolveMarketPrice,carryForwardRegularClose,applyStockSplit,applyReverseSplit};`, c);
const { api } = c;
const good = api.normalizeMarketPrice({ symbol:'005930', marketDate:'2026-09-15', closePrice:70000 }, {market:'KR',currency:'KRW',source:'TOSS'});
assert.equal(good.status, 'CONFIRMED'); assert.equal(good.priceType, 'REGULAR_CLOSE');
assert.equal(api.normalizeMarketPrice({ symbol:'005930', marketDate:'bad', closePrice:0 }).status, 'NEEDS_REVIEW');
assert.equal(api.resolveMarketPrice(null, {...good, source:'KRX'}).status, 'FALLBACK');
assert.equal(api.carryForwardRegularClose([{...good, marketDate:'2026-09-12'}], '2026-09-15').closePrice, 70000);
const split = api.applyStockSplit({qty:10,cost:100,costAmt:1000}, {ratio:2});
assert.equal(split.qty, 20); assert.equal(split.cost, 50); assert.equal(split.costAmt, 1000);
const reverse = api.applyReverseSplit({qty:20,cost:50,costAmt:1000}, {ratio:2});
assert.equal(reverse.qty, 10); assert.equal(reverse.cost, 100); assert.equal(reverse.costAmt, 1000);
console.log('market data provider checks passed');

