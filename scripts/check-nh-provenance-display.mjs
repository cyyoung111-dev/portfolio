import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const settings=fs.readFileSync('src/web/features/settings/settings_sync.js','utf8');
const start=settings.indexOf('function _formatNhVerifiedCloseSample(');
const end=settings.indexOf('\nasync function diagnoseNhFromUI()',start);
assert.ok(start>0&&end>start);
const ctx={};vm.createContext(ctx);vm.runInContext(settings.slice(start,end),ctx);
const sample=ctx._formatNhVerifiedCloseSample;
const row={price:232000,marketDate:'2026-10-29',usedDate:'2026-10-29',source:'NH_REGULAR_CLOSE',priceType:'REGULAR_CLOSE',status:'CONFIRMED',currency:'KRW'};
assert.match(sample('005930',row),/232,000 KRW · 2026-10-29 · NH 정규장/);
for(const patch of [{source:'YAHOO_FINANCE'},{priceType:'INDICATIVE'},{status:'PARTIAL'},{marketDate:'2026-10-28'},{price:0},{currency:''},{usedDate:'2026-10-31'},{price:Infinity}]){
 assert.equal(sample('005930',{...row,...patch}),'005930 NH 확정종가 미확보');
}
assert.equal(sample('AAPL',null),'AAPL NH 확정종가 미확보');
assert.match(settings,/target\.textContent=lines\.join/);
const bench=fs.readFileSync('src/web/views/views_history_benchmark.js','utf8');
const chart=fs.readFileSync('src/web/views/views_history.js','utf8');
assert.match(bench,/SOURCE_NOT_TAGGED/);
assert.match(bench,/point\.source\|\|data\?\.seriesMeta/);
assert.match(chart,/sourceSet = \[\.\.\.new Set/);
assert.match(chart,/latestRaw\?\.value/);
assert.match(chart,/_escapeHtml\(line\.sourceLabel\)/);
assert.match(chart,/실제 조회값/);
console.log('NH diagnostic numeric and benchmark origin PASS');
