import assert from 'node:assert/strict';
import fs from 'node:fs';
import {MORNING_SERIES} from './telegram-morning-report.mjs';
import {CLOSE_SOURCE_CATALOG,MORNING_NOT_CONNECTED,
  summarizeCloseCoverage,formatCloseCoverageSummary,
  closeQualityDecision} from './briefing-source-coverage.mjs';
import {formatClose,prepareClose} from './telegram-close-workflow.mjs';

const date='2026-10-30',prev='2026-10-29',now=()=>new Date(date+'T17:00:00+09:00');
const nh=[
 {label:'S&P 500',symbol:'^GSPC',date:prev,value:7720.39,changePercent:0.5,source:'NH_INDEX_DAILY'},
 {label:'NASDAQ',symbol:'^IXIC',date:prev,value:26184.72,changePercent:1.2,source:'NH_INDEX_DAILY'},
 {label:'NASDAQ100',symbol:'^NDX',date:prev,value:29402.51,changePercent:1.1,source:'NH_INDEX_DAILY'}
];
const domestic=[
 {type:'KOSPI',label:'KOSPI',date,source:'FDR_KRX_CACHE',role:'NON_NH_DAILY_INDEX',
 priceType:'PUBLISHED_EOD_REFERENCE',value:5668.26,changePercent:-4.54},
 {type:'KOSDAQ',label:'KOSDAQ',date,source:'KRX_OFFICIAL',role:'NON_NH_DAILY_INDEX',
 priceType:'CONFIRMED_REGULAR_CLOSE',value:723.15,changePercent:-3.99},
 {type:'KOSPI200',label:'KOSPI 200',date,source:'KRX_OFFICIAL',role:'NON_NH_DAILY_INDEX',
 priceType:'CONFIRMED_REGULAR_CLOSE',value:890.07,changePercent:-4.89}
];
const refs=[
 {label:'다우존스',source:'FRED_DJIA',role:'NON_NH_REFERENCE_ONLY',date:prev,value:51500},
 {label:'SOX',source:'FRED_NASDAQSOX',role:'NON_NH_REFERENCE_ONLY',date:prev,value:11518.20},
 {label:'VIX',source:'CBOE_VIX_DAILY',role:'NON_NH_REFERENCE_ONLY',date:prev,value:18.25}
];
const summary=summarizeCloseCoverage(date,{nh,domestic,secondary:refs,expectedUsDate:prev});
assert.deepEqual(summary.core,{verified:6,total:6,domestic:3,us:3});
assert.deepEqual(summary.reference,{verified:3,total:3});
assert.equal(summary.groupErrors.length,0);
assert.equal(closeQualityDecision(summary).fullCoreCoverage,true);
assert.equal(summary.statuses.filter(x=>x.status==='NOT_CONNECTED').length,
 CLOSE_SOURCE_CATALOG.notConnected.length);
assert.equal(new Set(summary.statuses.map(x=>x.id)).size,summary.statuses.length);
assert.equal(summary.statuses.some(x=>x.id==='VKOSPI'&&x.status==='NO_VERIFIED_ROW'),true);
assert.deepEqual(summary.volatility,{verified:0,total:1});
for(const id of ['SAMSUNG','SKHYNIX','NVDA','MU','USDKRW','DXY','UST10Y'])
 assert.equal(summary.statuses.find(x=>x.id===id)?.status,'NO_VERIFIED_ROW',id);
for(const id of ['WTI','BRENT','GOLD','COPPER','BTC'])
 assert.equal(summary.statuses.find(x=>x.id===id)?.status,'NO_VERIFIED_ROW',id);
assert.deepEqual(summary.markets,{verified:0,total:5});
assert.deepEqual(summary.stocks,{verified:0,total:4});
assert.deepEqual(summary.macros,{verified:0,total:3});
const qc=formatCloseCoverageSummary(summary);
assert.match(qc,/핵심지수 6\/6 \(국내 3\/3 · 미국 3\/3\) · 참고 3\/3/);
assert.match(qc,/미연결 참고지표: \d+개/);
assert.match(qc,/미확보: 삼성전자/);
assert.doesNotMatch(qc,/NO_VERIFIED_ROW|NOT_CONNECTED|FETCH_FAILED/,'internal reason codes must not clutter Telegram');
assert.ok(!qc.includes('7720.39'),'operational log emits only status not provider numbers');
assert.ok(formatClose(date,nh,refs,domestic).includes(qc));

