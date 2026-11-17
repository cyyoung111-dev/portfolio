import assert from 'node:assert/strict';
import fs from 'node:fs';
import YAML from 'yaml';
import {precloseWindow,precomputeClose,sanitizePreclose,readMissingCloseReferences} from './telegram-close-precompute.mjs';
import {verifyPreparedClose,loadPreparedClose} from './telegram-close-prepared-artifact.mjs';
import {prepareClose,deliverClose} from './telegram-close-workflow.mjs';
const date='2026-10-30',us='2026-10-29',
 pre=()=>new Date(date+'T16:50:00+09:00'),
 now=()=>new Date(date+'T17:00:00+09:00');
assert.equal(precloseWindow(new Date(date+'T16:44:59+09:00')).allowed,false);
assert.equal(precloseWindow(pre()).allowed,true);
assert.equal(precloseWindow(now()).allowed,false);
const nh=[
 {label:'S&P 500',symbol:'^GSPC',date:us,value:6500,changePercent:1,source:'NH_INDEX_DAILY'},
 {label:'NASDAQ',symbol:'^IXIC',date:us,value:26000,changePercent:1,source:'NH_INDEX_DAILY'},
 {label:'NASDAQ100',symbol:'^NDX',date:us,value:25000,changePercent:1,source:'NH_INDEX_DAILY'}
],domestic=[
 {type:'KOSPI',label:'KOSPI',date,source:'KRX_OFFICIAL',role:'NON_NH_DAILY_INDEX',priceType:'CONFIRMED_REGULAR_CLOSE',value:4200,changePercent:1},
 {type:'KOSDAQ',label:'KOSDAQ',date,source:'KRX_OFFICIAL',role:'NON_NH_DAILY_INDEX',priceType:'CONFIRMED_REGULAR_CLOSE',value:850,changePercent:0},
 {type:'KOSPI200',label:'KOSPI 200',date,source:'KRX_OFFICIAL',role:'NON_NH_DAILY_INDEX',priceType:'CONFIRMED_REGULAR_CLOSE',value:610,changePercent:0.3}
],secondary=[
 {label:'다우존스',date:us,source:'FRED_DJIA',role:'NON_NH_REFERENCE_ONLY',value:51000},
 {label:'SOX',date:us,source:'FRED_NASDAQSOX',role:'NON_NH_REFERENCE_ONLY',value:10300},
 {label:'VIX',date:us,source:'CBOE_VIX_DAILY',role:'NON_NH_REFERENCE_ONLY',value:18.5}
],stocks=[
 {id:'SAMSUNG',label:'삼성전자',symbol:'005930.KS',date,source:'NH_REGULAR_CLOSE',value:73500,changePercent:0.5},
 {id:'SKHYNIX',label:'SK하이닉스',symbol:'000660.KS',date,source:'NH_REGULAR_CLOSE',value:255000,changePercent:-0.5},
 {id:'NVDA',label:'엔비디아',symbol:'NVDA',date:us,source:'NH_REGULAR_CLOSE',value:215,changePercent:1.5},
 {id:'MU',label:'마이크론',symbol:'MU',date:us,source:'NH_REGULAR_CLOSE',value:105,changePercent:2}
],macros=[
 {id:'USDKRW',label:'원/달러',symbol:'KRW=X',date:us,source:'YAHOO_DAILY_REFERENCE',value:1445.1,changePercent:0.1},
 {id:'DXY',label:'DXY',symbol:'DX-Y.NYB',date:us,source:'YAHOO_DAILY_REFERENCE',value:102,changePercent:0.4},
 {id:'UST10Y',label:'미 10년물',symbol:'^TNX',date:us,source:'YAHOO_DAILY_REFERENCE',value:4.9,changePercent:0.1}
];
const markets=[
 {id:'WTI',label:'WTI',symbol:'CL=F',date:us,source:'YAHOO_DAILY_REFERENCE',value:72,changePercent:1},
 {id:'BRENT',label:'Brent',symbol:'BZ=F',date:us,source:'YAHOO_DAILY_REFERENCE',value:75,changePercent:-1},
 {id:'GOLD',label:'금',symbol:'GC=F',date:us,source:'YAHOO_DAILY_REFERENCE',value:4200,changePercent:0.2},
 {id:'COPPER',label:'구리',symbol:'HG=F',date:us,source:'YAHOO_DAILY_REFERENCE',value:4.9,changePercent:0.2},
 {id:'BTC',label:'BTC',symbol:'BTC-USD',date:us,source:'YAHOO_DAILY_REFERENCE',value:115000,changePercent:0.5}
];
const priorVkospi=[{id:'VKOSPI',label:'VKOSPI',date:us,value:24.2,
 source:'KRX_OFFICIAL',role:'NON_NH_REFERENCE_ONLY'}];
