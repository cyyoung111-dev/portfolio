import assert from 'node:assert/strict';
import {validateMorningFuturesQuote,readMorningSupplements,formatMorningFutures,
 formatMorningTreasury,formatMorningVkospi,formatMorningTurnover}
 from './telegram-morning-supplements.mjs';
import {formatFullMorningBriefing} from './telegram-morning-report.mjs';
import {MORNING_SERIES} from './telegram-morning-report.mjs';

const date='2026-11-05',expected='2026-11-04';
const now=new Date('2026-11-05T07:40:00+09:00');
const quoteAt='2026-11-05T06:58:00+09:00';
const stamp=Math.floor(Date.parse(quoteAt)/1000);
function chart(symbol,at=stamp,value=7000){
 return {chart:{result:[{meta:{symbol},timestamp:[at],
  indicators:{quote:[{close:[value]}]}}]}};
}
const good=validateMorningFuturesQuote(date,'ES',chart('ES=F'),now);
assert.equal(good?.source,'YAHOO_DELAYED_FUTURES_REFERENCE');
assert.equal(good?.value,7000);
// At 07:40 KST a CME maintenance bar may have a timestamp but no trades.
// The LAST actual positive trade remains valid only within its real 90m age.
const maintenance=chart('ES=F');
maintenance.chart.result[0].timestamp=[stamp,stamp+300,stamp+600];
maintenance.chart.result[0].indicators.quote[0].close=[7000,null,null];
const lastTrade=validateMorningFuturesQuote(date,'ES',maintenance,now);
assert.equal(lastTrade?.value,7000);
assert.equal(lastTrade?.asOf,new Date(stamp*1000).toISOString());
const invalidTrailing=structuredClone(maintenance);
invalidTrailing.chart.result[0].indicators.quote[0].close=[7000,'INVALID',null];
assert.equal(validateMorningFuturesQuote(date,'ES',invalidTrailing,now),null);
const unordered=structuredClone(maintenance);
unordered.chart.result[0].timestamp=[stamp,stamp+600,stamp+300];
assert.equal(validateMorningFuturesQuote(date,'ES',unordered,now),null);
assert.equal(validateMorningFuturesQuote(date,'ES',
 chart('ES=F',stamp-6000),now),null,'90m age cap');
assert.equal(validateMorningFuturesQuote(date,'ES',
 chart('NQ=F'),now),null,'wrong instrument');
assert.equal(validateMorningFuturesQuote(date,'ES',
 chart('ES=F',stamp+7200),now),null,'future quote');

const gasUrl='https://script.google.com/macros/s/Example123456/exec';
const calls=[];
const fetchImpl=async(target,opts={})=>{
 const url=new URL(target);calls.push(url.hostname);
 if(url.hostname==='query1.finance.yahoo.com'){
  const symbol=decodeURIComponent(url.pathname.split('/').at(-1));
  return {ok:true,json:async()=>chart(symbol,stamp,7000)};
 }
 if(url.hostname==='fred.stlouisfed.org'){
  const code=url.searchParams.get('id');
  const values={DGS2:'4.00',DGS3:'4.10',DGS10:'4.40'};
  return {ok:true,headers:{get:()=> 'text/csv'},text:async()=>
   'observation_date,'+code+'\n'+expected+','+values[code]+'\n'};
 }
 if(url.hostname==='script.google.com'){
  assert.equal(opts.method,'POST');
  assert.equal(opts.body.get('accessToken'),'TEST_ACCESS_123456');
  const action=opts.body.get('action');
  if(action==='getBenchmark')return {ok:true,json:async()=>({
   status:'ok',symbol:'KRX_OPEN_API:VKOSPI',
   points:[{date:expected,sourceDate:expected,source:'KRX_OFFICIAL',value:24.2}]
  })};
  if(action==='getKrxMarketTurnover')return {ok:true,json:async()=>({
   status:'ok',date:expected,readOnly:true,source:'KRX_OFFICIAL_INDEX_DAILY',
   rows:[{id:'KRX_TURNOVER_KOSPI',market:'KOSPI',date:expected,
    valueKrw:35000000000000,source:'KRX_OFFICIAL_INDEX_DAILY',
    role:'NON_NH_REFERENCE_ONLY'}]
  })};
 }
 throw Error('unexpected test URL');
};
const seen=[];
const fetchDaily=async(label,symbol,requested,{now:time})=>{
 assert.equal(requested,date);
 assert.equal(time.getTime(),now.getTime());
 seen.push(symbol);
 return {label,symbol,date:expected,value:7000,changePercent:1.5,
  source:'Yahoo Finance 일봉'};
};
const extras=await readMorningSupplements(date,{
 now:()=>now,fetchImpl,fetchDaily,nhRows:[],url:gasUrl,token:'TEST_ACCESS_123456'
});
assert.equal(extras.usReferences.length,3);
assert.deepEqual(seen,['^GSPC','^IXIC','^NDX']);
assert.equal(extras.futures.length,4);
assert.equal(extras.treasury.length,3);
assert.equal(extras.vkospi.length,1);
assert.equal(extras.turnover.length,1);
assert.match(formatMorningFutures(date,extras.futures,now),/ES 7,000/);
assert.match(formatMorningTreasury(date,extras.treasury),/10Y-2Y \+40bp/);
assert.match(formatMorningVkospi(extras.vkospi),/24\.20/);
const mixedFRED=[
 {id:'UST2Y',label:'미 국채 2년',date:'2026-11-03',value:4.01,source:'FRED_H15_DAILY'},
 {id:'UST3Y',label:'미 국채 3년',date:'2026-11-04',value:4.12,source:'FRED_H15_DAILY'},
 {id:'UST10Y_FRED',label:'미 국채 10년',date:'2026-11-03',value:4.45,source:'FRED_H15_DAILY'}
];
const mixedText=formatMorningTreasury('2026-11-05',mixedFRED);
assert.match(mixedText,/2Y 4\.01% \[2026-11-03 · 발표 지연\]/);
assert.match(mixedText,/3Y 4\.12% \[2026-11-04\]/);
assert.match(mixedText,/10Y 4\.45% \[2026-11-03 · 발표 지연\]/);
assert.match(mixedText,/10Y-2Y \+44bp \[2026-11-03\]/);
const conflictingText=formatMorningTreasury('2026-11-05',
 mixedFRED.map(x=>x.id==='UST10Y_FRED'?{...x,date:'2026-11-04'}:x));
