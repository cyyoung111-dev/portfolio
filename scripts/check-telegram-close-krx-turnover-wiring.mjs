import assert from 'node:assert/strict';
import {CLOSE_SOURCE_CATALOG,summarizeCloseCoverage,formatCloseCoverageSummary}
 from './briefing-source-coverage.mjs';
import {formatClose,prepareClose,deliverClose} from './telegram-close-workflow.mjs';
import {verifyOfficialKrxTurnover} from './closing-krx-turnover.mjs';

const day='2026-11-06',us='2026-11-05';
const now=()=>new Date('2026-11-06T17:05:00+09:00');
const mk=(market,valueKrw)=>({
 id:'KRX_TURNOVER_'+market,market,date:day,valueKrw,
 source:'KRX_OFFICIAL_INDEX_DAILY',role:'NON_NH_REFERENCE_ONLY'
});
const kospi=mk('KOSPI',20250000000000),kosdaq=mk('KOSDAQ',6300000000000);
const nh=[{label:'S&P 500',symbol:'^GSPC',date:us,source:'NH_INDEX_DAILY',value:7000,changePercent:1}];
assert.equal(CLOSE_SOURCE_CATALOG.notConnected.includes('KRX_TURNOVER'),false);
assert.deepEqual(CLOSE_SOURCE_CATALOG.turnover.map(x=>x.id),
 ['KRX_TURNOVER_KOSPI','KRX_TURNOVER_KOSDAQ']);
const full=summarizeCloseCoverage(day,{nh,turnover:[kospi,kosdaq],expectedUsDate:us});
assert.deepEqual(full.turnover,{verified:2,total:2});
assert.deepEqual(full.statuses.filter(x=>x.id.startsWith('KRX_TURNOVER_'))
 .map(x=>x.status),['VERIFIED','VERIFIED']);
assert.match(formatCloseCoverageSummary(full),/KRX 거래대금 2\/2/);
const msg=formatClose(day,nh,[],[],[],[],[],[],now(),[],[],null,null,[kospi,kosdaq]);
assert.match(msg,/KOSPI 거래대금: 20\.25조원 \[2026-11-06 · KRX\]/);
assert.match(msg,/KOSDAQ 거래대금: 6\.30조원 \[2026-11-06 · KRX\]/);
assert.ok(msg.length<=3900);
assert.match(msg,/KRX 거래대금 2\/2/);
for(const invalid of [
 [{...kospi,date:'2026-11-05'},kosdaq],
 [{...kospi,source:'YAHOO_DAILY_REFERENCE'},kosdaq],
 [kospi,kospi],
 [{...kospi,valueKrw:20.25},kosdaq],
 [{...kospi,role:'UNVERIFIED'},kosdaq]
]){
 const rows=verifyOfficialKrxTurnover(day,invalid);
 const result=summarizeCloseCoverage(day,{nh,turnover:invalid,expectedUsDate:us});
 if(invalid.length===2&&rows.length===0)assert.equal(result.turnover.verified,0);
 const printed=formatClose(day,nh,[],[],[],[],[],[],now(),[],[],null,null,invalid);
 if(rows.length===0)assert.doesNotMatch(printed,/KOSPI 거래대금: \d/);
}
const partial=summarizeCloseCoverage(day,{nh,turnover:[kospi],expectedUsDate:us});
assert.equal(partial.turnover.verified,1);
const failed=summarizeCloseCoverage(day,{nh,failedGroups:['TURNOVER'],expectedUsDate:us});
assert.equal(failed.turnover.verified,0);
assert.deepEqual(failed.statuses.filter(x=>x.id.startsWith('KRX_TURNOVER_'))
 .map(x=>x.status),['FETCH_FAILED','FETCH_FAILED']);
assert.throws(()=>summarizeCloseCoverage(day,{nh,turnover:{},expectedUsDate:us}),
 /COVERAGE_INPUT_INVALID/);

