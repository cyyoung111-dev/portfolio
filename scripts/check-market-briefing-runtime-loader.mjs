import assert from 'node:assert/strict';
import fs from 'node:fs';
const source=fs.readFileSync('src/web/app/bootstrap.js','utf8');
const expected=['market_briefing_master.js','market_briefing_provider_normalizer.js','market_briefing_snapshot_store.js','market_briefing_operational_gate.js','market_briefing_runtime_store.js','market_briefing_runtime.js'];
let previous=-1;
for(const file of expected){const pos=source.indexOf(file);assert.ok(pos>previous,`${file} 로드 순서`);previous=pos;}
assert.match(source,/loadMarketBriefingRuntime\(\)\.catch/);
assert.match(source,/window\.PortfolioApp\.marketBriefing = window\.MarketBriefingRuntime/);
assert.doesNotMatch(source,/market_briefing_qc\.js/);
assert.doesNotMatch(source,/market_briefing_adapters\.js/);
console.log('브리핑 브라우저 런타임 로더 회귀검사 통과');
