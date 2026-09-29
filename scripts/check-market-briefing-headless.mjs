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
 if(action==='appendMarketBriefingObservations'){observations.push(...JSON.parse(params.data));return {status:'ok',saved:1};}
 if(action==='appendMarketBriefingSnapshot'){snapshotPosts++;const row=JSON.parse(params.data);if(!snapshots.some(x=>x.tradingDate===row.tradingDate&&x.checkpoint===row.checkpoint))snapshots.push(row);return {status:'ok',saved:1};}
 throw new Error(`unexpected ${action}`);
};
let result=await runHeadless({checkpoint:'MORNING',tradingDate:date,request});
assert.equal(result.decision.publishable,true,'KIS 없이 KRX 공식 NIGHT_FINAL로 MORNING publish 가능');
assert.equal(snapshots.length,1);
result=await runHeadless({checkpoint:'MORNING',tradingDate:date,request});
assert.equal(snapshots.length,1,'동일 checkpoint snapshot은 중복 저장되지 않음');
assert.equal(snapshotPosts,2,'서버 immutable endpoint가 재실행을 idempotent 처리');
globalThis.localStorage.clear(); observations=[];snapshots=[];
const missingNight=async(action,params)=>action==='getKrxK200NightClose'?{status:'ok',observation:null}:request(action,params);
result=await runHeadless({checkpoint:'MORNING',tradingDate:date,request:missingNight});
assert.equal(result.decision.publishable,false);assert.equal(snapshots.length,0,'K200_NIGHT 누락 시 false publish 금지');
const workflow=fs.readFileSync('.github/workflows/market-briefing-headless.yml','utf8');
assert.match(workflow,/secrets\.GAS_ACCESS_TOKEN/);assert.doesNotMatch(workflow,/echo .*GAS_ACCESS_TOKEN/);
const runner=fs.readFileSync('scripts/run-market-briefing-headless.mjs','utf8');assert.doesNotMatch(runner,/console\.log\([^\n]*(?:token|url)/i);
console.log('브리핑 headless hydrate·collect·readiness·immutable snapshot 회귀검사 통과');