const priorTurnover=[
 {id:'KRX_TURNOVER_KOSPI',market:'KOSPI',date:us,valueKrw:20250000000000,
  source:'KRX_OFFICIAL_INDEX_DAILY',role:'NON_NH_REFERENCE_ONLY'},
 {id:'KRX_TURNOVER_KOSDAQ',market:'KOSDAQ',date:us,valueKrw:6300000000000,
  source:'KRX_OFFICIAL_INDEX_DAILY',role:'NON_NH_REFERENCE_ONLY'}];
const skhy=[{symbol:'SKHY',label:'SK하이닉스 ADR',date:us,value:142.25,source:'NASDAQ_DAILY_REFERENCE'}];
const all={nh,domestic,secondary,stocks,macros,markets};
const priorCalls=[];
const recovered=await readMissingCloseReferences(date,{priorVkospi},{
 now,fetchPriorVkospi:async()=>assert.fail('complete cache must not fetch again'),
 fetchPriorTurnover:async day=>{priorCalls.push(day);return priorTurnover;},
 fetchSkhy:async day=>{priorCalls.push(day);return skhy;}
});
assert.deepEqual(recovered,{priorVkospi,priorTurnover,skhy});
assert.deepEqual(priorCalls.sort(),[us,date].sort());
const fastFallback=await readMissingCloseReferences(date,{skhy},{
 now,gasUrl:'https://script.google.com/macros/s/test/exec',gasToken:'synthetic-test-token',
 krxKey:'synthetic-krx-key-0001',
 fetchPriorVkospi:async(day,config)=>{assert.equal(day,us);assert.equal(config.gasBudgetMs,1500);return priorVkospi;},
 fetchPriorTurnover:async(day,config)=>{assert.equal(day,us);assert.equal(config.gasBudgetMs,1500);return priorTurnover;}
});
assert.deepEqual(fastFallback,{priorVkospi,priorTurnover,skhy});
const timeout=await readMissingCloseReferences(date,{priorVkospi,priorTurnover},{
 now,fetchSkhy:()=>new Promise(()=>{}),maxMs:10
});
assert.deepEqual(timeout,{priorVkospi,priorTurnover,skhy:[]});
const invalid=await readMissingCloseReferences(date,{priorVkospi,priorTurnover},{
 now,fetchSkhy:async()=>[{...skhy[0],date}],maxMs:100
});
assert.deepEqual(invalid.skhy,[]);
const r=await precomputeClose({now:pre,fetchNh:async()=>nh,fetchDomestic:async()=>domestic,
 fetchSecondary:async()=>secondary,fetchStocks:async()=>stocks,fetchMacros:async()=>macros,
 fetchMarkets:async()=>markets,fetchPriorVkospi:async day=>{assert.equal(day,us);return priorVkospi;},
 fetchPriorTurnover:async day=>{assert.equal(day,us);return priorTurnover;},
 fetchSkhy:async day=>{assert.equal(day,date);return skhy;}});
