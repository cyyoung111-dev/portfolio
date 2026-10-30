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


// Execute production benchmark loader functions, with independent expected
// source/price/date rows. Source strings alone cannot prove correct rendering.
const loaderCtx={
  GSHEET_API_URL:'https://script.google.com/macros/s/TEST/exec',
  _normalizeHistDate:date=>String(date||'').slice(0,10),
  requestGsheetActionJson:async(action)=>{
    if(action==='getBenchmarks')return {
      status:'ok',
      series:{
        KOSPI:[
          {date:'2026-10-28',value:3400,source:'YAHOO_UNVERIFIED_DAILY'},
          {date:'2026-10-29',value:3420,source:'KRX_OFFICIAL'}
        ],
        SP500:[
          {date:'2026-10-28',value:5800},
          {date:'2026-10-29',value:5850}
        ]
      },
      symbols:{KOSPI:'^KS11',SP500:'^GSPC'},
      seriesMeta:{KOSPI:{source:'KRX_OFFICIAL',confirmedClose:true}}
    };
    if(action==='getBenchmark')return {
      status:'ok',symbol:'KRX_OPEN_API:VKOSPI',
      points:[{date:'2026-10-29',value:31.25,source:'KRX_OFFICIAL'}]
    };
    throw Error('UNEXPECTED_BENCHMARK_ACTION');
  }
};
vm.createContext(loaderCtx);
vm.runInContext(bench,loaderCtx);
const bundle=await loaderCtx._loadBenchmarkBundle(['KOSPI','SP500'],'2026-10-28','2026-10-30');
assert.equal(bundle.seriesMap.KOSPI[0].source,'YAHOO_UNVERIFIED_DAILY');
assert.equal(bundle.seriesMap.KOSPI[1].source,'KRX_OFFICIAL');
assert.equal(bundle.seriesMap.KOSPI[1].sourceDate,'2026-10-29');
assert.equal(bundle.seriesMap.KOSPI[1].value,3420);
assert.equal(bundle.seriesMap.SP500[1].source,'SOURCE_NOT_TAGGED');
const vk=await loaderCtx._fetchBenchmarkSeries('VKOSPI','2026-10-29','2026-10-30');
assert.equal(vk.points[0].source,'KRX_OFFICIAL');
assert.equal(vk.points[0].date,'2026-10-29');
assert.equal(vk.points[0].value,31.25);

// Run the actual production SVG chart renderer and assert the final visible
// source/date/value comes from the SAME latest dated source row, not the
// carried-forward snapshot date.
const chartStart=chart.indexOf('function _drawHistoryChart(');
const chartEnd=chart.indexOf('\nfunction _drawHistoryTable(',chartStart);
assert.ok(chartStart>=0&&chartEnd>chartStart);
const chartCtx={
  HISTORY_BENCHMARK_VISUALS:{KOSPI:{color:'#123456',dash:''},SP500:{color:'#654321',dash:''}},
  rawTrades:[],
  _normalizeHistDate:x=>x,
  _fmtHistDateShortMonth:x=>x,_fmtHistDateShortWeek:x=>x,_fmtHistDateCompact:x=>x,
  _escapeHtml:x=>String(x).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'),
  _fmtAxisKrw:x=>String(Math.round(x)),_fmtKrw:x=>String(Math.round(x)),pSign:x=>x>=0?'+':'',
  _isVerifiedHistoryPoint:()=>true,
  _calcHistoryMdd:()=>({pct:-4,peakDate:'2026-10-28',troughDate:'2026-10-29'}),
  _buildCashflowAdjustedReturnIndex:()=>[
    {date:'2026-10-28',returnIndex:100},
    {date:'2026-10-30',returnIndex:103}
  ]
};
vm.createContext(chartCtx);vm.runInContext(chart.slice(chartStart,chartEnd),chartCtx);
const snapshots=[
  {date:'2026-10-28',costAmt:1000000,evalAmt:1020000},
  {date:'2026-10-29',costAmt:1000000,evalAmt:1030000},
  {date:'2026-10-30',costAmt:1000000,evalAmt:1050000}
];
const wrap={clientWidth:700,innerHTML:''};
chartCtx._drawHistoryChart(wrap,snapshots,'day',{
  types:['KOSPI','SP500'],seriesMap:bundle.seriesMap,metaMap:bundle.metaMap,
  portfolioSnapshots:snapshots
});
assert.match(wrap.innerHTML,/Yahoo \+ KRX · 2026-10-29/,'mixed provider and actual source date must appear');
assert.match(wrap.innerHTML,/3,420 · 실제 조회값/,'latest KOSPI raw close, not next-date carry');
assert.match(wrap.innerHTML,/원천 미확인 · 2026-10-29/,'untagged index must not appear as NH');
assert.match(wrap.innerHTML,/5,850 · 실제 조회값/,'untagged index original price still visible');
console.log('PASS: production benchmark loader, single index and SVG output with mixed origins/date/values');
