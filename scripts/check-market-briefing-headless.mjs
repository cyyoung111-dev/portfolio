import assert from 'node:assert/strict';
import fs from 'node:fs';
import { runHeadless } from './run-market-briefing-headless.mjs';

globalThis.localStorage.clear();
const date='2026-09-18', prior='2026-09-17';
let observations=[],snapshots=[],snapshotPosts=0;
const request=async(action,params={})=>{
 if(action==='getMarketBriefingMaster')return {status:'ok',observations};
 if(action==='getMarketBriefingSnapshots')return {status:'ok',snapshots};
 if(action==='getBenchmarks')return {status:'ok',series:{KOSPI:[{date:prior,value:1}],KOSDAQ:[{date:prior,value:1}],KOSPI200:[{date:prior,value:1}],SP500:[{date:prior,value:1}],NASDAQ100:[{date:prior,value:1}],SOX:[{date:prior,value:1}],VIX:[{date:prior,value:1}]}};
 if(action==='getKrxK200NightClose')return {status:'ok',observation:{seriesId:'K200_NIGHT',tradingDate:date,sourceDate:date,value:350,market:'KRX',session:'NIGHT',source:'KRX_OFFICIAL',status:'FINAL',finality:'NIGHT_FINAL',observedAt:`${date}T06:00:00+09:00`,receivedAt:`${date}T06:15:00+09:00`}};
 if(action==='getExchangeRateHistory')return {status:'ok',history:[{date:prior,value:1380}]};
 if(action==='getPrices')return {status:'ok',prices:{}};
 if(action==='getPriceHistory')return {status:'ok',prices:{}};
 if(action==='appendMarketBriefingObservations'){{const rows=JSON.parse(params.data);observations.push(...rows);return {status:'ok',saved:rows.length,duplicates:0,rejected:0};}}
 if(action==='appendMarketBriefingSnapshot'){snapshotPosts++;const row=JSON.parse(params.data);if(!snapshots.some(x=>x.tradingDate===row.tradingDate&&x.checkpoint===row.checkpoint))snapshots.push(row);return {status:'ok',saved:1};}
 throw new Error(`unexpected ${action}`);
};
let result=await runHeadless({checkpoint:'MORNING',tradingDate:date,request});
assert.equal(result.decision.publishable,true,'KIS 없이 KRX 공식 NIGHT_FINAL로 MORNING publish 가능');
assert.equal(snapshots.length,1);
result=await runHeadless({checkpoint:'MORNING',tradingDate:date,request});
assert.equal(snapshots.length,1,'동일 checkpoint snapshot은 중복 저장되지 않음');
assert.equal(snapshotPosts,2,'서버 immutable endpoint가 재실행을 idempotent 처리');
globalThis.localStorage.clear(); observations=[];snapshots=[];snapshotPosts=0;
result=await runHeadless({checkpoint:'NIGHT_FINAL',tradingDate:date,request});
assert.equal(result.successful,true,'NIGHT_FINAL 관측값을 확보하고 저장해야 성공');
assert.ok(observations.some(row=>row.seriesId==='K200_NIGHT'&&row.finality==='NIGHT_FINAL'));
assert.equal(snapshotPosts,0,'NIGHT_FINAL은 snapshot을 저장하지 않음');
globalThis.localStorage.clear(); observations=[];snapshots=[];
const missingNight=async(action,params)=>action==='getKrxK200NightClose'?{status:'ok',observation:null}:request(action,params);
result=await runHeadless({checkpoint:'MORNING',tradingDate:date,request:missingNight});
assert.equal(result.decision.publishable,false);assert.equal(snapshots.length,0,'K200_NIGHT 누락 시 false publish 금지');
globalThis.localStorage.clear(); observations=[];snapshots=[];
result=await runHeadless({checkpoint:'NIGHT_FINAL',tradingDate:date,request:missingNight});
assert.equal(result.successful,false,'NIGHT_FINAL 누락은 scheduled CLI 실패 조건');assert.equal(snapshots.length,0);
globalThis.localStorage.clear(); observations=[];snapshots=[];
const scheduledFxRequest=async(action,params)=>action==='getExchangeRateHistory'?{status:'ok',history:[{date,value:1390}]}:request(action,params);
result=await runHeadless({checkpoint:'MORNING',tradingDate:date,request:scheduledFxRequest,receivedAt:`${date}T07:31:00+09:00`});
assert.equal(result.decision.publishable,true);assert.equal(snapshots[0].values.USDKRW.value,1390);assert.equal(snapshots[0].values.USDKRW.receivedAt,'2026-09-17T22:31:00.000Z');
assert.ok(result.decision.data.warnings.includes('USDKRW:SCHEDULED_DELAY_TOLERANCE'));
globalThis.localStorage.clear(); observations=[];snapshots=[];
const finalRequest=async(action,params={})=>{
 if(action==='getMarketBriefingMaster')return {status:'ok',observations};
 if(action==='getMarketBriefingSnapshots')return {status:'ok',snapshots};
 if(action==='getBenchmarks')return {status:'ok',series:{KOSPI:[{date,value:3400,source:'KRX_OFFICIAL',observedAt:`${date}T15:30:00+09:00`}],KOSDAQ:[{date,value:900,source:'KRX_OFFICIAL',observedAt:`${date}T15:30:00+09:00`}]},seriesMeta:{KOSPI:{confirmedClose:true,source:'KRX_OFFICIAL'},KOSDAQ:{confirmedClose:true,source:'KRX_OFFICIAL'}}};
 if(action==='getExchangeRateHistory')return {status:'ok',history:[{date:prior,value:1380}]};
 if(action==='getPrices')return {status:'ok',prices:{'005930':81000,'000660':190000},priceDates:{'005930':date,'000660':date}};
 if(action==='getPriceHistory')return {status:'ok',prices:{}};
 if(action==='getKrxOfficialStockCloses')return {status:'ok',closes:{'005930':{code:'005930',price:80500,usedDate:date,source:'KRX_OFFICIAL',receivedAt:`${date}T16:05:00+09:00`},'000660':{code:'000660',price:188000,usedDate:date,source:'KRX_OFFICIAL',receivedAt:`${date}T16:05:00+09:00`}}};
 if(action==='appendMarketBriefingObservations'){{const rows=JSON.parse(params.data);observations.push(...rows);return {status:'ok',saved:rows.length,duplicates:0,rejected:0};}}
 if(action==='appendMarketBriefingSnapshot'){const row=JSON.parse(params.data);if(!snapshots.some(x=>x.tradingDate===row.tradingDate&&x.checkpoint===row.checkpoint))snapshots.push(row);return {status:'ok',saved:1};}
 throw new Error(`unexpected ${action}`);
};
result=await runHeadless({checkpoint:'KRX_FINAL',tradingDate:date,request:finalRequest,receivedAt:`${date}T16:05:00+09:00`});
assert.equal(result.decision.publishable,true,'가격이력 없이 exact-date KRX 종가로 KRX_FINAL publish 가능');
assert.equal(snapshots[0].values.SAMSUNG.finality,'REGULAR_CLOSE');assert.equal(snapshots[0].values.SKHYNIX.source,'KRX_OFFICIAL');
result=await runHeadless({checkpoint:'EVENING',tradingDate:date,request:finalRequest,receivedAt:`${date}T20:15:30+09:00`});
assert.equal(result.decision.publishable,true);assert.equal(snapshots.find(row=>row.checkpoint==='EVENING').values.SAMSUNG.value,80500);
globalThis.localStorage.clear(); observations=[];snapshots=[];
const oneStockMissing=async(action,params)=>action==='getKrxOfficialStockCloses'?{status:'ok',closes:{'005930':{code:'005930',price:80500,usedDate:date,source:'KRX_OFFICIAL'}}}:finalRequest(action,params);
result=await runHeadless({checkpoint:'KRX_FINAL',tradingDate:date,request:oneStockMissing,receivedAt:`${date}T16:05:00+09:00`});
assert.equal(result.decision.publishable,false);assert.equal(snapshots.length,0,'한 종목 공식 종가 실패 시 snapshot 차단');
result=await runHeadless({checkpoint:'EVENING',tradingDate:date,request:oneStockMissing,receivedAt:`${date}T20:15:30+09:00`});
assert.equal(result.decision.publishable,false,'EVENING NOT_READY도 scheduled CLI 실패 조건');

