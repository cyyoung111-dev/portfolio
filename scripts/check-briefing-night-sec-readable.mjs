import assert from 'node:assert/strict';
import {verifiedK200NightChange,formatK200NightChange}
 from './briefing-k200-night-change.mjs';
import {secCikMap,parseSecRecentFiling,verifiedSecFiling,addOfficialSecFilings}
 from './briefing-ai-official-sec-events.mjs';
import {formatFullMorningBriefing} from './telegram-morning-report.mjs';
import {formatAiEventHighlights} from './briefing-ai-event-watch.mjs';

const date='2026-11-12',prior='2026-11-11';
const ref={source:'NH',kind:'REFERENCE',tradingDate:date,
 officialClose:false,contract:'KA0161200',contractMonth:'2026-12',
 sourceUpdatedAt:date+'T06:00:00+09:00',value:852.95};
const baseline={source:'KRX_OFFICIAL',status:'FINAL',priceType:'SETTLEMENT',
 market:'KRX',session:'DAY',instrument:'KOSPI200_FUTURE',
 contract:'KA0161200',contractMonth:'2026-12',tradingDate:prior,value:836.55};
const diff=verifiedK200NightChange(ref,baseline,{date});
assert.equal(diff.points,16.4);
assert.ok(Math.abs(diff.percent-16.4/836.55*100)<1e-9);
assert.match(formatK200NightChange(diff),/\+16\.40pt/);
assert.match(formatK200NightChange(diff),/KRX/);
for(const bad of [
 {source:'NH'}, // wrong settlement source
 {contract:'KA0161300'},
 {priceType:'LAST_TRADE'},
 {session:'NIGHT'},
 {market:'CME'},
 {contractMonth:'2027-03'},
 {tradingDate:date},
 {value:0}
]){
 assert.equal(verifiedK200NightChange(ref,{...baseline,...bad},{date}),null);
}
assert.equal(verifiedK200NightChange(ref,{...baseline,tradingDate:'2026-11-09'},{date}),null);
assert.equal(verifiedK200NightChange({...ref,officialClose:true},baseline,{date}),null);
assert.equal(formatK200NightChange(null),null);

const cik='0000723125';
const map=secCikMap({0:{ticker:'MU',cik_str:723125,title:'Micron'},
 1:{ticker:'NVDA',cik_str:1045810,title:'NVIDIA'}},['MU','NVDA']);
assert.equal(map.MU,cik);
assert.equal(map.NVDA,'0001045810');
const recent={cik:723125,filings:{recent:{
 form:['8-K','10-Q','8-K'],
 filingDate:[prior,'2026-11-09','2026-10-12'],
 accessionNumber:['0000723125-26-012345','0000723125-26-012344','0000723125-26-012343']
}}};
const filing=parseSecRecentFiling(recent,{symbol:'MU',cik,usDate:prior});
assert.equal(filing.form,'8-K');
assert.equal(filing.filed,prior);
assert.equal(filing.source,'SEC_EDGAR_SUBMISSIONS');
assert.ok(verifiedSecFiling(filing,{symbol:'MU',usDate:prior}));
assert.equal(verifiedSecFiling(filing,{symbol:'NVDA',usDate:prior}),null);
assert.equal(parseSecRecentFiling({...recent,cik:1045810},{symbol:'MU',cik,usDate:prior}),null);
assert.equal(parseSecRecentFiling({
 cik:723125,filings:{recent:{form:['8-K'],filingDate:['2026-11-12'],
 accessionNumber:['0000723125-26-012345']}}
},{symbol:'MU',cik,usDate:prior}),null);
assert.equal(parseSecRecentFiling(recent,{symbol:'MU',cik:'0000000000',usDate:prior}),null);
const movers=[{symbol:'MU',label:'마이크론',sector:'MEMORY',
 tier:'large',date:prior,value:123.45,changePercent:12.3,
 source:'YAHOO_DAILY_REFERENCE'}];
const fetchImpl=async (url)=>{
 if(url==='https://www.sec.gov/files/company_tickers.json')
  return {ok:true,json:async()=>({0:{ticker:'MU',cik_str:723125,title:'Micron'}})};
 if(url==='https://data.sec.gov/submissions/CIK0000723125.json')
  return {ok:true,json:async()=>recent};
 throw Error('Unexpected SEC endpoint '+url);
};
const enriched=await addOfficialSecFilings(movers,{
 usDate:prior,fetchImpl,userAgent:'Portfolio research research@example.com'});
assert.equal(enriched.length,1);
assert.equal(enriched[0].filing.form,'8-K');
const display=formatAiEventHighlights({expectedUsDate:prior,events:enriched}).join('\n');
assert.match(display,/SEC 8-K 공시/);
assert.match(display,/별도 확인 전 단정/);
assert.deepEqual(await addOfficialSecFilings(movers,{
 usDate:prior,fetchImpl,userAgent:''}),movers);
assert.deepEqual(await addOfficialSecFilings(movers,{
 usDate:prior,fetchImpl:async()=>({ok:false}),
 userAgent:'Portfolio research research@example.com'}),movers);

const rows=[
 {symbol:'^GSPC',label:'S&P 500',date:prior,value:7600,changePercent:1.0,
  source:'NH_INDEX_DAILY'},
 {symbol:'^DJI',label:'다우존스',date:prior,value:51000,changePercent:0.4},
 {symbol:'^NDX',label:'NASDAQ100',date:prior,value:28000,changePercent:2,
  source:'NH_INDEX_DAILY'},
 {symbol:'^KS11',label:'KOSPI',date:prior,value:5000,changePercent:1.1}
];
const message=formatFullMorningBriefing(date,ref,rows,{
 now:new Date('2026-11-12T07:44:00+09:00'),nightBaseline:baseline});
assert.ok(message.indexOf('■ 2. 밤사이 미국장')<message.indexOf('■ 3. 전일 한국장'));
assert.ok(message.indexOf('S&P 500:')<message.indexOf('KOSPI:'));
assert.match(message,/전일 동일 월물 정산가 836\.55pt/);
assert.match(message,/\+16\.40pt/);
const noBaseline=formatFullMorningBriefing(date,ref,rows);
assert.doesNotMatch(noBaseline,/전일 동일 월물 정산가/);
assert.ok(message.length<=3900);
console.log('AI official filings, K200 settlement difference, briefing order: PASS');
