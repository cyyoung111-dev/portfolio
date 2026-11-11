import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const pipeline=fs.readFileSync('src/web/views/views_history_pipeline.js','utf8');
const state=fs.readFileSync('src/web/views/views_history_state.js','utf8');
const render=fs.readFileSync('src/web/views/views_history_render.js','utf8');
const functionSource=(text,name)=>{
 const matched=text.match(new RegExp('function '+name+'\\([^]*?\\n\\}'));
 assert.ok(matched,'missing production function: '+name);
 return matched[0];
};
const events={};
const fields={
 histStartMonth:{value:''},
 histRangeSelect:{value:'365'},
 histStatusMsg:{innerHTML:''},
 histCoveragePanel:{innerHTML:''},
 histChartWrap:{innerHTML:''},
 histTableWrap:{innerHTML:''},
 histBenchmarkCount:{textContent:''},
};
const ctx={
 Date,console,
 _kstTodayStr:()=> '2026-11-07',
 _kstDateOffset:(day,offset)=>new Date(Date.parse(day+'T00:00:00Z')
   +offset*86400000).toISOString().slice(0,10),
 $el:id=>fields[id]||null,
 __histState:{lastSuccessfulView:null,loadRequestId:0,benchmarks:['KOSPI']},
 _getHistBenchmarks:()=>ctx.__histState.benchmarks.slice(),
 _setHistBenchmarks:next=>{ctx.__histState.benchmarks=next.slice();},
 _renderHistBenchmarkButtons:()=>{},
 _setHistoryStatus:()=>{},
};
vm.createContext(ctx);
vm.runInContext([
 functionSource(pipeline,'_historyQueryStartDate'),
 functionSource(state,'_onHistoryRangeChange'),
 functionSource(state,'_onHistoryStartMonthChange'),
 functionSource(state,'_restoreSuccessfulHistoryView'),
 'globalThis.query = _historyQueryStartDate;',
 'globalThis.rangeChanged = _onHistoryRangeChange;',
 'globalThis.monthChanged = _onHistoryStartMonthChange;',
 'globalThis.restore = _restoreSuccessfulHistoryView;',
 'function _invalidateHistoryLoad(){__histState.loadRequestId++;}'
].join('\n'),ctx);
const query=(month,range,today='2026-11-07')=>ctx.query(month,range,today);
assert.equal(query('','365'),'2025-11-07','1-year default must mean rolling year');
assert.equal(query('2026-01','365'),'2025-11-07',
 'hidden stale January must never override a chosen 1-year preset');
assert.equal(query('2026-01','90'),'2026-08-09','3-month preset must beat manual month');
assert.equal(query('2026-01','180'),'2026-05-11','6-month preset must beat manual month');
assert.equal(query('2026-01','730'),'2024-11-07','2-year preset must beat manual month');
assert.equal(query('','0'),'','all-history must omit from');
assert.equal(query('2019-06','custom'),'2019-06-01','manual month must be explicit');
assert.equal(query('2020-02','custom'),'2020-02-01');
assert.throws(()=>query('','custom'),/시작 연월/);
assert.throws(()=>query('2026-00','custom'),/시작 연월/);
assert.throws(()=>query('2026-13','custom'),/시작 연월/);
assert.throws(()=>query('','invalid'),/조회 기간/);
assert.throws(()=>query('','365','2026-11-31'),/기준일/);
assert.match(pipeline, /const fromStr = _historyQueryStartDate\(/,
 'real getHistorySource request must use the same verified helper');
assert.match(pipeline, /_historyRequestJson\('getHistorySource', \{ from: fromStr \}/);

fields.histStartMonth.value='2026-01';
fields.histRangeSelect.value='90';
ctx.rangeChanged();
assert.equal(fields.histStartMonth.value,'','choosing a preset must erase old manual month');
assert.equal(ctx.query(fields.histStartMonth.value,fields.histRangeSelect.value,'2026-11-07'),
 '2026-08-09');
fields.histStartMonth.value='2023-08';
ctx.monthChanged();
assert.equal(fields.histRangeSelect.value,'custom');
assert.equal(ctx.query(fields.histStartMonth.value,fields.histRangeSelect.value,'2026-11-07'),
 '2023-08-01');
fields.histStartMonth.value='';
ctx.monthChanged();
assert.equal(fields.histRangeSelect.value,'365','clearing month reverts to 1-year preset');
fields.histRangeSelect.value='custom';
ctx.rangeChanged();
assert.equal(fields.histStartMonth.value,'2026-01',
 'explicit custom option may choose KST January but default mode may not');
assert.equal(ctx.query(fields.histStartMonth.value,fields.histRangeSelect.value,'2026-11-07'),
 '2026-01-01');
fields.histRangeSelect.value='0';
ctx.rangeChanged();
assert.equal(fields.histStartMonth.value,'');
assert.equal(ctx.query(fields.histStartMonth.value,fields.histRangeSelect.value,'2026-11-07'),'');

ctx.__histState.lastSuccessfulView={
 chartHtml:'EXISTING_CHART',statusHtml:'STATUS',
 coverageHtml:'COVERAGE',tableHtml:'TABLE',
 startMonth:'2025-01',range:'365',benchmarks:['KOSPI','KOSDAQ','SP500','DOW','NASDAQ','NASDAQ100']
};
assert.equal(ctx.restore(),true);
assert.equal(ctx.__histState.benchmarks.length,6,'restored chart and selected benchmark count must match');
assert.equal(fields.histStartMonth.value,'2025-01');
assert.equal(fields.histRangeSelect.value,'custom',
 'legacy January-YTD graph restores with correct custom label');
ctx.__histState.lastSuccessfulView={...ctx.__histState.lastSuccessfulView,
 startMonth:'',range:'180'};
assert.equal(ctx.restore(),true);
assert.equal(fields.histStartMonth.value,'');
assert.equal(fields.histRangeSelect.value,'180');

ctx.__histState.lastSuccessfulView={...ctx.__histState.lastSuccessfulView,benchmarks:undefined};
assert.equal(ctx.restore(),false,'legacy chart without benchmark metadata must not show misleading selected count');
assert.match(render,/<option value="365" selected>1년<\/option>/);
assert.match(render,/<option value="custom">시작월 지정<\/option>/);
assert.match(render,/addEventListener\('change', _onHistoryRangeChange\)/);
assert.match(render,/addEventListener\('change', _onHistoryStartMonthChange\)/);
assert.doesNotMatch(render,/monthEl\.value = .*getUTCFullYear/,
 'default Year-Jan input must never silently override a preset');
assert.equal(ctx.__histState.loadRequestId,5,
 'changing time controls invalidates stale chart requests without any remote write');
console.log('HISTORY_PRESET_CUSTOM_RANGE_PASS 90/180/365/730/all/custom KST legacy restore no source mutations');