// hydrate 이후에는 이번 collect가 추가한 observation만 POST하고 실패 시 hydrate 상태로 되돌린다.
const hydrated=Array.from({length:100},(_,index)=>({seriesId:`SERVER_${index}`,tradingDate:date,value:index+1,market:'TEST',session:'REGULAR',source:'SERVER',status:'FINAL',finality:'REGULAR_CLOSE',observedAt:`${date}T00:00:00.000Z`,receivedAt:`${date}T00:${String(index%60).padStart(2,'0')}:${String(Math.floor(index/60)).padStart(2,'0')}.000Z`}));
const fivePayload={KOSPI:{value:1,tradingDate:prior,sourceDate:prior,status:'FINAL',finality:'REGULAR_CLOSE'},KOSDAQ:{value:2,tradingDate:prior,sourceDate:prior,status:'FINAL',finality:'REGULAR_CLOSE'},KOSPI200:{value:3,tradingDate:prior,sourceDate:prior,status:'FINAL',finality:'REGULAR_CLOSE'},SP500:{value:4,tradingDate:prior,sourceDate:prior,status:'FINAL',finality:'REGULAR_CLOSE'},NASDAQ100:{value:5,tradingDate:prior,sourceDate:prior,status:'FINAL',finality:'REGULAR_CLOSE'}};
let postedRows=[];
const persistenceRequest=async(action,params={})=>{
 if(action==='getMarketBriefingMaster')return {status:'ok',observations:hydrated};
 if(action==='getMarketBriefingSnapshots')return {status:'ok',snapshots:[]};
 if(action==='getBenchmarks')return {status:'ok',series:Object.fromEntries(Object.entries(fivePayload).map(([key,row])=>[key,[{date:row.tradingDate,value:row.value}]]))};
 if(action==='getExchangeRateHistory')return {status:'ok',history:[]};
 if(action==='getPrices')return {status:'ok',prices:{}};
 if(action==='getPriceHistory')return {status:'ok',prices:{}};
 if(action==='appendMarketBriefingObservations'){postedRows=JSON.parse(params.data);return {status:'ok',saved:postedRows.length-2,duplicates:2,rejected:0};}
 throw new Error(`unexpected ${action}`);
};
globalThis.localStorage.clear();
const collected=await globalThis.MarketBriefingRuntime.collectExistingProvider(persistenceRequest,date,{checkpoint:'EVENING',from:prior});
assert.ok(Array.isArray(collected.observations),'collectAndIngest observations는 배열');
assert.equal(collected.state.version,1,'collectAndIngest state는 전체 runtime state');
assert.equal('rows' in collected,false,'state 객체를 rows로 노출하지 않음');
globalThis.localStorage.clear();
await globalThis.MarketBriefingRuntime.syncServerMaster(persistenceRequest,persistenceRequest,date,{checkpoint:'EVENING',from:prior});
assert.equal(postedRows.length,5,'hydrate 100건은 제외하고 신규 5건만 POST');
assert.equal(JSON.parse(globalThis.localStorage.getItem('portfolio.marketBriefing.v1')).observations.length,105,'duplicates 포함 정상 POST는 성공');
const pending=globalThis.MarketBriefingMaster.normalizeObservation({seriesId:'PENDING',tradingDate:date,value:7,market:'TEST',session:'REGULAR',source:'LOCAL',status:'PARTIAL',observedAt:`${date}T10:00:00+09:00`,receivedAt:`${date}T10:00:01+09:00`});
const outside=globalThis.MarketBriefingMaster.normalizeObservation({seriesId:'OUTSIDE',tradingDate:'2026-09-01',value:8,market:'TEST',session:'REGULAR',source:'LOCAL',status:'FINAL',finality:'REGULAR_CLOSE',observedAt:'2026-09-01T10:00:00+09:00',receivedAt:'2026-09-01T10:00:01+09:00'});
const seedPending=()=>globalThis.MarketBriefingRuntimeStore.save(globalThis.localStorage,{version:1,observations:[pending,outside],snapshots:[]});
const partialReject=async(action,params)=>action==='appendMarketBriefingObservations'?{status:'ok',saved:5,duplicates:0,rejected:1}:persistenceRequest(action,params);
globalThis.localStorage.clear();seedPending();
await assert.rejects(()=>globalThis.MarketBriefingRuntime.syncServerMaster(partialReject,partialReject,date,{checkpoint:'EVENING',from:prior}),/부분 저장 실패/);
let rolledBack=JSON.parse(globalThis.localStorage.getItem('portfolio.marketBriefing.v1')).observations;
assert.equal(rolledBack.length,102,'부분 reject 시 신규 5건만 rollback');
assert.ok(rolledBack.some(row=>row.seriesId==='PENDING'),'기존 pending observation 보존');
await globalThis.MarketBriefingRuntime.syncServerMaster(persistenceRequest,persistenceRequest,date,{checkpoint:'EVENING',from:prior});
assert.equal(postedRows.length,6,'서버 100건 + pending 1건 + 신규 5건은 6건 POST');
assert.ok(postedRows.some(row=>row.seriesId==='PENDING'),'다음 정상 sync에서 pending 재시도');
assert.ok(!postedRows.some(row=>row.seriesId==='OUTSIDE'),'sync 범위 밖 local observation은 POST 제외');
const postFailure=async(action,params)=>action==='appendMarketBriefingObservations'?Promise.reject(new Error('POST_DOWN')):persistenceRequest(action,params);
globalThis.localStorage.clear();seedPending();
await assert.rejects(()=>globalThis.MarketBriefingRuntime.syncServerMaster(postFailure,postFailure,date,{checkpoint:'EVENING',from:prior}),/POST_DOWN/);
rolledBack=JSON.parse(globalThis.localStorage.getItem('portfolio.marketBriefing.v1')).observations;
assert.equal(rolledBack.length,102,'POST 실패 시 신규 5건 rollback 및 hydrate 상태 유지');
assert.ok(rolledBack.some(row=>row.seriesId==='PENDING'),'POST 실패 후 pending 보존');

