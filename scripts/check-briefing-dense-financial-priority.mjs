import assert from 'node:assert/strict';
import {MORNING_SERIES,expectedMorningDate,formatFullMorningBriefing}
 from './telegram-morning-report.mjs';
import {formatClose} from './telegram-close-workflow.mjs';
import {formatAiFinancialEvidence,fitAiFinancialEvidenceForBudget}
 from './briefing-financial-evidence.mjs';

const date='2026-11-09',us='2026-11-06';
const morningClock=new Date(date+'T07:45:00+09:00');
const closeClock=new Date(date+'T17:05:00+09:00');
const financial={
 kind:'AI_FINANCIAL_EVIDENCE_READ_ONLY',asOfKst:date,usSessionDate:us,
 domesticSessionDate:null,
 coverage:{ttm:9,fyOnly:0,referencePbr:9,domestic:2},
 items:['MSFT','AAPL','GOOGL','AMZN','META','NVDA','MU','ORCL','SNDK']
  .map(symbol=>({symbol,
   ttm:{basis:'TTM',period:'2026-09-30',ocfUsd:100e9,capexUsd:20e9,
    fcfUsd:80e9,capexToOcfPercent:20},
   value:{period:'2025-12-31',filingDate:'2026-02-15',
    priceDate:us,bpsUsd:123.45,pbrTimes:4.2}})),
 domestic:[
  {symbol:'005930',name:'삼성전자',evidence:{
   period:'2026-06-30',filingDate:'2026-08-15',
   bpsKrw:120000,status:'INDICATIVE_MULTICLASS_BPS',
   indicative:true,priceDate:null,pbrTimes:null}},
  {symbol:'000660',name:'SK하이닉스',evidence:{
   period:'2026-06-30',filingDate:'2026-08-15',
   bpsKrw:100000,status:'VERIFIED_SINGLECLASS_BPS',
   indicative:false,priceDate:null,pbrTimes:null}}
 ]
};
assert.match(formatAiFinancialEvidence(financial).join('\n'),
 /국내 DART BPS 2\/2/);
const requiredPanel=formatAiFinancialEvidence(financial).slice(0,3);
const exactPanel=requiredPanel.join('\n').length;
assert.deepEqual(fitAiFinancialEvidenceForBudget(financial,exactPanel),requiredPanel,
 'exact header+coverage+DART budget must prioritize both Korean BPS');
assert.deepEqual(fitAiFinancialEvidenceForBudget(financial,exactPanel-1),[],
 'partial DART line must never be truncated');
assert.deepEqual(fitAiFinancialEvidenceForBudget(financial,-1),[]);
assert.ok(fitAiFinancialEvidenceForBudget(financial,680).join('\n').length<=680);
const morningRows=MORNING_SERIES.map((item,i)=>({
 label:item.label,symbol:item.symbol,
 date:expectedMorningDate(item.id,date,morningClock),
 value:item.id==='UST10Y'?4.8:
  item.id==='SAMSUNG'?180000:
  item.id==='SKHYNIX'?200000:1000+i+0.75,
 changePercent:0.2,
 source:['SAMSUNG','SKHYNIX'].includes(item.id)
  ?'NH_REGULAR_CLOSE':'Yahoo Finance 일봉'
}));
const morningWithout=formatFullMorningBriefing(date,null,morningRows,
 {now:morningClock});
const morningWith=formatFullMorningBriefing(date,null,morningRows,
 {now:morningClock,financialEvidence:financial});
assert.match(morningWith,/기준 거래일과 일치한 일봉 21\/21/);
assert.match(morningWith,/삼성전자·SK하이닉스 정량 지표/);
assert.match(morningWith,/참고 PBR 1\.50배/);
assert.match(morningWith,/검증 BPS 100,000원 \/ PBR 2\.00배/);
assert.doesNotMatch(morningWith,/• 버핏:|• 하워드 막스:|5인 정량 관점/);
assert.match(morningWith,/■ 공시 재무 근거/);
assert.match(morningWith,/국내 DART BPS 2\/2/);
assert.match(morningWith,/삼성전자 보통·우선 합산 참고 BPS/);
assert.ok(morningWith.length<=3900,'dense 21/21 report cannot overrun 07:40 gate');

const nh=[
 ['S&P 500','^GSPC'],['NASDAQ','^IXIC'],['NASDAQ100','^NDX']
].map(([label,symbol],i)=>({label,symbol,date:us,
 value:7000+i*1000,changePercent:0.2,source:'NH_INDEX_DAILY'}));
const domestic=[
 ['KOSPI','KOSPI'],['KOSDAQ','KOSDAQ'],['KOSPI200','KOSPI 200']
].map(([type,label],i)=>({type,label,date,source:'KRX_OFFICIAL',
 role:'NON_NH_DAILY_INDEX',priceType:'CONFIRMED_REGULAR_CLOSE',
 value:5000+i*200,changePercent:0.5}));