assert.equal(r.status,'PRECOMPUTED');
assert.deepEqual(r.counts,{nh:3,domestic:3,secondary:3,stocks:4,macros:3,markets:5,priorVkospi:1,priorTurnover:2,skhy:1});
assert.deepEqual(verifyPreparedClose(date,r.data,now())?.priorVkospi,priorVkospi);
assert.deepEqual(verifyPreparedClose(date,r.data,now())?.priorTurnover,priorTurnover);
assert.deepEqual(verifyPreparedClose(date,r.data,now())?.skhy,skhy);
assert.equal(verifyPreparedClose(date,{...r.data,skhy:[{...skhy[0],date}]},now()),null);
const {priorVkospi:unusedVk,priorTurnover:unusedTurnover,skhy:unusedSkhy,...legacy}=r.data;
assert.deepEqual(verifyPreparedClose(date,legacy,now())?.priorVkospi,[]);
assert.equal(verifyPreparedClose(date,{...r.data,priorVkospi:[{...priorVkospi[0],date}]},now()),null);
assert.equal(verifyPreparedClose(date,{...r.data,priorTurnover:[...priorTurnover,priorTurnover[0]]},now()),null);
assert.equal(verifyPreparedClose(date,{...r.data,priorTurnover:[{...priorTurnover[0],date:'2026-10-28'}]},now()),null);
assert.equal(verifyPreparedClose(date,r.data,now())?.nh.length,3);
assert.equal(verifyPreparedClose(date,{...r.data,date:us},now()),null);
assert.equal(verifyPreparedClose(date,{...r.data,capturedAt:date+'T17:00:00+09:00'},now()),null);
assert.equal(verifyPreparedClose(date,{...r.data,stocks:[...stocks,stocks[0]]},now()),null);
assert.equal(verifyPreparedClose(date,{...r.data,macros:[{...macros[2],value:49.9}]},now()),null);
assert.equal(verifyPreparedClose(date,{...r.data,markets:[{...markets[4],date}]},now()),null);
assert.equal(verifyPreparedClose(date,{...r.data,markets:undefined},now()),null);
assert.equal(sanitizePreclose(date,{...all,nh:[...nh,nh[0]]}).nh.length,2,
 'ambiguous duplicated NH symbol must be excluded without discarding unrelated verified symbols');
assert.equal(verifyPreparedClose(date,{...r.data,nh:[...nh,nh[0]]},now()),null,
 'ambiguous artifact must be rejected rather than silently pruning duplicates');
assert.equal(sanitizePreclose(date,{...all,stocks:[{...stocks[0],source:'KRX_CARRY'}]}).stocks.length,0);
const approvedAlternatives=[
 {...stocks[0],source:'KRX_OFFICIAL',changePercent:null},
 {...stocks[1],source:'KRX_OFFICIAL',changePercent:null},
 {...stocks[2],source:'YAHOO_DAILY_REFERENCE'},
 {...stocks[3],source:'YAHOO_DAILY_REFERENCE'}
];
assert.equal(sanitizePreclose(date,{...all,stocks:approvedAlternatives}).stocks.length,4);
assert.equal(verifyPreparedClose(date,{...r.data,stocks:approvedAlternatives},now())?.stocks.length,4);
assert.equal(sanitizePreclose(date,{...all,stocks:[
 {...stocks[0],source:'YAHOO_DAILY_REFERENCE'},
 {...stocks[2],source:'KRX_OFFICIAL'}
]}).stocks.length,0,'a valid source for the wrong market cannot count');
assert.equal((await precomputeClose({now:()=>new Date('2026-10-31T16:50:00+09:00'),
 fetchNh:async()=>assert.fail('weekend no fetch')})).status,'MARKET_NOT_OPEN');
const run={id:7123,name:'Telegram closing data precompute',
 path:'.github/workflows/telegram-close-precompute.yml',event:'schedule',
 head_branch:'main',head_repository:{full_name:'cyyoung111-dev/portfolio'},
 status:'completed',conclusion:'success',run_attempt:1,created_at:'2026-10-30T07:50:00Z'};
const artifact={id:611,name:'telegram-close-prepared-'+date,expired:false,
 size_in_bytes:4500,workflow_run:{id:7123}};
