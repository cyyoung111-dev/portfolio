import assert from 'node:assert/strict';
import {MORNING_SERIES,collectMorningSeries,formatFullMorningBriefing,
 expectedMorningDate} from './telegram-morning-report.mjs';
import {fetchDatedDaily} from './telegram-morning-briefing.mjs';
import {verifiedYahoo52WeekRange,formatMorningYahoo52WeekRanges,
 yahoo52WeekRequested} from './briefing-yahoo-52week-range.mjs';

const report='2026-11-09',session='2026-11-06';
const now=new Date('2026-11-09T07:40:00+09:00');
const DAY=86400000;
const start=Date.parse('2025-11-10T00:00:00Z');
const end=Date.parse(session+'T00:00:00Z');
const series=[];
for(let stamp=start;stamp<=end;stamp+=DAY){
 const d=new Date(stamp);
 if([0,6].includes(d.getUTCDay()))continue;
 const i=series.length;
 const close=100+i%7;
 series.push({date:d.toISOString().slice(0,10),close,
  high:close+10,low:close-10});
}
const chart={chart:{result:[{
 meta:{symbol:'^SOX',exchangeTimezoneName:'Etc/UTC'},
 timestamp:series.map(x=>Date.parse(x.date+'T12:00:00Z')/1000),
 indicators:{quote:[{
  close:series.map(x=>x.close),
  high:series.map(x=>x.high),
  low:series.map(x=>x.low)
 }]}
}]}};
assert.ok(series.length>=250);
assert.equal(yahoo52WeekRequested('SOX'),true);
assert.equal(yahoo52WeekRequested('BTC'),true);
assert.equal(yahoo52WeekRequested('SAMSUNG'),false);
assert.equal(yahoo52WeekRequested('NDX'),false);
const range=verifiedYahoo52WeekRange(series,session);
assert.ok(range);
assert.equal(range.high,116);
assert.equal(range.low,90);
assert.equal(range.asOf,session);
assert.equal(range.from,'2025-11-07');
assert.ok(range.observations>=250&&range.observations<=263);
assert.equal(range.source,'YAHOO_DAILY_OHLC');
assert.equal(verifiedYahoo52WeekRange(series,report),null,'report day is unfinished');
assert.equal(verifiedYahoo52WeekRange(series.slice(100),session),null,
 'short history must never be called a 52-week range');
assert.equal(verifiedYahoo52WeekRange([...series,series[0]],session),null,
 'duplicated session cannot alter high/low');
assert.equal(verifiedYahoo52WeekRange(series.map((x,i)=>i===50
 ?{...x,close:x.high+1}:x),session),null);
assert.equal(verifiedYahoo52WeekRange(series.map((x,i)=>i===100
 ?{...x,low:x.high+1}:x),session),null);
assert.equal(verifiedYahoo52WeekRange(series.slice(0,-1),session),null,
 'a prior-date close cannot become current-day 52w reference');

let period1s=[],hosts=[];
const fetched=async url=>{
 const u=new URL(url);
 hosts.push(u.host);
 period1s.push(Number(u.searchParams.get('period1')));
 assert.equal(u.searchParams.get('interval'),'1d');
 assert.equal(decodeURIComponent(u.pathname.split('/').at(-1)),'^SOX');
 return {ok:true,json:async()=>chart};
};
const quote=await fetchDatedDaily('SOX','^SOX',report,{
 now,fetchImpl:fetched,include52Week:true,expectedSessionDate:session});
assert.equal(quote.date,session);
assert.equal(quote.value,series.at(-1).close);
assert.equal(quote.range52w.high,116);
assert.equal(quote.range52w.low,90);
assert.equal(quote.range52w.observations,range.observations);
assert.ok(period1s[0]<=Date.parse('2025-11-01T00:00:00Z')/1000);
assert.deepEqual(hosts,['query1.finance.yahoo.com']);
const ordinary=await fetchDatedDaily('SOX','^SOX',report,{now,fetchImpl:fetched});
assert.equal(ordinary.range52w,undefined);
assert.ok(period1s[1]>period1s[0]);
const dateMismatch=await fetchDatedDaily('SOX','^SOX',report,{
 now,fetchImpl:fetched,include52Week:true,expectedSessionDate:'2026-11-05'});
