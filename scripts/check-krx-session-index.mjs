import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const gas=fs.readFileSync('src/gas/apps_script.gs','utf8');
const ui=fs.readFileSync('src/web/views/views_history_state.js','utf8');
const html=fs.readFileSync('src/web/index.html','utf8');
const sw=fs.readFileSync('src/web/sw.js','utf8');
function fn(source,name){
  const s=source.indexOf('function '+name+'('),e=source.indexOf('\n}',s);
  assert.ok(s>=0 && e>=0,name+' function unavailable');
  return source.slice(s,e+2);
}
const calendar=gas.match(/var KRX_CONFIRMED_CLOSED_DATES_2026 = \{[\s\S]*?\};[\s\S]*?var KRX_CONFIRMED_CLOSED_DATES_2027 = \{[\s\S]*?\};/);
const idx=gas.match(/var KRX_OFFICIAL_INDEX_CONFIG = \{[\s\S]*?\};/);
assert.ok(calendar && idx,'GAS official calendar + index maps missing');
let when='2026-10-12',primaryHttp=401,altHttp=200,altRows=true,requests=[];
const dateOffset=(s,n)=>new Date(Date.parse(s+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
function makeResponse(status,rows,url){
  const market=String(url).includes('kosdaq_dd_trd')?'코스닥':'코스피';
  const d=(String(url).match(/basDd=(\d{8})/)||[])[1]||'20261008';
  return {getResponseCode:()=>status,getContentText:()=>JSON.stringify({
    OutBlock_1:status===200 && rows ? [{BAS_DD:d,IDX_NM:market,CLSPRC_IDX:'3,500.25'}]:[],
  })};
}
const ctx={
  Date, Object,
  CONFIG:{TIMEZONE:'Asia/Seoul'},
  Utilities:{formatDate:()=>when},
  _normalizeDate:s=>String(s||'').slice(0,10),
  _normalizeYmd:s=>String(s||'').replaceAll('-',''),
  _fundDateOffset:dateOffset,today:()=>when,
  _getKrxAuthKeySlots_:()=>({key:'primary',alternative:'alternate'}),
  UrlFetchApp:{
    fetchAll:rs=>rs.map(r=>{requests.push({url:r.url,slot:r.headers.AUTH_KEY});return makeResponse(primaryHttp,true,r.url);}),
    fetch:(url,opt)=>{requests.push({url,slot:opt.headers.AUTH_KEY});return makeResponse(altHttp,altRows,url);},
  },
  CacheService:{getScriptCache:()=>({get:()=>null,put:()=>{}})},
  fetchYahooIndexSeries:t=>({points:[{date:'2026-10-07',value:3500,source:'YAHOO'}],symbol:t==='KOSPI'?'^KS11':'^KQ11'}),
  fetchMarketIndicatorCandlesToss:()=>{throw Error('TOSS_401');},
  fetchYahooIndexCurrent:()=>null,
  jsonOk:v=>({status:'ok',...v}),jsonError:e=>({status:'error',message:e}),
  _isKrxOfficialCloseAvailableTime_:()=>true,
};
vm.runInNewContext(calendar[0]+'\n'+idx[0]+'\n'+[
  '_krxCalendarStatus_','_benchmarkSymbolMap','fetchKrxOfficialIndexCloses','_fetchKrxOfficialIndexClosesSafe_',
  'handleGetBenchmarks'].map(n=>fn(gas,n)).join('\n'),ctx);
assert.equal(ctx._krxCalendarStatus_('2026-10-09'),'CLOSED');
assert.equal(ctx._krxCalendarStatus_('2026-10-08'),'OPEN');
assert.equal(ctx._krxCalendarStatus_('2028-10-09'),'UNKNOWN');
let r=ctx.handleGetBenchmarks('KOSPI','2026-10-07','2026-10-09',false);
assert.equal(r.status,'ok',JSON.stringify(r));
assert.equal(r.series.KOSPI.at(-1).date,'2026-10-08','confirmed holiday skip must resolve last OPEN session');
assert.equal(r.seriesMeta.KOSPI.confirmedClose,true);
assert.ok(requests.some(x=>x.slot==='alternate'&&x.url.includes('20261008')),'401 primary retried with alternate credential');
altRows=false;requests=[];
r=ctx.handleGetBenchmarks('KOSPI','2026-10-07','2026-10-09',true);
assert.ok(r.errors.KRX_OFFICIAL.includes('KOSPI:2026-10-08:EMPTY_TRADING_DATE'),
  'OPEN date HTTP200 empty must be provider failure');
assert.ok(!requests.some(x=>x.url.includes('20261007')),'no OPEN T-1 substitution after 10/08 empty');
assert.equal(r.seriesMeta.KOSPI.confirmedClose,false);
assert.ok(r.series.KOSPI.length,'Yahoo historical series remains visible with official provider warning');
altHttp=401;requests=[];
r=ctx.handleGetBenchmarks('KOSDAQ','2026-10-07','2026-10-09',true);
assert.ok(r.errors.KRX_OFFICIAL.includes('HTTP_401'),'both auth slots denied must be visible');
altHttp=200;altRows=true;when='2028-10-12';requests=[];
r=ctx.handleGetBenchmarks('KOSPI','2028-10-07','2028-10-09',true);
assert.ok(r.errors.KRX_OFFICIAL.includes('CALENDAR_UNKNOWN'),'unregistered calendar must not invent exchange holidays');
assert.equal(requests.length,0,'unregistered session should not query KRX as confirmed');

const gasDays=Object.fromEntries([...gas.matchAll(/var KRX_CONFIRMED_CLOSED_DATES_(\d{4}) = \{([\s\S]*?)\};/g)]
 .map(m=>[m[1],[...m[2].matchAll(/'(\d{4}-\d{2}-\d{2})':1/g)].map(x=>x[1])]));
const uiDays=Object.fromEntries([...ui.matchAll(/'(2026|2027)': new Set\((\[[^\]]*\])\)/g)]
 .map(m=>[m[1],JSON.parse(m[2])]));
assert.deepEqual(uiDays,gasDays,'UI and GAS calendar day sets must match exactly');
const display={
  Date,Set,window:{},
  _normalizeHistDate:s=>String(s||'').slice(0,10),
  _kstTodayStr:()=> '2026-10-12',_kstNow:()=>new Date('2026-10-12T07:12:00Z'),
  _escapeHtml:String,
};
const calUi=ui.match(/const HISTORY_KRX_CLOSED_DATES = \{[\s\S]*?\};/);
assert.ok(calUi);
vm.runInNewContext(fn(ui,'_historyDateToUtcMs')+'\n'+calUi[0]+'\n'+[
 '_historyKrxSessionStatus','_getHistorySnapshotGap','_historySnapshotGapHtml'].map(n=>fn(ui,n)).join('\n'),display);
assert.equal(display._getHistorySnapshotGap('2026-10-09').days,0,'weekend not missing');
assert.equal(display._getHistorySnapshotGap('2026-10-06').days,2,'10/07 and 10/08 are missing OPEN sessions');
assert.equal(display._getHistorySnapshotGap('2026-10-08').days,0,'holiday and weekend omitted, today before close');
assert.match(display._historySnapshotGapHtml(display._getHistorySnapshotGap('2026-10-06')),/거래일 2일/);
display._kstNow=()=>new Date('2026-10-12T19:30:00Z');
assert.equal(display._getHistorySnapshotGap('2026-10-09').days,1,'today after actual integrated close counts');
for(const name of ['views_history_state.js','views_history_benchmark.js','views_history_pipeline.js']){
  const version=name==='views_history_benchmark.js'?'20261030-1':'20261012-1';
  assert.match(html,new RegExp(name.replace('.','\\.')+'\\?v='+version));
  assert.match(sw,new RegExp(name.replace('.','\\.')+'\\?v='+version));
}
assert.match(gas,/function handleGetBenchmark[\s\S]*handleGetBenchmarks\(key, fromDate, toDate, true\)/);

// TextOutput from Apps Script cannot be treated as a JS object by the
// getBenchmark(single) handler. Exercise the real single-index handler.
const rawBatch=ctx.handleGetBenchmarks('KOSPI','2026-10-07','2026-10-09',true);
ctx.handleGetBenchmarks=()=>({getContent:()=>JSON.stringify(rawBatch)});
vm.runInNewContext(fn(gas,'handleGetBenchmark'),ctx);
const single=ctx.handleGetBenchmark('KOSPI','2026-10-07','2026-10-09');
assert.equal(single.status,'ok','single official index unwraps GAS TextOutput');
assert.equal(single.points.length,rawBatch.series.KOSPI.length);
const utils=fs.readFileSync('src/web/views/views_history_utils.js','utf8');
vm.runInNewContext(utils,display);
display._kstNow=()=>new Date('2026-10-12T07:12:00Z');
const detailed=display._analyzeHistoryCoverage(
 [{date:'2026-10-06'},{date:'2026-10-09'}],'day');
assert.deepEqual(Array.from(detailed.missing,x=>x.targetDate),
 ['2026-10-07','2026-10-08'],'day coverage must skip KRX holiday 10/09 and weekend');
const weekly=display._analyzeHistoryCoverage(
 [{date:'2026-09-28'},{date:'2026-10-12'}],'week');
assert.ok(weekly.missing.some(x=>x.targetDate==='2026-10-08'),
 'Friday 10/09 holiday must target last verified OPEN date 10/08');
assert.ok(!weekly.missing.some(x=>x.targetDate==='2026-10-09'),
 'holiday must not be a repair target');
assert.match(html,/views_history_utils\.js\?v=20261012-1/);
assert.match(sw,/views_history_utils\.js\?v=20261012-1/);

console.log('KRX official session, auth fallback, source failure, calendar UI checks passed');