const missing=summarizeCloseCoverage(date,{
 nh:nh.slice(0,1),domestic:domestic.slice(0,1),
 secondary:[{...refs[0],date:'2026-10-28'},refs[1]],
 expectedUsDate:prev,failedGroups:['NH','SECONDARY']
});
assert.deepEqual(missing.core,{verified:2,total:6,domestic:1,us:1});
assert.equal(missing.statuses.find(x=>x.id==='KOSDAQ').status,'NO_VERIFIED_ROW');
assert.equal(missing.statuses.find(x=>x.id==='NASDAQ').status,'FETCH_FAILED');
assert.equal(missing.statuses.find(x=>x.id==='DOW').status,'FETCH_FAILED');
assert.equal(missing.statuses.find(x=>x.id==='SOX').status,'VERIFIED');
assert.equal(closeQualityDecision(missing).fullCoreCoverage,false);
assert.equal(closeQualityDecision(missing).currentDeliveryGateSatisfied,true,
 'coverage instrumentation must not silently alter production delivery policy');
const empty=summarizeCloseCoverage(date,{expectedUsDate:prev});
assert.equal(empty.core.verified,0);
assert.equal(closeQualityDecision(empty).currentDeliveryGateSatisfied,false);
for(const bad of [
 {failedGroups:['PRIVATE_AUTH_TOKEN']},{nh:{},failedGroups:[]},
 {expectedUsDate:'10/29/2026'},{secondary:null}
 ])assert.throws(()=>summarizeCloseCoverage(date,bad),/COVERAGE_INPUT_INVALID/);

const meta=JSON.stringify(summary);
assert.ok(!meta.includes('7720.39')&&!meta.includes('PRIVATE_AUTH_TOKEN'));
assert.equal(MORNING_SERIES.length,21,'morning inventory remains the existing 21 dated series');
for(const id of MORNING_NOT_CONNECTED)assert.ok(!MORNING_SERIES.some(x=>x.id===id),
 'never call a hard-coded placeholder a verified morning source: '+id);
const report=fs.readFileSync('scripts/telegram-morning-report.mjs','utf8');
assert.match(report,/미국 선물 ES\/NQ\/YM\/RTY: 장전 실시간 검증값 미확보/);
assert.match(report,/고객예탁금, 신용잔고: 미확보/);

const opts={now,githubToken:'SYNTHETIC_READ_TOKEN',repository:'cyyoung111-dev/portfolio',
  fetchImpl:async url=>{
    assert.match(String(url),/api.github.com/);
    return {ok:true,json:async()=>({total_count:0,artifacts:[]})};
  },fetchNh:async()=>nh.slice(0,1),
  fetchDomestic:async()=>domestic.slice(0,1),fetchSecondary:async()=>{throw Error('PRIVATE_PROVIDER_ERROR');}
};
const partial=await prepareClose(opts);
assert.equal(partial.ready,true);
assert.equal(partial.coverage.core.verified,2);
assert.equal(partial.coverage.reference.verified,0);
assert.deepEqual(partial.coverage.groupErrors,['SECONDARY']);
assert.equal(partial.coverage.statuses.find(x=>x.id==='DOW').status,'FETCH_FAILED');
assert.ok(partial.message.includes('핵심지수 2/6'));
assert.ok(!JSON.stringify(partial).includes('PRIVATE_PROVIDER_ERROR'));
const none=await prepareClose({...opts,fetchNh:async()=>[],fetchDomestic:async()=>[]});
assert.equal(none.ready,false);
assert.equal(none.status,'NO_VERIFIED_INDEX_CLOSE');
assert.equal(none.coverage.core.verified,0);
assert.ok(Array.isArray(none.coverage.statuses),'missing all sources must still have diagnostics');
assert.ok(!('message' in none),'zero verified sources must never create sendable message');

console.log('BRIEFING_SOURCE_COVERAGE_PASS core=6 optional=3 unconnected='
 +CLOSE_SOURCE_CATALOG.notConnected.length+' morningSeries=21 reasonEnums=VERIFIED/FETCH_FAILED/NO_VERIFIED_ROW/NOT_CONNECTED');