const secondary=[
 ['다우존스','FRED_DJIA'],['SOX','FRED_NASDAQSOX'],
 ['VIX','CBOE_VIX_DAILY']
].map(([label,source],i)=>({label,date:us,source,role:'NON_NH_REFERENCE_ONLY',
 value:20+i*50,changePercent:0.3}));
const stocks=[
 ['SAMSUNG','삼성전자','005930.KS',date,180000,'NH_REGULAR_CLOSE'],
 ['SKHYNIX','SK하이닉스','000660.KS',date,200000,'NH_REGULAR_CLOSE'],
 ['NVDA','엔비디아','NVDA',us,240,'YAHOO_DAILY_REFERENCE'],
 ['MU','마이크론','MU',us,150,'YAHOO_DAILY_REFERENCE']
].map(([id,label,symbol,day,value,source])=>
 ({id,label,symbol,date:day,value,source,changePercent:0.4}));
const macros=[
 ['USDKRW','원/달러','KRW=X',1420],
 ['DXY','DXY','DX-Y.NYB',100],
 ['UST10Y','미 10년물','^TNX',4.4]
].map(([id,label,symbol,value])=>({
 id,label,symbol,value,date:us,source:'YAHOO_DAILY_REFERENCE',changePercent:0.2}));
const markets=[
 ['WTI','WTI','CL=F',73],['BRENT','Brent','BZ=F',76],
 ['GOLD','금','GC=F',4100],['COPPER','구리','HG=F',5]
].map(([id,label,symbol,value])=>({
 id,label,symbol,value,date:us,source:'YAHOO_DAILY_REFERENCE',changePercent:0.2}));
const rates=['UST2Y','UST3Y','UST10Y_FRED'].map((id,i)=>({
 id,label:id==='UST2Y'?'미 국채 2년':id==='UST3Y'?'미 국채 3년':'미 국채 10년',
 date:us,value:3.7+i/10,source:'FRED_H15_DAILY'
}));
const vk=[{id:'VKOSPI',label:'VKOSPI',date,value:25,
 source:'KRX_OFFICIAL',role:'NON_NH_REFERENCE_ONLY'}];
const turnover=['KOSPI','KOSDAQ'].map((market,i)=>({
 id:'KRX_TURNOVER_'+market,market,date,valueKrw:(20+i*4)*1e12,
 source:'KRX_OFFICIAL_INDEX_DAILY',role:'NON_NH_REFERENCE_ONLY'}));
const closingWithout=formatClose(date,nh,secondary,domestic,stocks,macros,
 markets,[],closeClock,rates,vk,null,null,turnover);
const closingWith=formatClose(date,nh,secondary,domestic,stocks,macros,
 markets,[],closeClock,rates,vk,null,financial,turnover);
assert.match(closingWith,/삼성전자·SK하이닉스 정량 지표/);
assert.match(closingWith,/참고 PBR 1\.50배/);
assert.match(closingWith,/검증 BPS 100,000원 \/ PBR 2\.00배/);
assert.match(closingWith,/■ 공시 재무 근거/);
assert.match(closingWith,/국내 DART BPS 2\/2/);
assert.ok(closingWith.length<=4000,'dense closing format cannot cancel 17:00 SEND');
assert.match(closingWith,/S&P 500: 7,000/);
assert.match(closingWith,/KOSPI: 5,000/);
assert.match(closingWith,/■ 데이터 확인: 핵심지수 6\/6/);
const liveFutures=[
 ['ES','S&P500 선물','ES=F',7200],['NQ','NASDAQ100 선물','NQ=F',26000],
 ['YM','다우 선물','YM=F',54000],['RTY','러셀2000 선물','RTY=F',2600]
].map(([id,label,symbol,value])=>({
 id,label,symbol,value,asOf:new Date(date+'T16:57:00+09:00').toISOString(),
 source:'YAHOO_DELAYED_FUTURES_REFERENCE'
}));
const sentiment={score:28.5,rating:'fear',weekAgo:41.5,
 observedAt:new Date(date+'T15:10:00+09:00').toISOString(),source:'CNN_FEAR_GREED'};
const stress=formatClose(date,nh,secondary,domestic,stocks,macros,
 markets,liveFutures,closeClock,rates,vk,sentiment,financial,turnover);
assert.match(stress,/확보 4\/4/);
assert.match(stress,/삼성전자·SK하이닉스 정량 지표/);
assert.match(stress,/참고 PBR 1\.50배/);
assert.match(stress,/PBR 2\.00배/);
assert.match(stress,/■ 공시 재무 근거/,'fully verified DART+SEC proof must survive 4 fresh futures');
assert.match(stress,/국내 DART BPS 2\/2/);
assert.match(stress,/기본 가격·미국 지수/);
assert.ok(stress.length<=4000,'full close with fresh futures must fit SEND payload');
console.log('BRIEFING_DENSE_FINANCIAL_PRIORITY_PASS morning='
 +morningWith.length+'/'+morningWithout.length
 +' close='+closingWith.length+'/'+closingWithout.length
 +' SEC9+DART2+concise_metrics=VERIFIED');