// cold-start에서도 서버의 NIGHT_FINAL을 우선 보존하여 공급자 재조회 실패를 견딘다.
const storedNight={seriesId:'K200_NIGHT',tradingDate:date,sourceDate:date,value:351,market:'KRX',session:'NIGHT',source:'KRX_OFFICIAL',status:'FINAL',finality:'NIGHT_FINAL',observedAt:`${date}T06:00:00+09:00`,receivedAt:`${date}T06:01:00+09:00`};
const coldStart=async(action,params={})=>{
 if(action==='getMarketBriefingMaster')return {status:'ok',observations:[storedNight]};
 if(action==='getMarketBriefingSnapshots')return {status:'ok',snapshots:[]};
 if(action==='getKrxK200NightClose')throw new Error('KRX_RETRY_DOWN');
 return request(action,params);
};
globalThis.localStorage.clear();observations=[];snapshots=[];
result=await runHeadless({checkpoint:'MORNING',tradingDate:date,request:coldStart});
assert.equal(result.decision.publishable,true,'서버 저장 K200_NIGHT는 재조회 실패 후에도 사용');
const workflow=fs.readFileSync('.github/workflows/market-briefing-headless.yml','utf8');
assert.match(workflow,/secrets\.GAS_ACCESS_TOKEN/);assert.doesNotMatch(workflow,/echo .*GAS_ACCESS_TOKEN/);
const runner=fs.readFileSync('scripts/run-market-briefing-headless.mjs','utf8');assert.doesNotMatch(runner,/console\.log\([^\n]*(?:token|url)/i);
console.log('브리핑 headless hydrate·collect·readiness·immutable snapshot 회귀검사 통과');