assert.match(conflictingText,/10Y-2Y 기준일 불일치 또는 미확보/);

assert.match(formatMorningTurnover(extras.turnoverDate,extras.turnover),/35\.00조원/);
const opts={now,supplements:{
 usReferences:extras.usReferences,
 futures:formatMorningFutures(date,extras.futures,now),
 treasury:formatMorningTreasury(date,extras.treasury),
 vkospi:formatMorningVkospi(extras.vkospi),
 turnover:formatMorningTurnover(extras.turnoverDate,extras.turnover)
}};
const report=formatFullMorningBriefing(date,null,[],opts);
assert.match(report,/S&P 500: 7,000 .*Yahoo 일봉 참고 \/ NH 미확보/);
assert.match(report,/NASDAQ100: 7,000 .*Yahoo 일봉 참고 \/ NH 미확보/);
assert.match(report,/미 국채 2Y 4\.00%/);
assert.match(report,/VKOSPI: 24\.20/);
assert.match(report,/미국 선물 참고: ES/);
assert.match(report,/■ QC: 기준 거래일과 일치한 일봉 0\/21/);
assert.ok(report.length<=3900, 'Telegram maximum length');

// GAS retrieval is preferred, but transient missing/partial rows can
// recover from two exact-date official KRX index endpoints with no GAS write.
const {readMorningTurnover,readMorningVkospi}=await import('./telegram-morning-supplements.mjs');
const official=[
 {id:'KRX_TURNOVER_KOSPI',market:'KOSPI',date:expected,valueKrw:20000000000000,
  source:'KRX_OFFICIAL_INDEX_DAILY',role:'NON_NH_REFERENCE_ONLY'},
 {id:'KRX_TURNOVER_KOSDAQ',market:'KOSDAQ',date:expected,valueKrw:5000000000000,
  source:'KRX_OFFICIAL_INDEX_DAILY',role:'NON_NH_REFERENCE_ONLY'}
];
let fallbackCount=0;
const fallback=async(day,args)=>{
 fallbackCount++;
 assert.equal(day,expected);
 assert.equal(args.now().toISOString(),new Date(expected+'T17:08:00+09:00').toISOString());
 return official;
};
const repaired=await readMorningTurnover(expected,{url:gasUrl,token:'TEST_ACCESS_123456',
 authKey:'TEST_KRX_KEY_123456789',fetchImpl,fetchDirect:fallback});
assert.deepEqual(repaired,official);
assert.equal(fallbackCount,1);
const noKey=await readMorningTurnover(expected,{url:gasUrl,token:'TEST_ACCESS_123456',
 authKey:'',fetchImpl,fetchDirect:async()=>assert.fail('must not request direct keyless')});
assert.equal(noKey.length,1);
const stale=await readMorningTurnover(expected,{url:'',token:'',authKey:'TEST_KRX_KEY_123456789',
 fetchImpl,fetchDirect:async()=>official.map(x=>({...x,date:'2026-11-03'}))});
assert.deepEqual(stale,[],'wrong-date direct KRX data must fail closed');

// KRX approved index fallback must never alter a valid GAS primary.
const recoveredVk=await readMorningVkospi(expected,{
 url:gasUrl,token:'TEST_ACCESS_123456',authKey:'KRX_APPROVED_TEST_KEY_123456',
 now:()=>now,fetchImpl:async()=>({ok:true,json:async()=>({
  status:'error',message:'선택 기간의 VKOSPI 데이터를 조회하지 못했습니다.'
 })}),fetchDirect:async(day)=>[{
  id:'VKOSPI',label:'VKOSPI',date:day,value:27.65,
  source:'KRX_OFFICIAL',role:'NON_NH_REFERENCE_ONLY'
 }]});
assert.equal(recoveredVk.length,1);
assert.equal(recoveredVk[0].value,27.65);
const staleVk=await readMorningVkospi(expected,{
 url:'',token:'',authKey:'KRX_APPROVED_TEST_KEY_123456',
 fetchDirect:async()=>[{...recoveredVk[0],date:'2026-11-03'}]});
assert.deepEqual(staleVk,[],'stale direct VKOSPI must fail closed');

const nh=MORNING_SERIES.filter(x=>['SPX','NASDAQ','NDX'].includes(x.id))
 .map(x=>({symbol:x.symbol,date:expected,source:'NH_INDEX_DAILY'}));
const noFallback=await readMorningSupplements(date,{
 now:()=>now,fetchImpl,fetchDaily:async()=>assert.fail('NH already available'),
 nhRows:nh,url:gasUrl,token:'TEST_ACCESS_123456'
});
assert.equal(noFallback.usReferences.length,0,'NH primary wins');
assert.equal(formatMorningFutures(date,[],now).includes('미확보'),true);
console.log('Morning supplement reference-only strict date, KST CME maintenance, FRED, GAS QC PASS');
