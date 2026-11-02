import assert from 'node:assert/strict';
import {FUTURES,validateCurrentFuturesQuote,readCurrentFutures,formatCurrentFutures}
 from './closing-current-futures.mjs';
import {formatClose,prepareClose} from './telegram-close-workflow.mjs';

const date='2026-11-02', instant=new Date('2026-11-02T17:00:00+09:00');
const ts=Math.floor(new Date('2026-11-02T16:52:00+09:00').getTime()/1000);
const chart=(symbol,timestamp=ts,close=28000)=>({chart:{error:null,result:[{
 meta:{symbol,exchangeTimezoneName:'America/New_York'},timestamp:[timestamp],
 indicators:{quote:[{close:[close]}]}}]}});
const quote=validateCurrentFuturesQuote(date,'NQ',chart('NQ=F'),instant);
assert.deepEqual(quote,{id:'NQ',label:'NASDAQ100 선물',symbol:'NQ=F',value:28000,
 asOf:new Date(ts*1000).toISOString(),source:'YAHOO_DELAYED_FUTURES_REFERENCE'});
assert.equal(validateCurrentFuturesQuote(date,'NQ',chart('NQ=F',ts-26*60),instant),null);
assert.equal(validateCurrentFuturesQuote(date,'NQ',chart('NQ=F',ts+10*60),instant),null);
assert.equal(validateCurrentFuturesQuote(date,'NQ',chart('ES=F'),instant),null);
assert.equal(validateCurrentFuturesQuote(date,'NQ',chart('NQ=F',ts,0),instant),null);
assert.equal(validateCurrentFuturesQuote(date,'NQ',chart('NQ=F',ts,NaN),instant),null);
assert.equal(validateCurrentFuturesQuote(date,'NQ',chart('NQ=F'),new Date('2026-11-02T16:50:00+09:00')),null);
assert.equal(validateCurrentFuturesQuote(date,'NQ',chart('NQ=F'),new Date('2026-11-02T17:30:00+09:00')),null);
assert.equal(validateCurrentFuturesQuote(date,'NQ',chart('NQ=F'),new Date('2026-11-03T17:00:00+09:00')),null);
assert.equal(validateCurrentFuturesQuote(date,'NQ',
 {chart:{error:null,result:[{...chart('NQ=F').chart.result[0],
   timestamp:[ts,ts],indicators:{quote:[{close:[22000,22001]}]}}]}},instant)?.value,22001);
assert.equal(validateCurrentFuturesQuote(date,'NQ',
 {chart:{error:null,result:[chart('NQ=F').chart.result[0],chart('NQ=F').chart.result[0]]}},instant),null);

let calls=[];
const data=await readCurrentFutures(date,{now:()=>instant,fetchImpl:async(url,init)=>{
 calls.push(url);
 assert.equal(new URL(url).hostname,'query1.finance.yahoo.com');
 assert.equal(new URL(url).searchParams.get('interval'),'5m');
 assert.equal(new URL(url).searchParams.get('range'),'1d');
 assert.equal(init.redirect,'error');
 const sym=decodeURIComponent(new URL(url).pathname.split('/').at(-1));
 return {ok:true,json:async()=>chart(sym,ts,FUTURES.findIndex(x=>x.symbol===sym)+25000)};
}});
assert.equal(calls.length,4);
assert.equal(data.length,4);
assert.deepEqual(data.map(x=>x.id),['ES','NQ','YM','RTY']);
const formatted=formatCurrentFutures(date,data,instant);
assert.match(formatted,/NASDAQ100 선물: 25,001pt \[16:52 KST · Yahoo 지연 참고\]/);
assert.match(formatted,/확보 4\/4/);
assert.doesNotMatch(formatted,/현물지수: 25,001|확정 종가|등락률/);
const stale=formatCurrentFutures(date,data,new Date('2026-11-02T17:29:00+09:00'));
assert.match(stale,/유효한 최근 거래값 미확보/);
assert.match(stale,/확보 0\/4/);
const dup=formatCurrentFutures(date,[data[0],data[0]],instant);
assert.match(dup,/확보 0\/4/);
const empty=await readCurrentFutures(date,{now:()=>instant,fetchImpl:async()=>({ok:false})});
assert.deepEqual(empty,[]);
assert.deepEqual(await readCurrentFutures(date,{now:()=>new Date('2026-11-02T16:55:00+09:00'),
 fetchImpl:async()=>{throw Error('network called before 17:00')}}),[]);

const nh=[
 {label:'S&P 500',symbol:'^GSPC',source:'NH_INDEX_DAILY',date:'2026-10-30',value:7580.07,changePercent:-1.82},
 {label:'NASDAQ',symbol:'^IXIC',source:'NH_INDEX_DAILY',date:'2026-10-30',value:25437,changePercent:-2.86},
 {label:'NASDAQ100',symbol:'^NDX',source:'NH_INDEX_DAILY',date:'2026-10-30',value:28384.85,changePercent:-3.46}
];
const preview=formatClose(date,nh,[],[],[],[],[],data);
assert.ok(preview.indexOf('미국 지수선물')<preview.indexOf('미국 현물시장'));
assert.match(preview,/미국 현물시장 \(직전 완료장\)/);
assert.match(preview,/NASDAQ100: 28,384.85.*\[2026-10-30\]/);
assert.match(preview,/NASDAQ100 선물: 25,001pt/);
assert.ok(preview.length<4000,'Telegram limit unchanged');
const delayedAt=new Date('2026-11-02T17:08:00+09:00');
const delayedPreview=formatClose(date,nh,[],[],[],[],[],data,delayedAt);
assert.match(delayedPreview,/NASDAQ100 선물: 25,001pt/,'format uses actual send time, not a hard-coded 17:00');
const tooLatePreview=formatClose(date,nh,[],[],[],[],[],data,new Date('2026-11-02T17:29:00+09:00'));
assert.match(tooLatePreview,/유효한 최근 거래값 미확보/,'stale quote must not become current');
let requested=0;
const prepared=await prepareClose({now:()=>instant,githubToken:'dummy',repository:'cyyoung111-dev/portfolio',
 fetchImpl:async()=>({ok:true,json:async()=>({total_count:0,artifacts:[]})}),
 fetchNh:async()=>nh,fetchDomestic:async()=>[],fetchSecondary:async()=>[],
 fetchStocks:async()=>[],fetchMacros:async()=>[],fetchMarkets:async()=>[],
 fetchFutures:async()=>{requested++;return data;}});
assert.equal(requested,1);
assert.equal(prepared.ready,true);
assert.equal(prepared.futuresCount,4);
assert.match(prepared.message,/NASDAQ100 선물: 25,001pt/);
const fail=await prepareClose({now:()=>instant,githubToken:'dummy',repository:'cyyoung111-dev/portfolio',
 fetchImpl:async()=>({ok:true,json:async()=>({total_count:0,artifacts:[]})}),
 fetchNh:async()=>nh,fetchDomestic:async()=>[],fetchSecondary:async()=>[],
 fetchStocks:async()=>[],fetchMacros:async()=>[],fetchMarkets:async()=>[],
 fetchFutures:async()=>{throw Error('BROKEN_PROVIDER');}});
assert.equal(fail.ready,true,'futures source never blocks verified daily-index delivery');
assert.equal(fail.futuresCount,0);
assert.match(fail.message,/유효한 최근 거래값 미확보/);
console.log('CLOSE_US_FUTURES_FRESH_QUOTE_PASS 4 symbols, fresh/stale/date/source, nonblocking');
