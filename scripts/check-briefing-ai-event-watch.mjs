import assert from 'node:assert/strict';
import {AI_EVENT_WATCH,selectAiEventHighlights,formatAiEventHighlights}
 from './briefing-ai-event-watch.mjs';
import {collectEarlyAiWatch,loadEarlyAiWatch} from './telegram-ai-watch-prefetch.mjs';
import {formatFullMorningBriefing} from './telegram-morning-report.mjs';

const date='2026-11-12',usDate='2026-11-11';
assert.equal(AI_EVENT_WATCH.length,25,'23 requested issuers + NVDA and AVGO');
assert.equal(new Set(AI_EVENT_WATCH.map(x=>x.symbol)).size,AI_EVENT_WATCH.length);
for(const symbol of ['MU','SKHY','TSM','SNDK','CRWV','IREN','MSFT','AMZN','GOOGL',
 'META','SPCX','AMD','INTC','ARM','QCOM','ANET','AAPL','TSLA','PLTR','BE',
 'GEV','ORCL','ASML','NVDA','AVGO'])
 assert.ok(AI_EVENT_WATCH.some(x=>x.symbol===symbol),symbol);
const make=(symbol,changePercent,session=usDate)=>{
 const item=AI_EVENT_WATCH.find(x=>x.symbol===symbol);
 return {symbol,label:item.label,date:session,value:120,changePercent,unit:'USD',
  source:'YAHOO_DAILY_REFERENCE'};
};
const prices=[
 make('MU',12),make('SKHY',9),make('CRWV',12),make('MSFT',5),
 make('TSM',3),make('NVDA',2),make('ASML',5),make('META',1),
 make('SNDK',9,'2026-11-10')
];
const events=selectAiEventHighlights({expectedUsDate:usDate,prices,marketChangePercent:2});
assert.equal(events.length,3);
assert.ok(events.some(x=>x.symbol==='MU'));
assert.ok(!events.some(x=>x.symbol==='TSM'));
assert.ok(!events.some(x=>x.symbol==='SNDK'));
assert.equal(new Set(events.map(x=>x.sector)).size,3);
const output=formatAiEventHighlights({expectedUsDate:usDate,events});
assert.ok(output.join('\n').includes('미국 정규장'));
assert.ok(output.join('\n').includes('별도 확인'));
assert.ok(output.join('\n').includes('나스닥100 대비'));
assert.deepEqual(formatAiEventHighlights({expectedUsDate:usDate,events:[]}),[]);
assert.deepEqual(selectAiEventHighlights({expectedUsDate:usDate,prices:[
 make('MU',40,'2026-11-10'),make('MU',50,'2026-11-10')]}),[]);
assert.deepEqual(selectAiEventHighlights({expectedUsDate:usDate,prices:[
 make('MU',30),make('MU',30)]}),[],'duplicate daily quote is ambiguous');
const nowEarly=()=>new Date('2026-11-12T07:24:00+09:00');
let content='',calls=0;
const mockDaily=async(label,symbol)=>{
 calls++;
 const item=AI_EVENT_WATCH.find(x=>x.label===label&&x.symbol===symbol);
 return item?{label,symbol,date:usDate,value:100,
  changePercent:symbol==='MU'?13:symbol==='CRWV'?12:1,
  source:'Yahoo Finance 일봉'}:null;
};
const early=await collectEarlyAiWatch({now:nowEarly,fetchDaily:mockDaily,
 fetchImpl:async()=>{throw Error('unused');},mkdir:()=>{},
 writeFile:(_path,value)=>{content=value;}});
assert.equal(early.status,'WATCH_VERIFIED_OPTIONAL');
assert.equal(early.verified,25);
assert.equal(calls,25);
const loaded=loadEarlyAiWatch(date,{now:()=>new Date('2026-11-12T07:44:00+09:00'),
 readFile:()=>content});
assert.equal(loaded.expectedUsDate,usDate);
assert.ok(loaded.events.some(x=>x.symbol==='MU'));
assert.equal(loadEarlyAiWatch(date,{now:nowEarly,readFile:()=>content}),null);
assert.equal(loadEarlyAiWatch(date,{now:()=>new Date('2026-11-12T07:44:00+09:00'),
 readFile:()=>content.replace('2026-11-11','2026-11-10')}),null);
const skipped=await collectEarlyAiWatch({now:()=>new Date('2026-11-12T07:39:00+09:00'),
 fetchDaily:async()=>{throw Error('not allowed');}});
assert.equal(skipped.status,'WATCH_WINDOW_SKIPPED');
const rows=[
 {label:'S&P 500',symbol:'^GSPC',date:usDate,value:7600,changePercent:1.2},
 {label:'NASDAQ100',symbol:'^NDX',date:usDate,value:28000,
  changePercent:2.2,source:'NH_INDEX_DAILY'},
 {label:'SOX',symbol:'^SOX',date:usDate,value:10000,changePercent:4.2},
 {label:'VIX',symbol:'^VIX',date:usDate,value:18,changePercent:-2.0}
];
const message=formatFullMorningBriefing(date,null,rows,{
 now:new Date('2026-11-12T07:44:00+09:00'),watchEvidence:loaded});
assert.match(message,/AI 밸류체인 주요 변동/);
assert.match(message,/마이크론 \(MU\)/);
assert.match(message,/나스닥100 대비/);
assert.ok(message.length<=3900);
const noWatch=formatFullMorningBriefing(date,null,rows,{now:new Date('2026-11-12T07:44:00+09:00')});
assert.doesNotMatch(noWatch,/AI 밸류체인 주요 변동/);
console.log('AI event watch selection, provenance, optional prefetch and rendering: PASS');