let calls=0;
const options={
 now,repository:'cyyoung111-dev/portfolio',githubToken:'TEST_GITHUB_TOKEN',
 fetchImpl:async target=>{
  assert.match(String(target),/api\.github\.com/);
  return {ok:true,json:async()=>({total_count:0,artifacts:[]})};
 },
 fetchNh:async()=>nh,
 fetchDomestic:async()=>[],fetchSecondary:async()=>[],
 fetchStocks:async()=>[],fetchMacros:async()=>[],fetchMarkets:async()=>[],
 fetchFutures:async()=>[],fetchRates:async()=>[],fetchVkospi:async()=>[],
 fetchTurnover:async(date,{now:clock})=>{
  calls++;assert.equal(date,day);assert.equal(clock(),now());
  return [kospi,kosdaq];
 },
 loadPrepared:async()=>null,loadFinancialEvidence:async()=>null
};
const prepared=await prepareClose(options);
assert.equal(prepared.ready,true);assert.equal(calls,1);
assert.equal(prepared.turnoverCount,2);
assert.equal(prepared.reportInputs.turnover.length,2);
assert.equal(prepared.coverage.turnover.verified,2);
assert.match(prepared.message,/KOSPI 거래대금: 20\.25조원/);
assert.match(prepared.message,/KRX 거래대금 2\/2/);
let sends=0;
const received=[];
const sent=await deliverClose(prepared,{now,send:async(_token,_chat,text)=>{
 sends++;received.push(text);
}});
assert.equal(sent.status,'SENT');
assert.equal(sends,1);
assert.match(received[0],/KOSDAQ 거래대금: 6\.30조원/);
assert.ok(received[0].length<=4000);
assert.deepEqual(prepared.reportInputs.turnover,[kospi,kosdaq]);
for(const mutation of [
 {turnoverCount:1},
 {reportInputs:{...prepared.reportInputs,turnover:[kospi,kospi]}},
 {reportInputs:{...prepared.reportInputs,turnover:[{...kospi,date:us},kosdaq]}},
 {reportInputs:{...prepared.reportInputs,turnover:'private-token'}},
 {reportInputs:{...prepared.reportInputs,turnover:[{...kospi,source:'UNVERIFIED'},kosdaq]}},
]){
 await assert.rejects(deliverClose({...prepared,...mutation},{now,send:async()=>{sends++;}}),
  /TELEGRAM_CLOSE_PAYLOAD_INVALID/);
}
assert.equal(sends,1,'no forged stale or duplicate rows reach Telegram');
const partialPrepared=await prepareClose({...options,fetchTurnover:async()=>[kospi]});
assert.equal(partialPrepared.coverage.turnover.verified,1);
assert.match(partialPrepared.message,/KOSPI 거래대금: 20\.25조원/);
assert.match(partialPrepared.message,/KOSDAQ 거래대금: 공식 당일 자료 미확보/);
const failure=await prepareClose({...options,fetchTurnover:async()=>{
 throw Error('SECRET_PROVIDER_ERROR');
}});
assert.equal(failure.ready,true,'optional turnover failure cannot block core close');
assert.equal(failure.turnoverCount,0);
assert.equal(failure.coverage.turnover.verified,0);
assert.deepEqual(failure.coverage.groupErrors,['TURNOVER']);
assert.match(failure.message,/KRX 거래대금 0\/2/);
assert.doesNotMatch(JSON.stringify(failure),/SECRET_PROVIDER_ERROR/);
assert.equal((await deliverClose(failure,{now,send:async()=>{sends++;}})).status,'SENT');
assert.equal(sends,2);
const stale=await prepareClose({...options,fetchTurnover:async()=>[
 {...kospi,date:us},kosdaq]});
assert.equal(stale.coverage.turnover.verified,0,
 'a mismatched day must reject the whole turnover source group');
assert.doesNotMatch(stale.message,/KOSPI 거래대금: \d/);
console.log('CLOSE_KRX_TURNOVER_WIRING_PASS connected, official-date, partial, stale, provider-failure, send-revalidation');