assert.equal(dateMismatch.range52w,undefined);
const noOhlc={chart:{result:[{...chart.chart.result[0],
 indicators:{quote:[{close:series.map(x=>x.close)}]}}]}};
const noOhlcQuote=await fetchDatedDaily('SOX','^SOX',report,{now,include52Week:true,
 expectedSessionDate:session,
 fetchImpl:async()=>({ok:true,json:async()=>noOhlc})});
assert.equal(noOhlcQuote?.date,session);
assert.equal(noOhlcQuote.range52w,undefined,
 'do not infer 52-week high-low from closing prices');

let requested=[];
const collected=await collectMorningSeries(report,{
 now,skipSymbols:new Set(MORNING_SERIES.filter(x=>x.id!=='SOX').map(x=>x.symbol)),
 fetchDaily:async(label,symbol,target,opts)=>{
  requested.push({symbol,include52Week:opts.include52Week,expected:opts.expectedSessionDate});
  return fetchDatedDaily(label,symbol,target,{...opts,fetchImpl:fetched});
 }
});
assert.equal(collected.length,1);
assert.equal(requested.length,1);
assert.equal(requested[0].include52Week,true);
assert.equal(requested[0].expected,session);
assert.equal(collected[0].range52w.high,116);
const rendered=formatFullMorningBriefing(report,null,collected,{now});
assert.match(rendered,/■ 52주 최고·최저 \/ 범위 내 종가 위치/);
assert.match(rendered,/SOX 52주 고 116\/저 90/);
assert.match(rendered,/Yahoo OHLC 참고/);
assert.ok(rendered.length<=3900);
assert.match(rendered,/■ QC: 기준 거래일과 일치한 일봉 1\/21/);
const map=new Map([[collected[0].symbol,collected[0]]]);
const sections=formatMorningYahoo52WeekRanges(map,report,
 (id,d)=>expectedMorningDate(id,d,now));
assert.equal(sections.length,2);
assert.deepEqual(formatMorningYahoo52WeekRanges(new Map(),report,
 (id,d)=>expectedMorningDate(id,d,now)),[]);
const fake={...collected[0],source:'NH_INDEX_DAILY'};
assert.deepEqual(formatMorningYahoo52WeekRanges(new Map([[fake.symbol,fake]]),
 report,(id,d)=>expectedMorningDate(id,d,now)),[]);
const forged={...collected[0],range52w:{...range,high:80,low:120}};
assert.deepEqual(formatMorningYahoo52WeekRanges(new Map([[forged.symbol,forged]]),
 report,(id,d)=>expectedMorningDate(id,d,now)),[]);
const old={...collected[0],date:'2026-11-05'};
assert.deepEqual(formatMorningYahoo52WeekRanges(new Map([[old.symbol,old]]),
 report,(id,d)=>expectedMorningDate(id,d,now)),[]);
const crowdedRows=MORNING_SERIES.map((x,i)=>({
 label:x.label,symbol:x.symbol,date:expectedMorningDate(x.id,report,now),
 value:x.id==='UST10Y'?4.6:100+i,changePercent:0.1,source:'Yahoo Finance 일봉'
})).map(x=>x.symbol==='^SOX'?collected[0]:x);
const full=formatFullMorningBriefing(report,null,crowdedRows,{now});
assert.ok(full.length<=3900,'optional 52-week detail must not block 21/21 QC');
assert.match(full,/■ QC: 기준 거래일과 일치한 일봉 21\/21/);
console.log('MORNING_52W_YAHOO_PASS dated_complete_OHLC no_new_calls verified_range optional_budget privacy');
