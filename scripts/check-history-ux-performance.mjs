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
assert.match(fetch,/section class="price-lookup-summary" aria-label="조회 상세"/);
assert.doesNotMatch(fetch,/details class="price-status-diagnostics"/);
assert.match(fetch,/function _priceLookupDuration\(ms\)/);

const lookupFns=fetch.slice(fetch.indexOf('function _priceLookupDuration('),fetch.indexOf('function _priceLookupDetail('));
const layoutFn=fetch.slice(fetch.indexOf('function _priceStatusLayout('),fetch.indexOf('function _pricePortfolioSummary('));
assert.ok(lookupFns.startsWith('function _priceLookupDuration('));
assert.match(layoutFn,/lookupHtml = ''/,'lookup UI must be separate from the holdings status');
const lookupCtx=vm.createContext({window:{_lastPriceLookup:{
 clientRoundTripMs:69933,serverElapsedMs:14456,tossResultCount:37,
 krxResultCount:0,recentHistoryFallbackCount:0,tossStatus:'SUCCESS',cacheHit:false
}},Number,NaN});
vm.runInContext(lookupFns+layoutFn,lookupCtx);
const card=vm.runInContext('_priceLookupSummary()',lookupCtx);
assert.match(card,/class="price-lookup-summary" aria-label="조회 상세"/);
assert.match(card,/조회 상세/);
assert.match(card,/왕복 <strong>69\.9초<\/strong>/);
assert.match(card,/GAS 14\.5초/);
assert.match(card,/NH 37건/);
assert.match(card,/KRX 0건/);
assert.match(card,/GOOGLEFINANCE 미사용/);
for(const action of ['providers','recent-history','timings'])
 assert.match(card,new RegExp('data-price-detail="'+action+'"'));
assert.doesNotMatch(card,/<details|<summary|69933ms|14456ms/);
const layout=vm.runInContext(
 '_priceStatusLayout("완료 39/39개","<span>거래 338건 · 보유 61건</span>","",_priceLookupSummary())',
 lookupCtx);
assert.ok(layout.indexOf('거래 338건')>0 && layout.indexOf('거래 338건')<layout.indexOf('조회 상세'),
 'holdings status row must precede the independent provider details');
assert.match(layout,/class="price-status-meta"/);
assert.match(layout,/id="price-lookup-detail" class="price-lookup-detail" hidden/);
lookupCtx.window._lastPriceLookup={clientRoundTripMs:null,serverElapsedMs:undefined,
 tossResultCount:0,krxResultCount:0,tossStatus:'NOT_RUN',recentHistoryFallbackCount:0};
assert.match(vm.runInContext('_priceLookupSummary()',lookupCtx),/왕복 <strong>미확인<\/strong>/);
assert.equal(vm.runInContext('_priceLookupDuration(-1)',lookupCtx),'미확인');
assert.equal(vm.runInContext('_priceLookupDuration(990)',lookupCtx),'1.0초');

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
// Responsive website UI: one clear legend, two headline KPIs, compact six-index cards.
assert.match(hist,/class="hist-chart-svg"/);
assert.match(hist,/aria-label="선택 기간 손익 및 비교지수 변화 추이"/);
assert.match(hist,/class="hist-legend-list"/);
assert.doesNotMatch(hist,/<!-- 범례 -->/,'duplicate inline SVG legend should be removed');
assert.equal((hist.match(/class="hist-kpi-card"/g)||[]).length,2);
assert.match(hist,/class="hist-benchmark-card"/);
assert.match(hist,/class="hist-benchmark-source"/);
assert.match(hist,/class="hist-benchmark-source-body"/);
assert.match(hist,/line\.latestPrice\.toLocaleString/);
assert.match(hist,/line\.latestDate/);
assert.match(hist,/line\.sourceLabel/);
assert.match(hist,/line\.mdd\.pct\.toFixed\(1\)/);
assert.match(css,/\.hist-legend-list\{display:flex/);
assert.match(css,/\.hist-kpi-grid\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
assert.match(css,/\.hist-benchmark-card-grid\{display:grid;grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
assert.match(css,/@media\(max-width:720px\)\{[\s\S]*?\.hist-benchmark-card-grid\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
assert.match(css,/\.hist-benchmark-source>summary\{cursor:pointer/);

console.log('HISTORY_UX_PERFORMANCE_CONTRACT_OK: responsive chart and benchmark cards, compact MDD, preserved source data');
