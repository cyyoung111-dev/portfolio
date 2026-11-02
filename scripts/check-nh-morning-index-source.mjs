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
assert.deepEqual(NH_ONLY_INDEX_SYMBOLS,['^GSPC','^IXIC','^NDX']);
assert.deepEqual(mergeMorningSourceRows(yy,[],[]),[],
 'NH missing must not silently fall back to Yahoo for the same index');
assert.deepEqual(mergeMorningSourceRows([],[
 {label:'NASDAQ',symbol:'^IXIC',date:'2026-10-29',value:26000,source:'MARKET_MASTER'}
],[]),[],'unverified market master cannot override missing NH');
let sentMessage='',requestedYahoo=[];
const outage=await runTelegramMorning({
 now:()=>new Date('2026-10-30T07:45:00+09:00'),event:'schedule',attempt:1,
 token:'test',chatId:'test',referenceFetch:async()=>null,
 fetchImpl:async target=>{
  const requestUrl=String(target);
  if(requestUrl.includes('/v8/finance/chart/'))
   requestedYahoo.push(decodeURIComponent(new URL(requestUrl).pathname.split('/').at(-1)));
  return {ok:false};
 },
 send:async(_token,_chat,text)=>{sentMessage=text;}
});
assert.equal(outage.status,'SENT_SOURCE_MISSING');
assert.equal(new Set(requestedYahoo).size,15,'15 Yahoo-eligible series; NH and three domestic indices remain excluded');
assert.ok(requestedYahoo.length<=30,'one primary and at most one backup per Yahoo-eligible series');
assert.ok([...new Set(requestedYahoo)].every(symbol=>
 requestedYahoo.filter(x=>x===symbol).length<=2),'per-series bounded Yahoo retry');
assert.ok(NH_ONLY_INDEX_SYMBOLS.every(symbol=>!requestedYahoo.includes(symbol)),
 'the three NH operating indices are never queried via Yahoo when NH is missing');
assert.match(sentMessage,/S&P 500: 미확보/);
assert.match(sentMessage,/NASDAQ: 미확보/);
assert.match(sentMessage,/NASDAQ100: 미확보/);

// End-to-end morning path: stored NH closes must bypass Yahoo stock queries,
// while their source is visibly labeled (no live NH OAuth or financial writes).
const priorUrl=process.env.GAS_WEB_APP_URL,priorToken=process.env.GAS_ACCESS_TOKEN;
process.env.GAS_WEB_APP_URL=url;
process.env.GAS_ACCESS_TOKEN='TEST-GAS-ACCESS';
let actualText='',yahooTargets=[],historyCalls=0;
try{
 const result=await runTelegramMorning({
  now:()=>new Date('2026-10-30T07:45:00+09:00'),event:'schedule',attempt:1,
  referenceFetch:async()=>null,token:'test',chatId:'test',
  fetchImpl:async(target,options={})=>{
   const targetUrl=String(target);
   if(targetUrl===url){
     const action=new URLSearchParams(options.body).get('action');
     if(action==='getBenchmarks')return {ok:true,json:async()=>validPayload()};
     if(action==='getMarketBriefingMaster')return {ok:true,json:async()=>({status:'ok',observations:[]})};
     if(action==='getPriceHistory'){
       historyCalls++;
       return {ok:true,json:async()=>({status:'ok',prices:{
        '005930':[{date:'2026-10-29',price:120,source:'NH_REGULAR_CLOSE'}],
        '000660':[{date:'2026-10-29',price:220,source:'NH_REGULAR_CLOSE'}],
        NVDA:[{date:'2026-10-29',price:210,source:'NH_REGULAR_CLOSE'}],
        MU:[{date:'2026-10-29',price:180,source:'NH_REGULAR_CLOSE'}]}})};
     }
     throw Error('unexpected GAS action');
   }
   if(targetUrl.includes('/v8/finance/chart/'))
     yahooTargets.push(decodeURIComponent(new URL(targetUrl).pathname.split('/').at(-1)));
   return {ok:false};
  },
  send:async(_token,_chat,message)=>{actualText=message;}
 });
 assert.equal(result.status,'SENT_SOURCE_MISSING');
 assert.equal(historyCalls,1,'one stored NH history batch');
 for(const s of ['005930.KS','000660.KS','NVDA','MU'])
   assert.ok(!yahooTargets.includes(s),'valid NH close skips duplicate Yahoo '+s);
 assert.match(actualText,/삼성전자: 120 .*NH PLUG 확정 종가/);
 assert.match(actualText,/SK하이닉스: 220 .*NH PLUG 확정 종가/);
 assert.match(actualText,/엔비디아: 210 .*NH PLUG 확정 종가/);
 assert.match(actualText,/마이크론: 180 .*NH PLUG 확정 종가/);
}finally{
 if(priorUrl===undefined)delete process.env.GAS_WEB_APP_URL;
 else process.env.GAS_WEB_APP_URL=priorUrl;
 if(priorToken===undefined)delete process.env.GAS_ACCESS_TOKEN;
 else process.env.GAS_ACCESS_TOKEN=priorToken;
}
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