const fake=mutate=>async url=>{
 if(url.includes('/artifacts?'))return {ok:true,json:async()=>({
   total_count:mutate?.count??1,artifacts:mutate?.artifacts??[artifact]})};
 if(url.includes('/runs/'))return {ok:true,json:async()=>({...run,...mutate?.run})};
 if(url.includes('/zip'))return {ok:true,arrayBuffer:async()=>Buffer.from('fakezip')};
 throw Error('unknown GitHub url');
};
const loader={token:'TEST_TOKEN',repository:'cyyoung111-dev/portfolio',
 now,fetchImpl:fake(),decode:async()=>r.data};
assert.equal((await loadPreparedClose(date,loader))?.stocks.length,4);
assert.equal(await loadPreparedClose(date,{...loader,fetchImpl:fake({run:{head_branch:'feature'}})}),null);
assert.equal(await loadPreparedClose(date,{...loader,fetchImpl:fake({run:{event:'workflow_dispatch'}})}),null);
assert.equal(await loadPreparedClose(date,{...loader,fetchImpl:fake({run:{conclusion:'failure'}})}),null);
assert.equal(await loadPreparedClose(date,{...loader,fetchImpl:fake({run:{created_at:'2026-10-30T08:00:00Z'}})}),null);
assert.equal(await loadPreparedClose(date,{...loader,fetchImpl:fake({count:2})}),null);
assert.equal(await loadPreparedClose(date,{...loader,decode:async()=>({...r.data,date:us})}),null);
assert.equal(await loadPreparedClose(date,{...loader,repository:'evil/repo'}),null);

const opts={now,githubToken:'TEST_TOKEN',repository:'cyyoung111-dev/portfolio',
 fetchImpl:async()=>({ok:true,json:async()=>({total_count:0,artifacts:[]})})};
let calls=0;
const noFetch=async()=>{calls++;throw Error('duplicate fetch');};
const prepared=await prepareClose({...opts,loadPrepared:async()=>r.data,
 fetchNh:noFetch,fetchDomestic:noFetch,fetchSecondary:noFetch,
 fetchStocks:noFetch,fetchMacros:noFetch,fetchMarkets:noFetch});
assert.equal(prepared.ready,true);
assert.equal(calls,0,'all cached groups skip redundant provider fetches');
assert.equal(prepared.cacheSource,'VERIFIED_1650_ARTIFACT');
assert.equal(prepared.coverage.core.verified,6);
assert.equal(prepared.coverage.stocks.verified,4);
assert.equal(prepared.coverage.macros.verified,3);
assert.equal(prepared.coverage.markets.verified,5);
assert.ok(prepared.message.length<4000);
assert.ok(prepared.message.includes('SK하이닉스 ADR (SKHY): $142.25 [2026-10-29 · Nasdaq 참고]'));
assert.match(prepared.message,/VKOSPI 직전 공표: 24\.20 \[2026-10-29 · KRX\]/);
assert.match(prepared.message,/KOSPI 지수 구성종목 거래대금 직전 공표: 20\.25조원 \[2026-10-29 · KRX\]/);
assert.match(prepared.message,/KOSDAQ 지수 구성종목 거래대금 직전 공표: 6\.30조원/);
assert.match(prepared.message,/VKOSPI 0\/1 · KRX 지수 구성 거래대금 0\/2/);
assert.equal(prepared.coverage.volatility.verified,0);
assert.equal(prepared.coverage.turnover.verified,0);
assert.equal(prepared.message.split('\n').filter(x=>x.startsWith('VKOSPI:')).length,1);
const {formatClose}=await import('./telegram-close-workflow.mjs');
const withToday=formatClose(date,nh,secondary,domestic,stocks,macros,markets,[],now(),[],
 [{...priorVkospi[0],date}],null,null,[{...priorTurnover[0],date}],null,null,{priorVkospi,priorTurnover});
