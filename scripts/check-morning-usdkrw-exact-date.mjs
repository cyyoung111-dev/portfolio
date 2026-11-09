#!/usr/bin/env node
// Reproduces the 2026-11-09 20/21 USDKRW date-selection gap using the real
// morning fetcher and formatter, but synthetic Yahoo candles. No HTTP, GAS,
// Sheets, Telegram or account writes.
import assert from 'node:assert/strict';
import {fetchDatedDaily} from './telegram-morning-briefing.mjs';
import {MORNING_SERIES,expectedMorningDate,collectMorningSeries,
 formatFullMorningBriefing} from './telegram-morning-report.mjs';

const date='2026-11-09';
const now=new Date('2026-11-09T07:40:00+09:00');
assert.equal(expectedMorningDate('USDKRW',date,now),'2026-11-06');
const forex=MORNING_SERIES.find(x=>x.id==='USDKRW');
assert(forex);
const onlyFx=new Set(MORNING_SERIES.filter(x=>x.id!=='USDKRW').map(x=>x.symbol));
const obsDate=['2026-11-05','2026-11-06','2026-11-08'];
const obsClose=[1420,1425,1432];
const chart=(dates=obsDate,closes=obsClose)=>({chart:{result:[{
 meta:{symbol:'KRW=X',exchangeTimezoneName:'Asia/Seoul',currency:'KRW'},
 timestamp:dates.map(d=>Date.parse(d+'T15:00:00+09:00')/1000),
 indicators:{quote:[{close:closes}]}
}]}});
const urls=[];
const fetchFixture=async url=>{
 urls.push(url);
 const u=new URL(url);
 assert(['query1.finance.yahoo.com','query2.finance.yahoo.com'].includes(u.hostname));
 assert.equal(decodeURIComponent(u.pathname.split('/').at(-1)),'KRW=X');
 return {ok:true,json:async()=>chart()};
};

const recovered=await fetchDatedDaily('원/달러','KRW=X',date,{
 now,fetchImpl:fetchFixture,expectedSessionDate:'2026-11-06'});
assert.equal(recovered?.date,'2026-11-06');
assert.equal(recovered?.value,1425);
assert.equal(recovered?.source,'Yahoo Finance 일봉');
assert(Math.abs(recovered.changePercent-(1425/1420-1)*100)<1e-12);
assert.equal(urls.length,1,'No extra query or provider call for the fix');
// For direct callers without a dated expectation, preserve existing last-bar
// behavior. Do not globally redefine the Yahoo completed FX close.
const ordinary=await fetchDatedDaily('원/달러','KRW=X',date,{
 now,fetchImpl:fetchFixture});
assert.equal(ordinary?.date,'2026-11-08');
assert.equal(ordinary?.value,1432);

// The exact bar must physically exist. No backdating, stale carry or
// weekend reinterpretation even when a newer chart candle exists.
const missingExpected=await fetchDatedDaily('원/달러','KRW=X',date,{
 now,expectedSessionDate:'2026-11-06',
 fetchImpl:async()=>({ok:true,json:async()=>chart(
  ['2026-11-05','2026-11-08'],[1420,1432])})});
assert.equal(missingExpected,null,'Do not substitute another date');

const collected=await collectMorningSeries(date,{
 now,skipSymbols:onlyFx,
 fetchDaily:(label,symbol,day,options)=>fetchDatedDaily(label,symbol,day,{
  ...options,fetchImpl:fetchFixture})
});
assert.equal(collected.length,1);
assert.equal(collected[0].date,'2026-11-06');
const text=formatFullMorningBriefing(date,null,collected,{now});
assert.match(text,/원\/달러: 1,425/);
assert.match(text,/2026-11-06.*Yahoo 참고/);
assert.doesNotMatch(text,/원\/달러: 1,432/);

// Non-FX behavior stays last-bar semantics; the repair does not fabricate
// completed US stock prices from a later candle.
const stockChart={chart:{result:[{
 meta:{symbol:'NVDA',exchangeTimezoneName:'America/New_York',currency:'USD'},
 timestamp:['2026-11-05','2026-11-06'].map(d=>
  Date.parse(d+'T16:00:00-05:00')/1000),
 indicators:{quote:[{close:[100,110]}]}
}]}};
const stock=await fetchDatedDaily('엔비디아','NVDA',date,{
 now,expectedSessionDate:'2026-11-05',
 fetchImpl:async()=>({ok:true,json:async()=>stockChart})});
assert.equal(stock?.date,'2026-11-06',
 'Unrelated stock last-bar selection must be unchanged');
console.log(JSON.stringify({
 kind:'MORNING_USDKRW_EXACT_COMPLETED_DATE_TEST',
 expected:'2026-11-06',laterFxBar:'2026-11-08',
 recoveredFromExistingYahooChart:true,additionalNetworkCalls:0,
 missingExpectedFailsClosed:true,nonFxBehaviorUnchanged:true,
 financeWrites:0,telegramSends:0,gasDeployments:0
}));
