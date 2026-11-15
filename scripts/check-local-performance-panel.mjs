import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync('src/web/features/settings/settings_perf_monitor.js','utf8');
const net=fs.readFileSync('src/web/features/settings/settings_net.js','utf8');
const fetch=fs.readFileSync('src/web/features/settings/settings_fetch.js','utf8');
const html=fs.readFileSync('src/web/index.html','utf8');
const sw=fs.readFileSync('src/web/sw.js','utf8');
assert.match(source,/id="perfLocalSummary"/);
assert.match(source,/id="perfLocalSummaryBody"/);
assert.match(source,/id="perfLocalCopy"/);
assert.match(source,/if \(id === 'perfLocalSummary'\) \{ pftelemetry_renderLocal\(\)/);
assert.match(source,/navigator\.clipboard\.writeText\(summary\)/);
assert.match(net,/samples\.length > 60/,'in-memory sample buffer remains bounded');
assert.match(fetch,/window\.__PF_FULL_UPDATE_RUNS/);
assert.match(fetch,/completed\.length > 12/,'per-click records bounded');
assert.match(fetch,/result: fullUpdateSucceeded \? 'ok' : 'error'/);
for(const key of ['restoreMs','pricesMs','renderMs'])
 assert.match(fetch,new RegExp('fullUpdateTiming\\.'+key),'stage not correlated: '+key);
for(const stage of ['load.full-update','load.full-restore','load.full-prices','load.full-render'])
 assert.match(fetch,new RegExp(stage.replaceAll('.','\\.'),'g'),'full-update stage missing: '+stage);
assert.match(html,/settings_perf_monitor\.js\?v=20261115-5/);
assert.match(sw,/settings_perf_monitor\.js\?v=20261115-5/);
assert.match(sw,/portfolio-cache-20261115-12/);
const start=source.indexOf('  const LOCAL_STAGE_LABELS');
const end=source.indexOf('  function pftelemetry_renderSettingsHtml()',start);
assert.ok(start>0&&end>start);

function el(tag){
 return {tag,children:[],textContent:'',style:{},
  appendChild(child){this.children.push(child);},
  replaceChildren(...newChildren){this.children=newChildren;this.textContent='';}};
}
const wrap=el('div'),privateId='PRIVATE_ACCOUNT_AND_TICKER';
const raw=[
 {stage:'load.full-restore',ms:3000,result:'ok'},
 {stage:'load.full-prices',ms:4800,result:'ok'},
 {stage:'load.full-render',ms:120,result:'ok'},
 {stage:'load.full-update',ms:8400,result:'ok'},
 {stage:'load.full-restore',ms:3200,result:'ok'},
 {stage:'load.full-prices',ms:5200,result:'ok'},
 {stage:'load.full-render',ms:140,result:'ok'},
 {stage:'load.full-update',ms:8540,result:'ok'},
 {stage:'load.full-restore',ms:3400,result:'ok'},
 {stage:'load.full-prices',ms:6100,result:'ok'},
 {stage:'load.full-render',ms:200,result:'ok'},
 {stage:'load.full-update',ms:9000,result:'ok'},
 {stage:'load.full-update',ms:90000,result:'error',account:privateId},
 {stage:'not-allowed',ms:99,result:'ok'},
 {stage:'load.full-render',ms:NaN,result:'ok'},
 {stage:'load.full-prices',ms:-2,result:'ok'},
 {stage:'load.full-update',ms:123456789,result:'ok'}
];
const ctx=vm.createContext({window:{__PF_LOOKUP_TIMES:raw},
 document:{getElementById:id=>id==='perfLocalSummaryBody'?wrap:null,
  createElement:el},
 pftelemetry_device:()=> 'mobile',
 Object,Map,Array,Number});
vm.runInContext(source.slice(start,end),ctx);
const stats=JSON.parse(JSON.stringify(vm.runInContext(
 'pftelemetry_localStats(window.__PF_LOOKUP_TIMES)',ctx)));
const full=stats.find(x=>x.stage==='load.full-update');
assert.deepEqual({successes:full.successes,failures:full.failures,medianMs:full.medianMs,
 p95Ms:full.p95Ms,latestResult:full.latestResult,latestMs:full.latestMs},
 {successes:3,failures:1,medianMs:8540,p95Ms:9000,
 latestResult:'error',latestMs:90000});
const prices=stats.find(x=>x.stage==='load.full-prices');
assert.equal(prices.medianMs,5200);
assert.equal(prices.p95Ms,6100);
assert.equal(stats.find(x=>x.stage==='load.full-restore').medianMs,3200);
assert.equal(stats.find(x=>x.stage==='load.full-render').medianMs,140);
assert(!JSON.stringify(stats).includes(privateId));
assert.equal(stats.find(x=>x.stage==='not-allowed'),undefined);
ctx.window.__PF_FULL_UPDATE_RUNS=[
 {result:'ok',totalMs:10000,restoreMs:3000,pricesMs:6800,renderMs:100},
 {result:'ok',totalMs:8000,restoreMs:2600,pricesMs:5200,renderMs:100},
 {result:'ok',totalMs:12000,restoreMs:3500,pricesMs:8100,renderMs:200},
 {result:'error',totalMs:90000,restoreMs:87000,pricesMs:null,renderMs:null}
];
const paired=JSON.parse(JSON.stringify(vm.runInContext(
 'pftelemetry_pairedSummary(window.__PF_FULL_UPDATE_RUNS)',ctx)));
assert.deepEqual({
 runs:paired.runs,successes:paired.successes,failures:paired.failures,
 median:paired.medianTotalMs,p95:paired.p95TotalMs,
 stage:paired.slowestStage,share:paired.slowestSharePct
},{runs:4,successes:3,failures:1,median:10000,p95:12000,
 stage:'가격 재조회',share:67});
assert.equal(paired.stages.find(x=>x.key==='prices').medianMs,6800);
assert.equal(paired.stages.find(x=>x.key==='restore').sharePct,30);
assert.equal(paired.stages.find(x=>x.key==='render').sharePct,1);
const insufficientPair=JSON.parse(JSON.stringify(vm.runInContext(
 "pftelemetry_pairedSummary([{result:'ok',totalMs:50,restoreMs:5,pricesMs:5,renderMs:5},{result:'error',totalMs:120,restoreMs:120,pricesMs:null,renderMs:null}])",ctx)));
assert.equal(insufficientPair.successes,1);
assert.equal(insufficientPair.failures,1);
assert.equal(insufficientPair.medianTotalMs,null);
assert.equal(insufficientPair.slowestStage,null);
const invalidPair=JSON.parse(JSON.stringify(vm.runInContext(
 "pftelemetry_pairedSummary([{result:'ok',totalMs:20,restoreMs:15,pricesMs:15,renderMs:2},{result:'ok',totalMs:0,restoreMs:null,pricesMs:null,renderMs:null}])",ctx)));
assert.equal(invalidPair.successes,0);
assert.equal(invalidPair.incompleteSuccesses,2);
for(const secret of ['AAPL','005930','PRIVATE_ACCOUNT_AND_TICKER','accessToken'])
 assert(!JSON.stringify(paired).includes(secret));
vm.runInContext('pftelemetry_renderLocal()',ctx);
assert.equal(wrap.children.length,2);
const [note,table]=wrap.children;
assert.equal(note.tag,'p');
assert.match(note.textContent,/병목 후보: 가격 재조회/);
assert.match(note.textContent,/동일 업데이트 정상 3회\/실패 1회/);
assert.match(note.textContent,/실제 동일 실행 합산 67%/);
assert.equal(table.tag,'table');
const lines=table.children.map(row=>row.children.map(cell=>cell.textContent).join('|'));
assert.ok(lines.some(x=>x.includes('전체 업데이트|90,000ms · 실패|8,540ms|9,000ms|3 / 1')));
assert.ok(lines.some(x=>x.includes('가격 재조회|6,100ms · 성공|5,200ms|6,100ms|3 / 0')));
assert.ok(lines.some(x=>x.includes('화면 재계산|200ms · 성공|140ms|200ms|3 / 0')));
const report=vm.runInContext(
 'pftelemetry_localReport(pftelemetry_localStats(window.__PF_LOOKUP_TIMES), pftelemetry_pairedSummary(window.__PF_FULL_UPDATE_RUNS))',ctx);
assert.match(report,/모바일/);
assert.match(report,/성공 표본/);
assert.match(report,/정상 3건, 실패 1건, 중앙값 8540ms, p95 9000ms/);
assert.match(report,/전체 중앙값 10000ms, p95 12000ms/);
assert.match(report,/동일 업데이트 가격 재조회: 중앙값 6800ms, 합산 비중 67%/);
assert(!report.includes(privateId));
for(const code of ['AAPL','005930','GSHEET_API_URL','accessToken'])
 assert(!report.includes(code));
const insufficient=JSON.parse(JSON.stringify(vm.runInContext(
 "pftelemetry_localStats([{stage:'load.full-update',ms:500,result:'ok'}, {stage:'load.full-update',ms:700,result:'ok'}, {stage:'load.full-update',ms:9999,result:'error'}])",ctx)));
assert.equal(insufficient[0].successes,2);
assert.equal(insufficient[0].failures,1);
assert.equal(insufficient[0].medianMs,null);
assert.equal(insufficient[0].p95Ms,null);
const dense=JSON.parse(JSON.stringify(vm.runInContext(
 "pftelemetry_localStats(Array.from({length:90},(_,i)=>({stage:'load.full-update',ms:i,result:'ok'})))",ctx)));
assert.equal(dense[0].successes,60);
assert.equal(dense[0].medianMs,59);
assert.equal(dense[0].p95Ms,86);
ctx.window.__PF_LOOKUP_TIMES=[];
ctx.window.__PF_FULL_UPDATE_RUNS=[];
vm.runInContext('pftelemetry_renderLocal()',ctx);
assert.match(wrap.textContent,/측정값이 없습니다/);
assert.equal(vm.runInContext(
 'pftelemetry_localReport(pftelemetry_localStats(window.__PF_LOOKUP_TIMES))',ctx),'');
assert.doesNotMatch(source,/localStorage\.setItem\(['"]pf_perf_local_samples/);
console.log('PASS local full-update median/p95 and no-write clipboard: success only, failures isolated, 3+ samples, capped 60, no private data');
