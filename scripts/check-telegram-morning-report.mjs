import assert from 'node:assert/strict';
import {MORNING_SERIES,collectMorningSeries,formatFullMorningBriefing,expectedMorningDate} from './telegram-morning-report.mjs';
import {formatMorningBriefing} from './telegram-morning-briefing.mjs';
const date='2026-10-30',ref={value:900.05,tradingDate:date};
assert.equal(MORNING_SERIES.length,21);
assert.ok(MORNING_SERIES.some(x=>x.id==='DOW'&&x.symbol==='^DJI'));
assert.equal(expectedMorningDate('NVDA','2026-10-30'),'2026-10-29');
assert.equal(expectedMorningDate('MU','2026-10-30'),'2026-10-29');
assert.equal(expectedMorningDate('DOW','2026-10-30'),'2026-10-29');
assert.equal(expectedMorningDate('BTC','2026-10-30'),'2026-10-29');
assert.equal(expectedMorningDate('BTC','2026-11-02'),'2026-11-01');
assert.equal(expectedMorningDate('NVDA','2026-11-02'),'2026-10-30');
assert.equal(expectedMorningDate('KOSPI','2026-10-12'),'2026-10-08');
assert.deepEqual(MORNING_SERIES.map(x=>x.id).slice(0,5),['KOSPI','KOSDAQ','KOSPI200','SAMSUNG','SKHYNIX']);
const rows=[
 {label:'KOSPI',symbol:'^KS11',date:'2026-10-29',value:4110,changePercent:1.2},
 {label:'S&P 500',symbol:'^GSPC',date:'2026-10-29',value:6900,changePercent:0.5},
 {label:'다우존스',symbol:'^DJI',date:'2026-10-29',value:52342.56,changePercent:-0.25},
 {label:'SOX',symbol:'^SOX',date:'2026-10-29',value:6900,changePercent:0.4},
 {label:'VIX',symbol:'^VIX',date:'2026-10-29',value:18,changePercent:-2.3},
 {label:'원/달러',symbol:'KRW=X',date:'2026-10-29',value:1440,changePercent:0.1},
 {label:'미 10년물',symbol:'^TNX',date:'2026-10-29',value:41.2,changePercent:-0.2},
];
const report=formatFullMorningBriefing(date,ref,rows);
assert.equal(formatMorningBriefing(date,ref,rows),report);
for (const part of ['오늘의 결론','전일 한국장','밤사이 미국장','코스피200 야간선물','환율 / 금리','원자재','수급·유동성','오늘의 시나리오','QC'])assert.ok(report.includes(part),part);
assert.match(report,/위험선호 신호 우세/);
assert.match(report,/다우존스: 52,342.56.*2026-10-29/);
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
assert.equal(calls,21);assert.equal(all.length,21);assert.ok(max<=4);
let bypassCalls=0;
const bypass=await collectMorningSeries(date,{skipSymbols:new Set(['^GSPC','^IXIC','^NDX']),
 fetchDaily:async(label,symbol)=>{bypassCalls++;return {label,symbol,date:'2026-10-29',value:1,changePercent:0};}});
assert.equal(bypassCalls,18);assert.equal(bypass.length,18);
const nhReport=formatFullMorningBriefing(date,ref,[{label:'S&P 500',symbol:'^GSPC',
 date:'2026-10-29',value:7720.39,changePercent:0.52,source:'NH_INDEX_DAILY'}]);
assert.match(nhReport,/S&P 500: 7,720.39.*NH PLUG 일봉/);
const stale=await collectMorningSeries(date,{fetchDaily:async(label,symbol)=>({label,symbol,date,value:900})});
assert.equal(stale.length,0,'same-day incomplete daily prices must not pass');

