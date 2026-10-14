import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const gas=fs.readFileSync('src/gas/apps_script.gs','utf8');
function extract(name) {
  const start=gas.indexOf('function '+name+'(');
  assert.ok(start>=0,'missing '+name);
  const end=gas.indexOf('\n}',start);
  assert.ok(end>start,'unterminated '+name);
  return gas.slice(start,end+2);
}
const queueKey='portfolio_close_pending_krx_dates';
const leaseKey='portfolio_close_backfill_lease_v1';
const resultKey='portfolio_close_backfill_last_result';
const initial=['2026-10-07','2026-10-08','2026-10-12','2026-10-13'];
function setup({proofs={},failPrune=false}={}) {
  const map=new Map([[queueKey,JSON.stringify(initial)]]);
  const writes=[];
  const p={
    getProperty:key=>map.get(key)??null,
    setProperty:(key,value)=>{writes.push([key,value]);map.set(key,String(value));},
    deleteProperty:key=>{writes.push([key,null]);map.delete(key);}
  };
  const proofCalls=[],retryCalls=[],logs=[];
  let count=0;
  const context=vm.createContext({
    Date, JSON, Object, Number,
    PORTFOLIO_CLOSE_PENDING_KRX_DATES_KEY:queueKey,
    PORTFOLIO_CLOSE_BACKFILL_LEASE_KEY:leaseKey,
    PORTFOLIO_FUND_LEASE_KEY:'portfolio_fund_lease',
    PORTFOLIO_CLOSE_BACKFILL_RETRY_CURSOR_KEY:'portfolio_close_backfill_retry_cursor_v1',
    _portfolioFundAtomic_:fn=>fn(p),
    _portfolioFundState_:(props,key)=>{const r=props.getProperty(key);return r?JSON.parse(r):null;},
    _readPendingKrxCloseDates_:props=>JSON.parse(props.getProperty(queueKey)||'[]'),
    _verifyCompletedKrxPendingDate_:(ss,date)=>{
      proofCalls.push(date);
      if(failPrune)throw new Error('read failure');
      if(proofs[date]==='throw')throw new Error('invalid proof');
      return proofs[date]||{ok:false,reason:'INCOMPLETE_COVERAGE'};
    },
    getss:()=>({}),
    _retryOnePendingKrxClose_:(props,date,includeToday)=>{
      const active=JSON.parse(props.getProperty(queueKey)||'[]');
      retryCalls.push({date,includeToday,active});
      return {attempted:true,ok:true,date:active[0]};
    },
    Logger:{log:v=>logs.push(v)},
    Utilities:{getUuid:()=> 'test-token-'+(++count)},
  });
  vm.runInContext(extract('_pruneVerifiedHistoricalKrxPending_'),context);
  vm.runInContext(extract('_runPendingKrxBackfillWithLease_'),context);
  return {context,p,map,writes,proofCalls,retryCalls,logs};
}
const complete={ok:true,verifiedCodes:37};
let a=setup({proofs:{'2026-10-07':complete,'2026-10-08':complete}});
const result=JSON.parse(JSON.stringify(a.context._runPendingKrxBackfillWithLease_(a.p,'2026-10-14',false)));
assert.equal(result.attempted,true);
assert.deepEqual(JSON.parse(a.map.get(queueKey)),['2026-10-12','2026-10-13']);
assert.deepEqual(a.proofCalls,initial.slice(0,2));
assert.deepEqual(a.retryCalls[0].active,['2026-10-12','2026-10-13']);
assert.equal(a.retryCalls[0].includeToday,true);
assert.equal(a.map.has(leaseKey),false,'lease must always release');
assert.ok(a.map.has('portfolio_close_historical_backfill_last_result'));
assert.equal(a.map.has(resultKey),false,'historical fallback must not overwrite same-day diagnostic');
assert.equal(a.writes.filter(([key])=>key===queueKey).length,1);
assert.equal(a.writes.some(([key])=>/snapshot_|fund|portfolio_close_run/.test(key)),false);

a=setup({proofs:{'2026-10-07':complete,'2026-10-08':{ok:false,reason:'SNAPSHOT_INVALID'}}});
a.context._runPendingKrxBackfillWithLease_(a.p,'2026-10-14',false);
assert.deepEqual(JSON.parse(a.map.get(queueKey)),['2026-10-08','2026-10-12','2026-10-13']);
assert.deepEqual(a.retryCalls[0].active,['2026-10-08','2026-10-12','2026-10-13']);

a=setup({proofs:{'2026-10-07':'throw','2026-10-08':complete}});
a.context._runPendingKrxBackfillWithLease_(a.p,'2026-10-14',false);
assert.deepEqual(JSON.parse(a.map.get(queueKey)),['2026-10-07','2026-10-12','2026-10-13']);

a=setup({failPrune:true});
a.context._runPendingKrxBackfillWithLease_(a.p,'2026-10-14',false);
assert.deepEqual(JSON.parse(a.map.get(queueKey)),initial);
assert.equal(a.retryCalls.length,1,'pruning proof failure must not starve replay');

