import assert from 'node:assert/strict';
import {MORNING_SERIES,collectMorningSeries,formatFullMorningBriefing} from './telegram-morning-report.mjs';
import {formatMorningBriefing} from './telegram-morning-briefing.mjs';
const date='2026-10-30',ref={value:900.05,tradingDate:date};
assert.equal(MORNING_SERIES.length,20);
assert.deepEqual(MORNING_SERIES.map(x=>x.id).slice(0,5),['KOSPI','KOSDAQ','KOSPI200','SAMSUNG','SKHYNIX']);
const rows=[
 {label:'KOSPI',symbol:'^KS11',date:'2026-10-29',value:4110,changePercent:1.2},
 {label:'S&P 500',symbol:'^GSPC',date:'2026-10-29',value:6900,changePercent:0.5},
 {label:'SOX',symbol:'^SOX',date:'2026-10-29',value:6900,changePercent:0.4},
 {label:'VIX',symbol:'^VIX',date:'2026-10-29',value:18,changePercent:-2.3},
 {label:'원/달러',symbol:'KRW=X',date:'2026-10-29',value:1440,changePercent:0.1},
 {label:'미 10년물',symbol:'^TNX',date:'2026-10-29',value:41.2,changePercent:-0.2},
];
const report=formatFullMorningBriefing(date,ref,rows);
assert.equal(formatMorningBriefing(date,ref,rows),report);
for (const part of ['오늘의 결론','전일 한국장','밤사이 미국장','코스피200 야간선물','환율 / 금리','원자재','수급·유동성','오늘의 시나리오','QC'])assert.ok(report.includes(part),part);
assert.match(report,/위험선호 신호 우세/);
assert.match(report,/900.05pt/);
assert.match(report,/06:00 KST \(NH\)/);
assert.match(report,/4.12% \(Yahoo \^TNX 환산\)/);
assert.match(report,/외국인\/기관.*미확보/);
assert.match(report,/미국 선물 ES\/NQ\/YM\/RTY: 장전 실시간 검증값 미확보/);
assert.match(report,/투자판단|Base:/);
assert.match(report,/공식 정산가와 다릅니다/);
assert.ok(report.length<3900);
assert.doesNotMatch(report,/NaN|undefined|null/);
const missing=formatFullMorningBriefing(date,null,[]);
assert.match(missing,/당일 참고값 미확보/);
assert.match(missing,/판단 보류/);
assert.ok(!missing.includes('900.05'));
let active=0,max=0,calls=0;
const all=await collectMorningSeries(date,{concurrency:4,fetchDaily:async(label,symbol)=>{
 calls++; active++;max=Math.max(max,active);
 await Promise.resolve();
 active--;
 return {label,symbol,date:'2026-10-29',value:1,changePercent:0};
}});
assert.equal(calls,20);assert.equal(all.length,20);assert.ok(max<=4);
const stale=await collectMorningSeries(date,{fetchDaily:async(label,symbol)=>({label,symbol,date,value:900})});
assert.equal(stale.length,0,'same-day incomplete daily prices must not pass');
console.log('Full morning Telegram report: grouping, verified date, missing flags, rate cap, scenarios PASS');
