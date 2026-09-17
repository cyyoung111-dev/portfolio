import assert from 'node:assert/strict';
import adapters from '../src/web/domain/market/market_briefing_adapters.js';
import master from '../src/web/domain/market/market_briefing_master.js';

const date = '2026-09-18';
const rows = [
  { listed:true, open:100, high:110, low:99, close:108, previousClose:100, volume:10, turnover:1080 },
  { listed:true, open:100, high:101, low:90, close:95, previousClose:100, volume:20, turnover:1900 },
  { listed:true, open:100, high:100, low:100, close:100, previousClose:100, volume:3, turnover:300 },
  { listed:true, open:0, high:0, low:0, close:100, previousClose:100, volume:0, turnover:0 },
  { listed:true, missing:true },
  { listed:false },
];
const breadth = adapters.aggregateBreadth(rows, 10);
assert.deepEqual({ universe:breadth.universe, advance:breadth.advance, decline:breadth.decline, unchanged:breadth.unchanged, nonTrading:breadth.nonTrading, missing:breadth.missing }, { universe:5, advance:1, decline:1, unchanged:1, nonTrading:1, missing:1 });
assert.equal(breadth.adDiff, 0);
assert.equal(breadth.adLine, 10);
assert.equal(breadth.coverage, 0.8);
assert.equal(breadth.participation, 0.6);

const meta = { tradingDate:date, observedAt:`${date}T15:30:00+09:00`, receivedAt:`${date}T15:30:05+09:00` };
let market = [];
for (const observation of adapters.breadthObservations(breadth, meta)) market = master.upsertObservation(market, observation);
market = master.upsertObservation(market, adapters.flowObservation('FOREIGN', -1000, meta));
market = master.upsertObservation(market, adapters.nightFutureObservation(550, { tradingDate:date, observedAt:`${date}T20:14:58+09:00`, receivedAt:`${date}T20:15:00+09:00`, status:'LIVE' }));
market = master.upsertObservation(market, adapters.afterTurnoverObservation('KRX', 123456, { tradingDate:date, observedAt:`${date}T20:00:00+09:00`, receivedAt:`${date}T20:00:02+09:00`, status:'FINAL', quality:'TICK_EXACT' }));

assert.equal(master.selectAt(market, adapters.SERIES.BREADTH_COVERAGE, `${date}T20:15:00+09:00`).value, 0.8);
assert.equal(master.selectAt(market, adapters.SERIES.FOREIGN_NET, `${date}T20:15:00+09:00`).value, -1000);
assert.equal(master.selectAt(market, adapters.SERIES.K200_NIGHT, `${date}T20:15:00+09:00`).status, 'LIVE');
assert.equal(master.selectAt(market, adapters.SERIES.KRX_AFTER_TURNOVER, `${date}T20:15:00+09:00`).quality, 'TICK_EXACT');
assert.equal(adapters.skhyAdrGap(50, 1400, 700000), 0);
assert.throws(() => adapters.afterTurnoverObservation('UNIFIED', 1, meta));

console.log('시장 브리핑 Breadth·수급·야간·After 관측 어댑터 회귀검사 통과');