a=setup({proofs:{'2026-10-07':complete,'2026-10-08':complete}});
a.context._runPendingKrxBackfillWithLease_(a.p,'2026-10-14',true);
assert.deepEqual(JSON.parse(a.map.get(queueKey)),initial,'regular 19:00 close must not do this cleanup');
assert.equal(a.proofCalls.length,0);

a=setup();
assert.equal(a.context._pruneVerifiedHistoricalKrxPending_('not-owned','2026-10-14').cleared,0);
assert.deepEqual(JSON.parse(a.map.get(queueKey)),initial,'missing lease refuses mutation');
assert.equal(a.writes.length,0);

a=setup({proofs:{'2026-10-07':complete,'2026-10-08':complete}});
a.p.setProperty(leaseKey,JSON.stringify({token:'mine',until:Date.now()+20000}));
assert.equal(a.context._pruneVerifiedHistoricalKrxPending_('mine','2026-10-14').cleared,2);
assert.deepEqual(JSON.parse(a.map.get(queueKey)),initial.slice(2));
assert.equal(a.context._pruneVerifiedHistoricalKrxPending_('mine','2026-10-14').cleared,0);
assert.deepEqual(JSON.parse(a.map.get(queueKey)),initial.slice(2),'missing days must not be removed by repeated checks');


function checkRotation(dates, cursor, includeToday, failure) {
  const state=new Map([['queue',JSON.stringify(dates)],['cursor',cursor]]);
  const props={getProperty:k=>state.get(k)??null,setProperty:(k,v)=>state.set(k,String(v)),deleteProperty:k=>state.delete(k)};
  const calls=[];
  const ctx=vm.createContext({
    PORTFOLIO_CLOSE_BACKFILL_RETRY_CURSOR_KEY:'cursor',
    _readPendingKrxCloseDates_:()=>JSON.parse(state.get('queue')),
    saveDailyPriceHistory:date=>{calls.push(date);if(failure)throw Error('stale source');return {ok:true,date,rows:39};},
    _portfolioFundAtomic_:fn=>fn(props),
    _reconcileRecoveredPortfolioPrice_:()=>true,
    _completePendingKrxCloseDate_:(_,date)=>state.set('queue',JSON.stringify(JSON.parse(state.get('queue')).filter(x=>x!==date))),
    _appendPortfolioCloseSyncLog:()=>{}
  });
  vm.runInContext(extract('_retryOnePendingKrxClose_'),ctx);
  for(let i=0;i<dates.length;i++)ctx._retryOnePendingKrxClose_(props,'2026-10-14',includeToday);
  return {calls,queue:JSON.parse(state.get('queue'))};
}
const pending=['2026-10-12','2026-10-13','2026-10-14'];
assert.deepEqual(checkRotation(pending,'',true,true).calls,['2026-10-14','2026-10-14','2026-10-14']);
assert.deepEqual(checkRotation(pending,'2026-10-14',true,true).calls,['2026-10-14','2026-10-14','2026-10-14']);
assert.deepEqual(checkRotation(pending,'',false,true).calls,['2026-10-12','2026-10-13','2026-10-12']);
assert.deepEqual(checkRotation(pending,'',true,true).queue,pending);
assert.deepEqual(checkRotation(pending,'',true,false).queue,[],'urgent worker may process history after current day has been cleared');
assert.deepEqual(checkRotation(pending,'',false,false).queue,['2026-10-14'],'historical worker must not consume current-day queue');
function checkNextDayReset() {
  const state=new Map([['queue',JSON.stringify(['2026-10-12','2026-10-14','2026-10-15'])],['cursor',''],['portfolio_close_backfill_last_was_today','2026-10-14']]);
  const props={getProperty:k=>state.get(k)??null,setProperty:(k,v)=>state.set(k,String(v)),deleteProperty:k=>state.delete(k)};
  const calls=[];
  const ctx=vm.createContext({
    PORTFOLIO_CLOSE_BACKFILL_RETRY_CURSOR_KEY:'cursor',
    _readPendingKrxCloseDates_:()=>JSON.parse(state.get('queue')),
    saveDailyPriceHistory:date=>{calls.push(date);throw Error('unavailable');},
    _portfolioFundAtomic_:fn=>fn(props),
    _appendPortfolioCloseSyncLog:()=>{}
  });
  vm.runInContext(extract('_retryOnePendingKrxClose_'),ctx);
  ctx._retryOnePendingKrxClose_(props,'2026-10-15',true);
  ctx._retryOnePendingKrxClose_(props,'2026-10-15',true);
  assert.deepEqual(calls,['2026-10-15','2026-10-15'],'urgent worker always prioritizes queued current day');
  ctx._retryOnePendingKrxClose_(props,'2026-10-15',false);
  assert.deepEqual(calls,['2026-10-15','2026-10-15','2026-10-12'],'historical worker progresses independently');
}
checkNextDayReset();


console.log('KRX backfill complete-date pruning: live functions/leases/safety/liveness/rollover PASS');
