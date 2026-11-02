import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
 closingStockSessions,normalizeClosingNhStocks,readNhClosingStocks,describeClosingNhStockRead,
 validateClosingMacro,readClosingMacros,formatClosingExtra
} from './closing-extra-daily-sources.mjs';
import {summarizeCloseCoverage} from './briefing-source-coverage.mjs';
import {prepareClose} from './telegram-close-workflow.mjs';

const date='2026-11-02',us='2026-10-30';
assert.deepEqual(closingStockSessions(date),{
 day:date,us,priorKr:'2026-10-30',priorUs:'2026-10-29'
});
assert.equal(closingStockSessions('2026-11-01'),null);
const payload={status:'ok',prices:{
 '005930':[{date:'2026-10-30',price:72000,source:'NH_REGULAR_CLOSE'},
            {date,price:73500,source:'NH_REGULAR_CLOSE'}],
 '000660':[{date:'2026-10-30',price:180000,source:'NH_REGULAR_CLOSE'},
            {date,price:179000,source:'NH_REGULAR_CLOSE'}],
 NVDA:[{date:'2026-10-29',price:210,source:'NH_REGULAR_CLOSE'},
       {date:us,price:215,source:'NH_REGULAR_CLOSE'},
       {date,price:999,source:'NH_REGULAR_CLOSE'}],
 MU:[{date:'2026-10-29',price:100,source:'NH_REGULAR_CLOSE'},
     {date:us,price:105,source:'NH_REGULAR_CLOSE'}]
}};
const audit=describeClosingNhStockRead(date,payload);
assert.deepEqual(audit,{status:'GAS_RESPONSE_OK',stocks:[
 {id:'SAMSUNG',status:'VERIFIED'},{id:'SKHYNIX',status:'VERIFIED'},
 {id:'NVDA',status:'VERIFIED'},{id:'MU',status:'VERIFIED'}
]});
assert.equal(describeClosingNhStockRead(date,{status:'error',message:'인증 실패'}).status,'GAS_AUTH_REJECTED');
assert.equal(describeClosingNhStockRead(date,{status:'ok'}).status,'PRICE_RESPONSE_SCHEMA');
const missing=structuredClone(payload);
delete missing.prices.MU;
missing.prices['005930']=[{date,price:1,source:'KRX_CARRY'}];
missing.prices['000660']=[{date:'2026-10-30',price:1,source:'NH_REGULAR_CLOSE'}];
missing.prices.NVDA.push({date:us,price:1,source:'NH_REGULAR_CLOSE'});
assert.deepEqual(describeClosingNhStockRead(date,missing).stocks.map(x=>x.status),[
 'SOURCE_NOT_NH','EXPECTED_DATE_MISSING','DUPLICATE_DATE','CODE_NOT_RETURNED']);
assert.ok(!JSON.stringify(describeClosingNhStockRead(date,missing)).includes('72000'));
const stocks=normalizeClosingNhStocks(date,payload);
assert.equal(stocks.length,4);
assert.deepEqual(stocks.map(x=>x.date),[date,date,us,us],
 'same-day domestic, preceding completed US session');
assert.equal(stocks[0].source,'NH_REGULAR_CLOSE');
assert.equal(stocks[2].value,215,'never accept unfinished US same-day close at 17:00 KST');
assert.equal(stocks[0].changePercent,(73500/72000-1)*100);
const bad={...payload,prices:{...payload.prices,NVDA:[
 ...payload.prices.NVDA,{date:us,price:240,source:'NH_REGULAR_CLOSE'}]}};
assert.equal(normalizeClosingNhStocks(date,bad).some(x=>x.id==='NVDA'),false);
assert.equal(normalizeClosingNhStocks(date,{...payload,prices:{...payload.prices,
 '005930':[{date,price:73500,source:'KRX_CARRY'}]}}).some(x=>x.id==='SAMSUNG'),false);
assert.equal(normalizeClosingNhStocks(date,{...payload,prices:{...payload.prices,
 MU:[{date:us,price:105,source:'NH_REGULAR_CLOSE'}]}}).find(x=>x.id==='MU').changePercent,null);
assert.equal(normalizeClosingNhStocks(date,{status:'error',prices:payload.prices}).length,0);

