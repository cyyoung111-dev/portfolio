import assert from 'node:assert/strict';
import fs from 'node:fs';
import {checkStatus,operate} from './repair-krx-morning-trigger.mjs';

const url='https://script.google.com/macros/s/example/exec';
const token='secret-must-never-be-logged';
const trigger=(n=0)=>({
  closeCount:1,watchdogCount:1,backfillCount:1,
  historicalBackfillCount:1,midnightBackfillCount:1,
  morningBackfillCount:n,hasMorningBackfill:n>0,
  hasDuplicateMorningBackfillTriggers:n>1,
  hasLegacySplitTriggers:false
});
const status=n=>({status:'ok',gasVersion:'9.237',
  automation:{gasVersion:'9.237',trigger:trigger(n)}});
assert.deepEqual(checkStatus(status(1),{requireMorning:true}),
  {gasVersion:'9.237',morningCount:1,morningExists:true,duplicate:false});
assert.throws(()=>checkStatus(status(0),{requireMorning:true}),
  /KRX_MORNING_TRIGGER_NOT_REGISTERED/);
assert.throws(()=>checkStatus({...status(1),gasVersion:'9.234'}),
  /KRX_MORNING_RUNTIME_BASELINE_UNVERIFIED/);
assert.throws(()=>checkStatus({...status(1),automation:{
  gasVersion:'9.237',trigger:{...trigger(1),backfillCount:2}}}),
  /KRX_MORNING_RUNTIME_BASELINE_UNVERIFIED/);
let registration=0;
const fake=(initial=0,invalidStatus=false)=>async(_url,opts)=>{
  assert.equal(_url,url);assert.equal(opts.method,'POST');
  const p=opts.body,action=p.get('action');
  assert.ok(['getAutomationStatus','getPrices'].includes(action));
  if(p.get('accessToken')!==token)
    return {ok:true,json:async()=>({status:'error',message:'인증 실패'})};
  if(action==='getPrices'){
    assert.equal(p.get('persist'),'0','price history and Snapshot must not be saved');
    assert.equal(p.get('codes'),'005930');
    registration++;return{ok:true,json:async()=>({status:'error',message:'market source unavailable'})};
  }
  return {ok:true,json:async()=>invalidStatus
    ?{...status(initial),gasVersion:'9.234'}
    :status(initial+registration)};
};
const registered=await operate({url,token,fetchImpl:fake(0)});
assert.equal(registered.mode,'TRIGGER_REGISTERED');
assert.equal(registered.previousMorningBackfillCount,0);
assert.equal(registered.morningBackfillCount,1);
assert.equal(registered.pricePersisted,false);
assert.equal(registration,1);
assert.doesNotMatch(JSON.stringify(registered),/secret|script.google|005930/);
registration=0;
const already=await operate({url,token,fetchImpl:fake(1)});
assert.equal(already.mode,'ALREADY_REGISTERED');
assert.equal(registration,0,'idempotent healthy trigger must avoid provider request');
registration=0;
await assert.rejects(()=>operate({url,token,fetchImpl:fake(0,true)}),
  /KRX_MORNING_RUNTIME_BASELINE_UNVERIFIED/);
assert.equal(registration,0,'unverified GAS release must not invoke trigger registration');
registration=0;
await assert.rejects(()=>operate({url,token,fetchImpl:fake(2)}),
  /KRX_MORNING_TRIGGER_NOT_REGISTERED/,
  'duplicate trigger must be detected even after attempted auto-fix');
const src=fs.readFileSync('src/gas/apps_script.gs','utf8');
const fn=src.slice(src.indexOf('function handleGetPricesCompat('),
  src.indexOf('function handleGetPricesCompat(')+4000);
assert.match(fn,/_ensureDailyTriggersOncePerDay\(todayStr\)/);
assert.match(src,/if \(persist\) Object\.keys\(newItemsByDate\)/);
assert.match(src,/if \(persist && confirmedPersistDates\.length\)/);
console.log('KRX operational 08:45 trigger install via nonpersist getPrices, auth and release gates PASS');
