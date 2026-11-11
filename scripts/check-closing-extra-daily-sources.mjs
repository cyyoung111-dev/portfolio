import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {normalizeWatchOnlyCloses,PROPOSED_GAS_HANDLER,GAS_WATCH_ACTION} from './nh-briefing-watch-readonly-contract.mjs';
import {
 closingStockSessions,normalizeClosingNhStocks,readNhClosingStocks,describeClosingNhStockRead,
 validClosingStockReference,normalizeKrxOfficialClosingStocks,readKrxOfficialClosingStocks,
 readYahooClosingUsStocks,readYahooClosingKrStocks,selectYahooClosingKrDaily,readClosingStockSources,
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
assert.ok(protectedSource.includes('AbortSignal.timeout(30000)'),
 'read-only GAS request must have a bounded 30-second timeout');

assert.equal(stockCalls,1,'one read-only stored NH history batch');
assert.equal(saved.length,4);
assert.deepEqual(await readNhClosingStocks(date,{url:'http://evil.net/exec',
 token:'TEST_ACCESS_TOKEN_WITH_LENGTH',fetchImpl:()=>assert.fail('unsafe host')}),[]);
// 17:00 briefing-only fallback: accept dated KRX official KR closes and a
// completed US Yahoo daily reference, never a carry or unfinished candle.
const kstClose=()=>new Date(date+'T17:05:00+09:00');
const krxReply={status:'ok',requestedDate:date,closes:{
 '005930':{code:'005930',requestedDate:date,usedDate:date,source:'KRX_OFFICIAL',
   providerSource:'KRX',price:73500,receivedAt:date+'T16:05:00+09:00'},
 '000660':{code:'000660',requestedDate:date,usedDate:date,source:'KRX_OFFICIAL',
   providerSource:'KRX_OTP',price:179000,receivedAt:date+'T16:07:00+09:00'}
}};
const krxReference=normalizeKrxOfficialClosingStocks(date,krxReply,{instant:kstClose()});
assert.deepEqual(krxReference.map(x=>x.id),['SAMSUNG','SKHYNIX']);
assert.ok(krxReference.every(x=>x.source==='KRX_OFFICIAL'&&x.date===date));
const staleReply=structuredClone(krxReply);
staleReply.closes['005930'].usedDate='2026-10-30';
staleReply.closes['000660'].providerSource='UNKNOWN';
assert.deepEqual(normalizeKrxOfficialClosingStocks(date,staleReply,{instant:kstClose()}),[]);
const futureReply=structuredClone(krxReply);
futureReply.closes['005930'].receivedAt=date+'T19:30:00+09:00';
assert.equal(normalizeKrxOfficialClosingStocks(date,futureReply,{instant:kstClose()}).length,1);
let krxCalls=0;
const official=await readKrxOfficialClosingStocks(date,{
 url:'https://script.google.com/macros/s/EXAMPLE123/exec',
 token:'TEST_ACCESS_TOKEN_WITH_LENGTH',now:kstClose,
 fetchImpl:async(_url,request)=>{
  krxCalls++;
  assert.equal(request.body.get('action'),'getKrxOfficialStockCloses');
  assert.equal(request.body.get('codes'),'005930,000660');
  assert.equal(request.body.get('date'),date);
  return {ok:true,json:async()=>krxReply};
 }
});
assert.equal(krxCalls,1);assert.equal(official.length,2);
const krxBadReasons=[];
assert.deepEqual(await readKrxOfficialClosingStocks(date,{
 url:'https://script.google.com/macros/s/EXAMPLE123/exec',
 token:'TEST_ACCESS_TOKEN_WITH_LENGTH',now:kstClose,
 fetchImpl:async()=>({ok:true,json:async()=>({
  status:'ok',requestedDate:date,closes:{}
 })}),onDiagnostic:r=>krxBadReasons.push(r)
}),[]);
assert.deepEqual(krxBadReasons,[{kind:'KRX_CLOSE_STOCK_READ',
 status:'GAS_EMPTY_ROWS'}]);
const usCalls=[];
const usReference=await readYahooClosingUsStocks(date,{
 now:kstClose,fetchDaily:async(label,symbol,_date,{host})=>{
  usCalls.push({symbol,host});
  return {label,symbol,date:us,value:symbol==='NVDA'?215:105,
    changePercent:symbol==='NVDA'?1.5:2,source:'Yahoo Finance 일봉'};
 }
});
assert.deepEqual(usReference.map(x=>x.id),['NVDA','MU']);
assert.ok(usReference.every(x=>x.source==='YAHOO_DAILY_REFERENCE'));
assert.equal(usCalls.length,2);
const noUs=await readYahooClosingUsStocks(date,{
 now:kstClose,fetchDaily:async(label,symbol)=>({
  label,symbol,date,source:'Yahoo Finance 일봉',value:999,changePercent:0
 })
});
assert.deepEqual(noUs,[],'current/incomplete US daily bars cannot be used');
const badUs=await readYahooClosingUsStocks(date,{
 now:kstClose,fetchDaily:async(label,symbol)=>({
  label,symbol,date:us,source:'WRONG_PROVIDER',value:999,changePercent:0
 })
});
assert.deepEqual(badUs,[],'provider identity must be verified');
const blended=await readClosingStockSources(date,{
 fetchNh:async()=>[stocks[0]],fetchKrx:async()=>official,fetchKr:async()=>[],fetchUs:async()=>usReference
});
assert.deepEqual(blended.map(x=>x.id),['SAMSUNG','SKHYNIX','NVDA','MU']);
assert.deepEqual(blended.map(x=>x.source),
 ['NH_REGULAR_CLOSE','KRX_OFFICIAL','YAHOO_DAILY_REFERENCE','YAHOO_DAILY_REFERENCE']);
const alternative=await readClosingStockSources(date,{
 fetchNh:async()=>[],fetchKrx:async()=>official,fetchKr:async()=>[],fetchUs:async()=>usReference
});
assert.equal(alternative.length,4);
assert.deepEqual(summarizeCloseCoverage(date,{stocks:alternative,expectedUsDate:us}).stocks,
 {verified:4,total:4});
assert.match(formatClosingExtra(date,alternative,[]),/삼성전자: 73,500 원.*KRX 공식 종가/);
assert.match(formatClosingExtra(date,alternative,[]),/엔비디아: 215 USD.*Yahoo 일봉 참고/);
assert.equal(validClosingStockReference(date,{...alternative[0],source:'KRX_CARRY'}),false);
assert.equal(validClosingStockReference(date,{...alternative[0],id:'NVDA'}),false);

// #826: the official NH / KRX 17:00 source can lag until late evening.
// A strictly dated Korean Yahoo candle may supplement the displayed
// watch-only quote, but may NEVER become an NH/KRX official close.
const krDailyTs=d=>Date.parse(d+'T00:00:00Z')/1000;
const krDailyChart=(symbol,first,last)=>({
 meta:{symbol,exchangeTimezoneName:'Asia/Seoul'},
 timestamp:[krDailyTs('2026-10-30'),krDailyTs(date)],
 indicators:{quote:[{close:[first,last]}]}
});
const krItems=[{id:'SAMSUNG'},{id:'SKHYNIX'}];
const krCharts={
 '005930.KS':krDailyChart('005930.KS',72000,73500),
 '000660.KS':krDailyChart('000660.KS',180000,179000)
};
const parsedKr=selectYahooClosingKrDaily(date,krItems[0],krCharts['005930.KS'],
 {now:kstClose()});
assert.equal(parsedKr.source,'YAHOO_KR_DAILY_REFERENCE');
assert.equal(parsedKr.date,date);
assert.equal(parsedKr.changePercent,(73500/72000-1)*100);
assert.equal(validClosingStockReference(date,parsedKr),true);
assert.equal(selectYahooClosingKrDaily(date,krItems[0],krCharts['005930.KS'],
 {now:new Date(date+'T16:05:00+09:00')}),null);
assert.equal(selectYahooClosingKrDaily(date,krItems[0],{
 ...krCharts['005930.KS'],meta:{...krCharts['005930.KS'].meta,
 exchangeTimezoneName:'America/New_York'}},{now:kstClose()}),null);
assert.equal(selectYahooClosingKrDaily(date,krItems[0],{
 ...krCharts['005930.KS'],timestamp:[krDailyTs('2026-10-30')]},
 {now:kstClose()}),null,'timestamp/quote length mismatch rejected');
assert.equal(selectYahooClosingKrDaily(date,krItems[0],{
 ...krCharts['005930.KS'],
 timestamp:[krDailyTs('2026-10-30'),krDailyTs(date),krDailyTs(date)],
 indicators:{quote:[{close:[72000,73500,73510]}]}
},{now:kstClose()}),null,'duplicate exact-day candles rejected');
assert.equal(selectYahooClosingKrDaily(date,krItems[0],{
 ...krCharts['005930.KS'],
 indicators:{quote:[{close:[72000,null]}]}
},{now:kstClose()}),null,'null/unfinished candle rejected');
let krYahooCalls=0;
const krYahooDiagnostics=[];
const yahooKrReference=await readYahooClosingKrStocks(date,{
 now:kstClose,
 fetchImpl:async(url,options)=>{
  krYahooCalls++;
  assert.equal(options.redirect,'error');
  assert.equal(options.body,undefined,'reference GET only');
  assert.match(url,/^https:\/\/query1\.finance\.yahoo\.com\/v8\/finance\/chart\//);
  const symbol=decodeURIComponent(new URL(url).pathname.split('/').at(-1));
  assert.equal(new URL(url).searchParams.get('interval'),'1d');
  return {ok:true,headers:{get:()=>null},
   json:async()=>({chart:{result:[krCharts[symbol]]}})};
 },
 onDiagnostic:x=>krYahooDiagnostics.push(x)
});
assert.equal(krYahooCalls,2);
assert.deepEqual(yahooKrReference.map(x=>x.id),['SAMSUNG','SKHYNIX']);
assert.equal(yahooKrReference[0].source,'YAHOO_KR_DAILY_REFERENCE');
assert.equal(krYahooDiagnostics[0].status,'BOTH_VERIFIED');
let prematureFetch=0;
assert.deepEqual(await readYahooClosingKrStocks(date,{
 now:()=>new Date(date+'T16:05:00+09:00'),
 fetchImpl:async()=>{prematureFetch++;throw Error('should not GET before 16:10');}
}),[]);
assert.equal(prematureFetch,0);
const onlyUs=await readClosingStockSources(date,{
 fetchNh:async()=>[],fetchKrx:async()=>[],fetchKr:async()=>yahooKrReference,
 fetchUs:async()=>usReference
});
assert.equal(onlyUs.length,4);
assert.deepEqual(onlyUs.map(x=>x.source),[
 'YAHOO_KR_DAILY_REFERENCE','YAHOO_KR_DAILY_REFERENCE',
 'YAHOO_DAILY_REFERENCE','YAHOO_DAILY_REFERENCE'
]);
assert.match(formatClosingExtra(date,onlyUs,[]),
 /삼성전자: 73,500 원.*Yahoo 국내 일봉 참고 \(공식 종가 아님\)/);
assert.deepEqual(summarizeCloseCoverage(date,{stocks:onlyUs,expectedUsDate:us}).stocks,
 {verified:4,total:4});
const krPreferred=await readClosingStockSources(date,{
 fetchNh:async()=>[stocks[0]],fetchKrx:async()=>official,
 fetchKr:async()=>yahooKrReference,fetchUs:async()=>usReference
});
assert.deepEqual(krPreferred.map(x=>x.source),[
 'NH_REGULAR_CLOSE','KRX_OFFICIAL','YAHOO_DAILY_REFERENCE','YAHOO_DAILY_REFERENCE'
]);
assert.equal(validClosingStockReference(date,{...yahooKrReference[0],source:'KRX_CARRY'}),false);
assert.equal(validClosingStockReference(date,{...yahooKrReference[0],date:us}),false);
assert.equal(validClosingStockReference(date,{...yahooKrReference[0],id:'NVDA'}),false);

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
// A separate fixed watch list must never mutate the financial code master.
const watchDate='2026-11-03',watchUs='2026-11-02';
assert.equal(GAS_WATCH_ACTION,'getBriefingWatchCloses');
const watchReply={status:'ok',provider:'NH',readOnly:true,
  accountIndependent:true,requestedDay:watchDate,closes:{
  NVDA:{date:watchUs,price:220.05,source:'NH_REGULAR_CLOSE'},
  MU:{date:watchUs,price:115.55,source:'NH_REGULAR_CLOSE'}}};
const watchRows=normalizeWatchOnlyCloses(watchDate,watchReply);
assert.deepEqual(watchRows.map(x=>x.id),['NVDA','MU']);
assert.ok(watchRows.every(x=>x.role==='BRIEFING_WATCH_ONLY'&&x.date===watchUs));
assert.deepEqual(normalizeWatchOnlyCloses(watchDate,
 {...watchReply,accountIndependent:false}),[]);
assert.deepEqual(normalizeWatchOnlyCloses(watchDate,
 {...watchReply,closes:{...watchReply.closes,AAPL:watchReply.closes.NVDA}}),[]);
assert.equal(normalizeWatchOnlyCloses(watchDate,
 {...watchReply,closes:{NVDA:{...watchReply.closes.NVDA,date:watchDate}}}).length,0);
const providerRows=()=>({NVDA:{
  price:220.05,usedDate:watchUs,marketDate:watchUs,currency:'USD',
  source:'NH_REGULAR_CLOSE',status:'CONFIRMED',priceType:'REGULAR_CLOSE'
},MU:{price:115.55,usedDate:watchUs,marketDate:watchUs,currency:'USD',
  source:'NH_REGULAR_CLOSE',status:'CONFIRMED',priceType:'REGULAR_CLOSE'}});
let providerCalls=0,financialWrites=0,clockMinute=1020;
const ctx={
 _issue507GateInside_:true,
 _nhProxyAuthenticated_:p=>p?.accessToken==='SYNTHETIC_GAS_AUTH',
 _nhProxyKst_:()=>({date:watchDate,minutes:clockMinute}),
 _foreignMarketRegularCloseCutoff_:()=>watchUs,
 fetchNhRegularCloses:(items,day,options)=>{
   providerCalls++;assert.deepEqual(Array.from(items.map(x=>x.code)),['NVDA','MU']);
   assert.equal(day,watchDate);assert.equal(options.useMarketCloseCutoffs,true);
   return providerRows();
 },
 jsonOk:p=>({status:'ok',...p}),
 jsonError:message=>({status:'error',message}),
 // No financial write stubs are exposed at all.
};
const watchHandler=vm.runInNewContext(PROPOSED_GAS_HANDLER+
 '\nhandleGetBriefingWatchCloses;',ctx);
assert.equal(watchHandler({date:watchDate}).message,'NH_WATCH_AUTH_REQUIRED');
assert.equal(providerCalls,0);
assert.equal(watchHandler({date:'2026-11-02',
 accessToken:'SYNTHETIC_GAS_AUTH'}).message,'NH_WATCH_WINDOW');
assert.equal(providerCalls,0);
const watchReal=watchHandler({date:watchDate,accessToken:'SYNTHETIC_GAS_AUTH'});
assert.equal(watchReal.status,'ok');
assert.deepEqual(normalizeWatchOnlyCloses(watchDate,JSON.parse(JSON.stringify(watchReal))).map(x=>x.id),['NVDA','MU']);
assert.equal(providerCalls,1);
clockMinute=1090;
assert.equal(watchHandler({date:watchDate,
 accessToken:'SYNTHETIC_GAS_AUTH'}).message,'NH_WATCH_WINDOW');
assert.equal(providerCalls,1);
assert.equal(financialWrites,0);
assert.ok(!PROPOSED_GAS_HANDLER.includes('getCodeItems('));
assert.ok(!PROPOSED_GAS_HANDLER.includes('savePriceHistory'));
assert.ok(!PROPOSED_GAS_HANDLER.includes('saveSnapshot'));

console.log('CLOSING_EXTRA_DAILY_SOURCES_PASS stock=4 macro=3 NH_READONLY_BATCH=1');