let stockCalls=0;
const recordedAudit=[];
const saved=await readNhClosingStocks(date,{
 onDiagnostic:value=>recordedAudit.push(value),
 url:'https://script.google.com/macros/s/EXAMPLE123/exec',token:'TEST_ACCESS_TOKEN_WITH_LENGTH',
 fetchImpl:async (url,request)=>{
  stockCalls++;
  assert.match(url,/^https:\/\/script\.google\.com\/macros\/s\//);
  assert.equal(request.method,'POST');
  assert.equal(request.body.get('action'),'getPriceHistory');
  assert.equal(request.body.get('codes'),'005930,000660,NVDA,MU');
  assert.equal(request.body.get('to'),date);
  assert.ok(request.body.get('from')<us);
  return {ok:true,json:async()=>payload};
 }
});
assert.deepEqual(recordedAudit,[audit],'source diagnostics log only allowed fixed enums');
// A 17-second tail was observed as a silent 0/4 on a real production probe.
const timeoutAudit=[];
const timeoutRows=await readNhClosingStocks(date,{
 url:'https://script.google.com/macros/s/EXAMPLE123/exec',token:'TEST_ACCESS_TOKEN_WITH_LENGTH',
 fetchImpl:async()=>{const e=new Error('PRIVATE_URL_TOKEN_SHOULD_NOT_LEAK');e.name='TimeoutError';throw e;},
 onDiagnostic:diagnostic=>timeoutAudit.push(diagnostic)
});
assert.deepEqual(timeoutRows,[]);
assert.deepEqual(timeoutAudit,[{status:'GAS_TIMEOUT_30S'}],
 'timeout must be distinguishable without raw private error text');
assert.ok(!JSON.stringify(timeoutAudit).includes('PRIVATE_URL_TOKEN'));
const networkAudit=[];
await readNhClosingStocks(date,{
 url:'https://script.google.com/macros/s/EXAMPLE123/exec',token:'TEST_ACCESS_TOKEN_WITH_LENGTH',
 fetchImpl:async()=>{throw Error('PRIVATE_NETWORK_DETAILS');},
 onDiagnostic:diagnostic=>networkAudit.push(diagnostic)
});
assert.deepEqual(networkAudit,[{status:'GAS_FETCH_FAILED'}],
 'network/redirect failures are not mislabeled as timeout');
const protectedSource=fs.readFileSync('scripts/closing-extra-daily-sources.mjs','utf8');
assert.match(protectedSource,/AbortSignal\\.timeout\\(30000\\)/,
 'exactly one bounded 30-second GAS read and no automatic retry');

assert.equal(stockCalls,1,'one read-only stored NH history batch');
assert.equal(saved.length,4);
assert.deepEqual(await readNhClosingStocks(date,{url:'http://evil.net/exec',
 token:'TEST_ACCESS_TOKEN_WITH_LENGTH',fetchImpl:()=>assert.fail('unsafe host')}),[]);
const macrosPayload={
 USDKRW:{label:'원/달러',symbol:'KRW=X',date:us,value:1445.12,changePercent:0.12,source:'Yahoo Finance 일봉'},
 DXY:{label:'DXY',symbol:'DX-Y.NYB',date:us,value:104.5,changePercent:-0.4,source:'Yahoo Finance 일봉'},
 UST10Y:{label:'미 10년물',symbol:'^TNX',date:us,value:4.929,changePercent:0.8,source:'Yahoo Finance 일봉'}
};
for(const [id,row] of Object.entries(macrosPayload))assert.equal(validateClosingMacro(date,id,row)?.id,id);
assert.equal(validateClosingMacro(date,'UST10Y',{...macrosPayload.UST10Y,value:49.29}),null,
 'never silently change percent yield units by factor ten');
assert.equal(validateClosingMacro(date,'USDKRW',{...macrosPayload.USDKRW,date}),null,
 'never promote partially complete trading day to final close');
assert.equal(validateClosingMacro(date,'DXY',{...macrosPayload.DXY,source:'UNKNOWN'}),null);
assert.equal(validateClosingMacro(date,'USDKRW',{...macrosPayload.USDKRW,value:0}),null);
let attempts=[];
const macros=await readClosingMacros(date,{
 now:()=>new Date(date+'T17:05:00+09:00'),
 fetchDaily:async(label,symbol,d,{host})=>{
  attempts.push({label,symbol,host,d});
  const id=symbol==='KRW=X'?'USDKRW':symbol==='^TNX'?'UST10Y':'DXY';
  // Primary Yahoo host stale for DXY, query2 dated fallback proves recovery.
  if(id==='DXY'&&host==='query1.finance.yahoo.com')return {...macrosPayload.DXY,date:'2026-10-29'};
  return macrosPayload[id];
 }
});
assert.equal(macros.length,3);assert.equal(attempts.length,4);
assert.ok(attempts.some(x=>x.host==='query2.finance.yahoo.com'));
assert.match(formatClosingExtra(date,stocks,macros),/삼성전자: 73,500 원.*\[2026-11-02\]/);
assert.match(formatClosingExtra(date,stocks,macros),/엔비디아: 215 USD.*\[2026-10-30\]/);
assert.match(formatClosingExtra(date,stocks,macros),/미 10년물: 4.929%.*2026-10-30/);
assert.doesNotMatch(formatClosingExtra(date,[],[]),/73,500|1445.12/);
const coverage=summarizeCloseCoverage(date,{stocks,macros,expectedUsDate:us});
assert.deepEqual(coverage.stocks,{verified:4,total:4});
assert.deepEqual(coverage.macros,{verified:3,total:3});
assert.equal(coverage.core.verified,0,'optional stock/FX cannot authorize a market briefing');
const falselyLabeled=summarizeCloseCoverage(date,{expectedUsDate:us,
 stocks:[{...stocks[0],label:'UNVERIFIED_STOCK'}],
 macros:[{...macros[2],value:49.29}]});
assert.equal(falselyLabeled.stocks.verified,0);
assert.equal(falselyLabeled.macros.verified,0,
 'out-of-range yield must not be marked verified by coverage even if a row is injected');
for(const id of [...['SAMSUNG','SKHYNIX','NVDA','MU','USDKRW','DXY','UST10Y']])
 assert.equal(coverage.statuses.find(x=>x.id===id).status,'VERIFIED');
const previous=summarizeCloseCoverage(date,{expectedUsDate:us});
assert.equal(previous.statuses.find(x=>x.id==='NVDA').status,'NO_VERIFIED_ROW');

const prepared=await prepareClose({
 now:()=>new Date(date+'T17:05:00+09:00'),githubToken:'GITHUB_SYNTHETIC_TOKEN',
 repository:'cyyoung111-dev/portfolio',
 fetchImpl:async()=>({ok:true,json:async()=>({total_count:0,artifacts:[]})}),
 fetchNh:async()=>[{label:'S&P 500',symbol:'^GSPC',date:us,value:7720.39,
   changePercent:0.5,source:'NH_INDEX_DAILY'}],
 fetchDomestic:async()=>[],fetchSecondary:async()=>[],
 fetchStocks:async()=>stocks,fetchMacros:async()=>macros
});
assert.equal(prepared.ready,true);
assert.equal(prepared.coverage.stocks.verified,4);
assert.equal(prepared.coverage.macros.verified,3);
assert.match(prepared.message,/■ 주요 종목/);
assert.match(prepared.message,/■ 환율·금리/);
assert.ok(prepared.message.length<4000);
const noCore=await prepareClose({
 now:()=>new Date(date+'T17:05:00+09:00'),githubToken:'GITHUB_SYNTHETIC_TOKEN',
 repository:'cyyoung111-dev/portfolio',
 fetchImpl:async()=>({ok:true,json:async()=>({total_count:0,artifacts:[]})}),
 fetchNh:async()=>[],fetchDomestic:async()=>[],fetchSecondary:async()=>[],
 fetchStocks:async()=>stocks,fetchMacros:async()=>macros
});
assert.equal(noCore.ready,false,'optional extra data do not bypass existing core index safety gate');
assert.equal(noCore.coverage.stocks.verified,4);
assert.equal(noCore.status,'NO_VERIFIED_INDEX_CLOSE');
assert.match(fs.readFileSync('scripts/telegram-close-workflow.mjs','utf8'),/NH_CLOSE_STOCK_READ/);
assert.match(fs.readFileSync('scripts/telegram-close-precompute.mjs','utf8'),/NH_PRECLOSE_STOCK_READ/);
const source=fs.readFileSync('scripts/closing-extra-daily-sources.mjs','utf8');
assert.doesNotMatch(source,/bootstrapNhToken|savePriceHistory|saveSnapshot|sendTelegram/);
console.log('CLOSING_EXTRA_DAILY_SOURCES_PASS stock=4 macro=3 NH_READONLY_BATCH=1');
