import assert from 'node:assert/strict';
import {CLOSE_MARKET_REFERENCES,expectedClosingMarketDate,
 validateClosingMarketReference,readClosingMarketReferences,formatClosingMarketReferences}
 from './closing-market-references.mjs';
import {summarizeCloseCoverage,CLOSE_SOURCE_CATALOG} from './briefing-source-coverage.mjs';
import {prepareClose,formatClose} from './telegram-close-workflow.mjs';
import {sanitizePreclose} from './telegram-close-precompute.mjs';

const date='2026-11-02',prev='2026-10-30',btcDate='2026-11-01';
assert.equal(expectedClosingMarketDate('WTI',date),prev);
assert.equal(expectedClosingMarketDate('BTC',date),btcDate,
 'BTC reference must be the most recent *completed UTC* candle at 17:00 KST');
assert.equal(expectedClosingMarketDate('BTC','2026-11-01'),null,'Korean nontrading day does not send closing briefing');
assert.equal(CLOSE_MARKET_REFERENCES.length,5);
const fixtures=CLOSE_MARKET_REFERENCES.map((item,i)=>({
 id:item.id,label:item.label,symbol:item.symbol,
 date:item.id==='BTC'?btcDate:prev,
 source:'Yahoo Finance 일봉',value:[68.5,70.4,2600.75,4.51,105000][i],
 changePercent:[0.6,-0.1,0.2,1.3,-2.5][i]
}));
const normalized=fixtures.map(x=>validateClosingMarketReference(date,x.id,x));
assert.equal(normalized.filter(Boolean).length,5);
assert.ok(normalized.every(x=>x.source==='YAHOO_DAILY_REFERENCE'));
assert.equal(validateClosingMarketReference(date,'BTC',{...fixtures[4],date}),null);
assert.equal(validateClosingMarketReference(date,'BTC',{...fixtures[4],date:prev}),null);
assert.equal(validateClosingMarketReference(date,'WTI',{...fixtures[0],date}),null);
assert.equal(validateClosingMarketReference(date,'WTI',{...fixtures[0],source:'UNVERIFIED_SNAPSHOT'}),null);
assert.equal(validateClosingMarketReference(date,'COPPER',{...fixtures[3],value:0}),null);
assert.equal(validateClosingMarketReference(date,'COPPER',{...fixtures[3],symbol:'HG=FX'}),null);
assert.equal(validateClosingMarketReference(date,'WTI',{...fixtures[0],changePercent:Infinity}),null);
assert.ok(!formatClosingMarketReferences(date,[]).includes('68.5'));
assert.match(formatClosingMarketReferences(date,normalized),/WTI: 68.5 USD\/bbl/);
assert.match(formatClosingMarketReferences(date,normalized),/구리: 4.51 USD\/lb/);
assert.match(formatClosingMarketReferences(date,normalized),/BTC: 105,000 USD.*2026-11-01 · UTC 일봉/);
assert.match(formatClosingMarketReferences(date,[]),/BTC: 검증된 완료 일봉 미확보/);
const counts=summarizeCloseCoverage(date,{markets:normalized,expectedUsDate:prev});
assert.deepEqual(counts.markets,{verified:5,total:5});
assert.equal(counts.core.verified,0,'commodity & BTC cannot authorize message without verified index');
assert.equal(CLOSE_SOURCE_CATALOG.notConnected.includes('BTC'),false);
assert.equal(CLOSE_SOURCE_CATALOG.notConnected.includes('VKOSPI'),false);
assert.equal(counts.volatility.verified,0);
assert.equal(counts.statuses.filter(x=>x.role==='OPTIONAL_MARKET').length,5);
assert.equal(summarizeCloseCoverage(date,{expectedUsDate:prev,
 markets:[{...normalized[4],date:prev}]}).markets.verified,0);
assert.equal(sanitizePreclose(date,{markets:normalized})?.markets.length,5);
assert.equal(sanitizePreclose(date,{markets:[{...normalized[0],date}]}).markets.length,0);

let attempts=[];
const read=await readClosingMarketReferences(date,{now:()=>new Date(date+'T17:02:00+09:00'),
 fetchDaily:async (label,symbol,session,{host})=>{
  attempts.push({label,symbol,host});
  const row=fixtures.find(x=>x.symbol===symbol);
  if(symbol==='CL=F'&&host==='query1.finance.yahoo.com')return {...row,date:'2026-10-29'};
  if(symbol==='BTC-USD'&&host==='query1.finance.yahoo.com')return {...row,date};
  return row;
 }});
assert.equal(read.length,5);
assert.equal(attempts.length,7,'fallback once only on failed date-verified sources');
assert.equal(attempts.filter(x=>x.host==='query2.finance.yahoo.com').length,2);
const partial=await readClosingMarketReferences(date,{fetchDaily:async()=>null});
assert.deepEqual(partial,[]);
const core=[{label:'S&P 500',symbol:'^GSPC',date:prev,value:7000,changePercent:0,
 source:'NH_INDEX_DAILY'}];
const opts={now:()=>new Date(date+'T17:05:00+09:00'),githubToken:'SYNTHETIC_TOKEN',
 repository:'cyyoung111-dev/portfolio',fetchImpl:async()=>({ok:true,
 json:async()=>({total_count:0,artifacts:[]})}),fetchNh:async()=>core,
 fetchDomestic:async()=>[],fetchSecondary:async()=>[],fetchStocks:async()=>[],
 fetchMacros:async()=>[],fetchMarkets:async()=>read};
const prepared=await prepareClose(opts);
assert.equal(prepared.ready,true);
assert.deepEqual(prepared.coverage.markets,{verified:5,total:5});
assert.match(prepared.message,/■ 원자재·BTC/);
assert.match(prepared.message,/원자재\/BTC 5\/5/);
assert.ok(prepared.message.length<4000,'Telegram payload under 4000 characters');
assert.match(formatClose(date,core,[],[],[],[],normalized),/BTC: 105,000/);
const blocked=await prepareClose({...opts,fetchNh:async()=>[]});
assert.equal(blocked.ready,false);
assert.equal(blocked.status,'NO_VERIFIED_INDEX_CLOSE');
assert.equal(blocked.coverage.markets.verified,5);
console.log('CLOSE_MARKET_REFERENCES_PASS 5/5 completed Yahoo daily, BTC UTC day verified, fallback & gate preserved');