const row=(id,date)=>{const item=MORNING_SERIES.find(x=>x.id===id);return {label:item.label,symbol:item.symbol,date,value:100,changePercent:1,source:'Yahoo Finance 일봉'};};
const stale28=[row('NVDA','2026-10-28'),row('MU','2026-10-28'),row('BTC','2026-10-28')];
const badReport=formatFullMorningBriefing(date,ref,stale28);
assert.match(badReport,/엔비디아: 미확보/);
assert.match(badReport,/마이크론: 미확보/);
assert.match(badReport,/BTC: 미확보/);
assert.equal(await collectMorningSeries(date,{fetchDaily:async(label,symbol,target,args)=>{
 if(['NVDA','MU','BTC-USD'].includes(symbol))return row({NVDA:'NVDA',MU:'MU','BTC-USD':'BTC'}[symbol],'2026-10-28');
 return null;
}}).then(x=>x.length),0,'never silently reuse October 28 close for October 30 briefing');
const alternateHosts=[];
const recovered=await collectMorningSeries(date,{fetchDaily:async(label,symbol,target,{host}={})=>{
 if(symbol!=='NVDA')return null;
 alternateHosts.push(host||'query1.finance.yahoo.com');
 return row('NVDA',host==='query2.finance.yahoo.com'?'2026-10-29':'2026-10-28');
}});
assert.deepEqual(alternateHosts,['query1.finance.yahoo.com','query2.finance.yahoo.com']);
assert.equal(recovered.length,1);
assert.equal(recovered[0].date,'2026-10-29');
const expectedRows=await collectMorningSeries(date,{fetchDaily:async(label,symbol)=>symbol==='NVDA'?row('NVDA','2026-10-28'):null});
assert.equal(expectedRows.length,0,'stale Yahoo primary and alternate cannot be reported as current US close');


const {validWindow,prepareCorrection,sendCorrection,CLAIM}=await import('./telegram-morning-correction-20261030.mjs');
assert.equal(validWindow(new Date('2026-10-30T09:45:00+09:00')),true);
assert.equal(validWindow(new Date('2026-10-31T09:45:00+09:00')),false);
let correctionClaimCount=0,correctionSends=0;
const correctionMock=async(url)=>{assert.match(String(url),/actions\/artifacts/);
 return {ok:true,json:async()=>({total_count:correctionClaimCount,
   artifacts:correctionClaimCount?[{name:CLAIM}]:[]})};};
const correction=await prepareCorrection({now:()=>new Date('2026-10-30T09:45:00+09:00'),
 token:'GITHUB_TEST_ONLY',repository:'cyyoung111-dev/portfolio',fetchImpl:correctionMock,
 referenceFetch:async()=>({source:'NH',kind:'REFERENCE',tradingDate:'2026-10-30',officialClose:false,
   sourceUpdatedAt:'2026-10-30T06:00:00+09:00',value:900.05}),
 quoteFetch:async(label,symbol)=> ['^KS11','^KQ11','^GSPC','^SOX','^VIX','KRW=X'].includes(symbol)
    ?{label,symbol,date:'2026-10-29',value:100,changePercent:0.5}:null});
assert.equal(correction.ready,true);
assert.match(correction.message,/장전 브리핑 정정본/);
assert.match(correction.message,/오늘의 결론/);
assert.match(correction.message,/수급·유동성/);
assert.match(correction.message,/900.05pt/);
assert.ok(correction.seriesCount>=4);
correctionClaimCount=1;
const duplicate=await prepareCorrection({now:()=>new Date('2026-10-30T09:45:00+09:00'),
 token:'GITHUB_TEST_ONLY',fetchImpl:correctionMock});
assert.equal(duplicate.status,'ALREADY_CLAIMED');
await sendCorrection(correction,{now:()=>new Date('2026-10-30T09:45:00+09:00'),
 send:async()=>{correctionSends++;}});
assert.equal(correctionSends,1);
await assert.rejects(()=>sendCorrection(correction,{now:()=>new Date('2026-10-31T09:45:00+09:00'),
 send:async()=>{correctionSends++;}}),/CORRECTION_SEND_DENIED/);
assert.equal(correctionSends,1);

console.log('Full morning Telegram report: grouping, verified date, missing flags, rate cap, scenarios PASS');