assert.match(withToday,/VKOSPI: 24\.20 \[2026-10-30 · KRX\]/);
assert.doesNotMatch(withToday,/VKOSPI 직전 공표:|KOSPI 지수 구성종목 거래대금 직전 공표:/);
assert.match(withToday,/KOSDAQ 지수 구성종목 거래대금 직전 공표: 6\.30조원/);
let sends=0;
assert.equal((await deliverClose(prepared,{now,send:async(_token,_chat,message)=>{
 sends++;
 assert.ok(message.includes('SK하이닉스 ADR (SKHY): $142.25'));
 assert.match(message,/VKOSPI 직전 공표: 24\.20/);
 assert.match(message,/거래대금 직전 공표: 20\.25조원/);
}})).status,'SENT');
await assert.rejects(deliverClose({...prepared,reportInputs:{...prepared.reportInputs,
 priorVkospi:[{...priorVkospi[0],date}]}},{now,send:async()=>assert.fail('wrong prior date sent')}),
 /PAYLOAD_INVALID/);
await assert.rejects(deliverClose(prepared,{
 now:()=>new Date(date+'T18:00:00+09:00'),send:async()=>{sends++;}}),
 /PAYLOAD_INVALID/);
assert.equal(sends,1);
let live=0;
const partial=await prepareClose({...opts,
 loadPrepared:async()=>({...r.data,nh:nh.slice(0,1),domestic:domestic.slice(0,2),
  secondary:[],stocks:stocks.slice(0,2),macros:macros.slice(0,1),markets:markets.slice(0,3)}),
 fetchNh:async()=>{live++;return nh.slice(1);},
 fetchDomestic:async()=>{live++;return domestic.slice(2);},
 fetchSecondary:async()=>{live++;return secondary;},
 fetchStocks:async()=>{live++;return stocks.slice(2);},
 fetchMacros:async()=>{live++;return macros.slice(1);},
 fetchMarkets:async()=>{live++;return markets.slice(3);}
});
assert.equal(live,6);
assert.equal(partial.coverage.core.verified,6);
assert.equal(partial.coverage.stocks.verified,4);
assert.equal(partial.coverage.macros.verified,3);
assert.equal(partial.coverage.markets.verified,5);
const recoveredWithoutCache=await prepareClose({...opts,
 loadPrepared:async()=>({...r.data,priorVkospi:[],priorTurnover:[],skhy:[]}),
 fetchPriorReferences:async(day,current,config)=>{
  assert.equal(day,date);assert.equal(current.priorVkospi.length,0);
  assert.equal(config.maxMs,6000);
  return {priorVkospi,priorTurnover,skhy};
 },
 fetchNh:noFetch,fetchDomestic:noFetch,fetchSecondary:noFetch,
 fetchStocks:noFetch,fetchMacros:noFetch,fetchMarkets:noFetch});
assert.equal(recoveredWithoutCache.ready,true);
assert.deepEqual(recoveredWithoutCache.reportInputs.priorVkospi,priorVkospi);
assert.ok(recoveredWithoutCache.message.includes('SK하이닉스 ADR (SKHY): $142.25'));
assert.equal(recoveredWithoutCache.coverage.volatility.verified,0);
const missing=await prepareClose({...opts,loadPrepared:async()=>null,
 fetchNh:async()=>[],fetchDomestic:async()=>[],fetchSecondary:async()=>[],
 fetchStocks:async()=>[],fetchMacros:async()=>[],fetchMarkets:async()=>[]});
assert.equal(missing.status,'NO_VERIFIED_INDEX_CLOSE');
const w=YAML.parse(fs.readFileSync('.github/workflows/telegram-close-precompute.yml','utf8'));
assert.deepEqual(w.on.schedule.map(x=>x.cron),['50 7 * * 1-5']);
assert.equal(w.jobs.precompute.environment,'portfolio-production-gas');
assert.equal(w.jobs.precompute['timeout-minutes'],6);
assert.equal(w.jobs.precompute.steps.find(s=>s.id==='prepare').env.KRX_AUTH_KEY,'${{ secrets.KRX_AUTH_KEY }}');
assert.equal(w.jobs.precompute.steps.some(s=>s.env?.TELEGRAM_BOT_TOKEN),false);
assert.equal(w.jobs.precompute.steps.some(s=>/Send claimed/.test(s.name||'')),false);
assert.deepEqual(Object.keys(w.on),['schedule']);
console.log('CLOSE_PRECOMPUTE_PASS 16:50_KST artifact 17:00 selective refresh 18:00 cutoff');
