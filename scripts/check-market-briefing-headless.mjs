import assert from 'node:assert/strict';
import fs from 'node:fs';
import { runHeadless } from './run-market-briefing-headless.mjs';

globalThis.localStorage.clear();
const date='2026-09-18', prior='2026-09-17';
let observations=[],snapshots=[],snapshotPosts=0,nightAvailable=true,observationPosts=[];
const request=async(action,params={})=>{
 if(action==='getMarketBriefingMaster')return {status:'ok',observations};
 if(action==='getMarketBriefingSnapshots')return {status:'ok',snapshots};
 if(action==='getBenchmarks')return {status:'ok',series:{KOSPI:[{date:prior,value:1}],KOSDAQ:[{date:prior,value:1}],KOSPI200:[{date:prior,value:1}],SP500:[{date:prior,value:1}],NASDAQ100:[{date:prior,value:1}],SOX:[{date:prior,value:1}],VIX:[{date:prior,value:1}]}};
 if(action==='getKrxK200NightClose')return {status:'ok',observation:nightAvailable?{seriesId:'K200_NIGHT',tradingDate:date,sourceDate:date,value:350,market:'KRX',session:'NIGHT',source:'KRX_OFFICIAL',status:'FINAL',finality:'NIGHT_FINAL',observedAt:`${date}T06:00:00+09:00`,receivedAt:`${date}T06:15:00+09:00`}:null};
 if(action==='getExchangeRateHistory')return {status:'ok',history:[{date:prior,value:1380}]};
 if(action==='getPrices')return {status:'ok',prices:{}};
 if(action==='getPriceHistory')return {status:'ok',prices:{}};
 if(action==='appendMarketBriefingObservations'){const posted=JSON.parse(params.data);observationPosts.push(posted);observations.push(...posted);return {status:'ok',saved:posted.length};}
 if(action==='appendMarketBriefingSnapshot'){snapshotPosts++;const row=JSON.parse(params.data);if(!snapshots.some(x=>x.tradingDate===row.tradingDate&&x.checkpoint===row.checkpoint))snapshots.push(row);return {status:'ok',saved:1};}
 throw new Error(`unexpected ${action}`);
};
let result=await runHeadless({checkpoint:'NIGHT_FINAL',tradingDate:date,request,receivedAt:`${date}T06:15:00+09:00`});
assert.equal(result.decision,null);assert.equal(snapshotPosts,0,'NIGHT_FINAL snapshot POST 금지');assert.ok(Array.isArray(observationPosts[0]));
assert.ok(observationPosts[0].some(row=>row.seriesId==='K200_NIGHT'&&row.status==='FINAL'&&row.finality==='NIGHT_FINAL'));
globalThis.localStorage.clear();nightAvailable=false;
result=await runHeadless({checkpoint:'MORNING',tradingDate:date,request});
assert.equal(result.decision.publishable,true,'KIS 없이 KRX 공식 NIGHT_FINAL로 MORNING publish 가능');
assert.equal(result.decision.data.snapshot.values.K200_NIGHT.source,'KRX_OFFICIAL','cold-start MORNING은 서버 hydrate NIGHT_FINAL 사용');
assert.equal(snapshots.length,1);
result=await runHeadless({checkpoint:'MORNING',tradingDate:date,request});
assert.equal(snapshots.length,1,'동일 checkpoint snapshot은 중복 저장되지 않음');
assert.equal(snapshotPosts,2,'서버 immutable endpoint가 재실행을 idempotent 처리');
globalThis.localStorage.clear();observations=[];snapshots=[];nightAvailable=true;
const persistenceFailure=async(action,params)=>action==='appendMarketBriefingObservations'?{status:'error',message:'persist failed'}:request(action,params);
await assert.rejects(()=>runHeadless({checkpoint:'NIGHT_FINAL',tradingDate:date,request:persistenceFailure,receivedAt:`${date}T06:15:00+09:00`}),/persist failed/);assert.equal(snapshots.length,0);
globalThis.localStorage.clear(); observations=[];snapshots=[];
const missingNight=async(action,params)=>action==='getKrxK200NightClose'?{status:'ok',observation:null}:request(action,params);
result=await runHeadless({checkpoint:'MORNING',tradingDate:date,request:missingNight});
assert.equal(result.decision.publishable,false);assert.equal(snapshots.length,0,'K200_NIGHT 누락 시 false publish 금지');
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
 if(action==='appendMarketBriefingObservations'){observations.push(...JSON.parse(params.data));return {status:'ok',saved:1};}
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
const workflow=fs.readFileSync('.github/workflows/market-briefing-headless.yml','utf8');
assert.match(workflow,/secrets\.GAS_ACCESS_TOKEN/);assert.doesNotMatch(workflow,/echo .*GAS_ACCESS_TOKEN/);
const runner=fs.readFileSync('scripts/run-market-briefing-headless.mjs','utf8');assert.doesNotMatch(runner,/console\.log\([^\n]*(?:token|url)/i);
console.log('브리핑 headless hydrate·collect·readiness·immutable snapshot 회귀검사 통과');
