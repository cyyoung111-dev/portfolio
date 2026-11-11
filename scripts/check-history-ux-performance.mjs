import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const hist=fs.readFileSync('src/web/views/views_history.js','utf8');
const render=fs.readFileSync('src/web/views/views_history_render.js','utf8');
const pipeline=fs.readFileSync('src/web/views/views_history_pipeline.js','utf8');
const fetch=fs.readFileSync('src/web/features/settings/settings_fetch.js','utf8');
const css=fs.readFileSync('src/web/styles/pages/history.css','utf8');
const mddSource=hist.slice(hist.indexOf('function _calcHistoryMdd('),hist.indexOf('const HISTORY_BENCHMARK_VISUALS'));
assert.ok(mddSource.includes('function _calcHistoryMdd'));
const ctx=vm.createContext({});
vm.runInContext(mddSource,ctx);
const series=[
 {date:'2026-01-01',returnIndex:100},
 {date:'2026-02-01',returnIndex:150},
 {date:'2026-03-01',returnIndex:110},
 {date:'2026-04-01',returnIndex:143},
 {date:'2026-05-01',returnIndex:75},
 {date:'2026-06-01',returnIndex:101}
];
const result=ctx._calcHistoryMdd(series,'returnIndex');
assert.equal(result.peakDate,'2026-02-01');
assert.equal(result.troughDate,'2026-05-01');
assert.equal(result.pct,-50);
const flat=ctx._calcHistoryMdd([{date:'2026-01-01',returnIndex:100},{date:'2026-01-02',returnIndex:110}],'returnIndex');
assert.equal(flat.troughDate,'');
assert.equal(flat.pct,0);
assert.match(hist,/portfolioMddTroughSnapshot/);
assert.match(hist,/hist-mdd-key-card/);
assert.match(hist,/최대 낙폭 · MDD/);
assert.match(hist,/hist-mdd-more/);
assert.match(hist,/hist-extreme-details/);
assert.match(hist,/기간 최고·최저 평가금액/);
assert.equal((hist.match(/class="hist-mdd-key-card"/g)||[]).length,1,'MDD shown only in primary compact card');
assert.doesNotMatch(hist,/hist-extreme-mdd|worstDrawdown/,'duplicate MDD card and recalculation removed');
assert.match(hist,/hist-benchmark-details/);
assert.match(render,/hist-filter-details/);
assert.match(render,/hist-detail-panel/);
assert.match(pipeline,/details class="hist-source-coverage"/);
assert.match(css,/hist-kpi-grid/);
assert.match(fetch,/details class="price-status-diagnostics"/);
const fullUpdate=fetch.slice(fetch.indexOf('async function quickFetchByDate()'),fetch.indexOf('function getDateStr(daysAgo)'));
assert.ok(fullUpdate.includes('Delay the expensive full view repaint'));
assert.ok(fullUpdate.includes('let results = await fetchFromGsheet(targetDate, { forceFresh: true, persist: true })'));
assert.match(fullUpdate,/if \(results && Object\.keys\(results\)\.length > 0\)[\s\S]*?refreshAll\(\)/);
assert.match(fullUpdate,/가격 조회 결과 없음[\s\S]*?refreshAll\(\)/);
// The empty-data early return intentionally refreshes the view; the normal
// post-restore path must not repaint before the price network request.
const successPath=fullUpdate.slice(
  fullUpdate.indexOf("setStatusLabel('⏳ ' + targetDate + ' 종가 조회 중...' + (settingsLoaded"),
  fullUpdate.indexOf('let results = await fetchFromGsheet')
);
assert.ok(successPath.includes('GAS 데이터 확인 완료'));
assert.doesNotMatch(successPath,/refreshAll\(\)/);
assert.match(css,/\.hist-extreme-grid\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
assert.match(css,/@media\(max-width:720px\)[\s\S]*?\.hist-extreme-grid\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
assert.doesNotMatch(css,/hist-extreme-mdd/);
console.log('HISTORY_UX_PERFORMANCE_CONTRACT_OK: one compact MDD, two mini extrema cards, expandable details, one render');
