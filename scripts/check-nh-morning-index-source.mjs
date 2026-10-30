import assert from 'node:assert/strict';
import {readNhMorningIndexes} from './nh-morning-index-source.mjs';
import {collectMorningSeries,formatFullMorningBriefing} from './telegram-morning-report.mjs';
import {mergeMorningSourceRows,NH_ONLY_INDEX_SYMBOLS} from './telegram-morning-master.mjs';
import {runTelegramMorning} from './telegram-morning-briefing.mjs';

const day='2026-10-30',url='https://script.google.com/macros/s/EXAMPLE123456/exec';
const prices={SP500:['SPX',7720.39,7680.12],NASDAQ:['COMP',26184.72,26000],
 NASDAQ100:['NDX',29402.51,29300]};
function validPayload(){
 const series={},seriesMeta={};
 for(const [type,[code,last,previous]] of Object.entries(prices)){
  seriesMeta[type]={source:'NH_INDEX_DAILY',providerCode:code};
  series[type]=[
    {date:'2026-10-28',sourceDate:'2026-10-28',value:previous,source:'NH_INDEX_DAILY',
      status:'CONFIRMED',priceType:'REGULAR_CLOSE'},
    {date:'2026-10-29',sourceDate:'2026-10-29',value:last,source:'NH_INDEX_DAILY',
      status:'CONFIRMED',priceType:'REGULAR_CLOSE'}
  ];
 }
 return {status:'ok',series,seriesMeta};
}
let calls=0;
const fetchImpl=async(target,{body,method})=>{
 calls++;
 assert.equal(target,url);
 assert.equal(method,'POST');
 const query=new URLSearchParams(body);
 assert.equal(query.get('action'),'getBenchmarks');
 assert.equal(query.get('accessToken'),'TEST-GAS-ACCESS');
 assert.equal(query.get('benchmarks'),'SP500,NASDAQ,NASDAQ100');
 assert.equal(query.get('to'),'2026-10-29');
 assert.equal(query.get('fresh'),'0');
 assert.ok(!query.has('NHPLUG_APP_KEY')&&!query.has('NHPLUG_APP_SECRET'));
 return {ok:true,json:async()=>validPayload()};
};
const nh=await readNhMorningIndexes(day,{url,token:'TEST-GAS-ACCESS',fetchImpl});
assert.equal(calls,1,'one GAS request for three index series');
assert.equal(nh.length,3);
assert.deepEqual(nh.map(r=>r.symbol),['^GSPC','^IXIC','^NDX']);
assert.deepEqual(nh.map(r=>r.value),[7720.39,26184.72,29402.51]);
assert.ok(nh.every(r=>r.date==='2026-10-29'&&r.source==='NH_INDEX_DAILY'&&Number.isFinite(r.changePercent)));
let yahooCalls=0;
const yahoo=await collectMorningSeries(day,{
 skipSymbols:new Set(nh.map(x=>x.symbol)),
 fetchDaily:async(label,symbol)=>{yahooCalls++;return {label,symbol,date:'2026-10-29',value:1,changePercent:0,source:'Yahoo Finance 일봉'};}
});
assert.equal(yahooCalls,18);
assert.equal(yahoo.length,18);
const combined=mergeMorningSourceRows(yahoo,[],nh);
const text=formatFullMorningBriefing(day,null,combined);
assert.match(text,/S&P 500: 7,720.39.*NH PLUG 일봉/);
assert.match(text,/NASDAQ: 26,184.72.*NH PLUG 일봉/);
assert.match(text,/NASDAQ100: 29,402.51.*NH PLUG 일봉/);
const yy=[{label:'S&P 500',symbol:'^GSPC',date:'2026-10-29',value:7000,source:'Yahoo Finance 일봉'}];
assert.equal(mergeMorningSourceRows(yy,[],nh)[0].value,7720.39);

async function altered(change){
 return readNhMorningIndexes(day,{url,token:'TEST-GAS-ACCESS',
  fetchImpl:async()=>{const obj=validPayload();change(obj);return {ok:true,json:async()=>obj};}});
}
assert.equal((await altered(o=>{o.seriesMeta.SP500.providerCode='WRONG';})).length,2);
assert.equal((await altered(o=>{o.series.NASDAQ.pop();})).length,2);
assert.equal((await altered(o=>{o.series.NASDAQ100[1].source='YAHOO_FINANCE';})).length,2);
assert.equal((await altered(o=>{o.series.SP500[1].date='2026-10-28';})).length,2);
assert.equal((await altered(o=>{o.seriesMeta.NASDAQ.source='YAHOO_FINANCE';})).length,2);
assert.deepEqual(await readNhMorningIndexes(day,{url:'https://example.com/exec',
 token:'TEST-GAS-ACCESS',fetchImpl:async()=>{throw Error('UNEXPECTED_REQUEST');}}),[]);
assert.deepEqual(await readNhMorningIndexes(day,{url,token:'',fetchImpl:async()=>{throw Error('UNEXPECTED_REQUEST');}}),[]);
console.log('NH morning: centralized GAS, dated sources, three-series priority, skip duplicate Yahoo, spoof/stale fallback PASS');
