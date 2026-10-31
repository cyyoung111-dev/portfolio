import {isolateGasBusinessLogic} from './gas-business-fixture.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const gas=isolateGasBusinessLogic(fs.readFileSync('src/gas/apps_script.gs','utf8'));
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
const pruneCursorKey='portfolio_close_backfill_prune_cursor_v1';
const initial=['2026-10-07','2026-10-08','2026-10-12','2026-10-13'];
function setup({proofs={},failPrune=false}={}) {
  const map=new Map([[queueKey,JSON.stringify(initial)]]);
  const writes=[];
  const p={
    getProperty:key=>map.get(key)??null,
    setProperty:(key,value)=>{writes.push([key,value]);map.set(key,String(value));},
    deleteProperty:key=>{writes.push([key,null]);map.delete(key);}
  };
  const proofCalls=[],proofCursorAtCall=[],retryCalls=[],logs=[];
  let count=0;
  const context=vm.createContext({
    Date, JSON, Object, Number,
    PORTFOLIO_CLOSE_PENDING_KRX_DATES_KEY:queueKey,
    PORTFOLIO_CLOSE_BACKFILL_LEASE_KEY:leaseKey,
    PORTFOLIO_FUND_LEASE_KEY:'portfolio_fund_lease',
    PORTFOLIO_CLOSE_BACKFILL_RETRY_CURSOR_KEY:'portfolio_close_backfill_retry_cursor_v1',
    PORTFOLIO_CLOSE_BACKFILL_PRUNE_CURSOR_KEY:pruneCursorKey,
    _portfolioFundAtomic_:fn=>fn(p),
    _portfolioFundState_:(props,key)=>{const r=props.getProperty(key);return r?JSON.parse(r):null;},
    _readPendingKrxCloseDates_:props=>JSON.parse(props.getProperty(queueKey)||'[]'),
    _verifyCompletedKrxPendingDate_:(ss,date)=>{
      proofCalls.push(date);
      proofCursorAtCall.push(map.get(pruneCursorKey));
      if(failPrune)throw new Error('read failure');
      if(proofs[date]==='throw')throw new Error('invalid proof');
      return proofs[date]||{ok:false,reason:'INCOMPLETE_COVERAGE'};
    },
    getss:()=>({}),
    _krxCalendarStatus_:date=>['2026-10-09','2026-10-10','2026-10-11'].includes(date)?'CLOSED':'OPEN',
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
  return {context,p,map,writes,proofCalls,proofCursorAtCall,retryCalls,logs};
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
    _verifyCompletedKrxPendingDate_:()=>({ok:true,verifiedCodes:37}),
    diagnoseSnapshotIntegrity:()=>({status:'VALID',expectedRowCount:39,storedRowCount:39}),
    getss:()=>({}),
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



// Regression: a KRX holiday and a weekend must NOT consume both bounded
// proof slots ahead of fully persisted 10/12~14. Their queue entries must
// remain untouched for the separate holiday/Snapshot recovery policy.
{
  const holidayQueue=['2026-10-09','2026-10-10','2026-10-11','2026-10-12','2026-10-13','2026-10-14','2026-10-15'];
  const done={ok:true,verifiedCodes:37};
  const x=setup({proofs:{'2026-10-12':done,'2026-10-13':done,'2026-10-14':done}});
  x.map.set(queueKey,JSON.stringify(holidayQueue));
  x.p.setProperty(leaseKey,JSON.stringify({token:'holiday-proof',until:Date.now()+20000}));
  assert.equal(x.context._pruneVerifiedHistoricalKrxPending_('holiday-proof','2026-10-16').cleared,2);
  assert.deepEqual(x.proofCalls,['2026-10-12','2026-10-13'],
    'closed dates cannot starve stored historical close proof');
  assert.deepEqual(JSON.parse(x.map.get(queueKey)),
    ['2026-10-09','2026-10-10','2026-10-11','2026-10-14','2026-10-15']);
  assert.equal(x.context._pruneVerifiedHistoricalKrxPending_('holiday-proof','2026-10-16').cleared,1);
  assert.deepEqual(x.proofCalls,['2026-10-12','2026-10-13','2026-10-14','2026-10-15']);
  assert.deepEqual(JSON.parse(x.map.get(queueKey)),
    ['2026-10-09','2026-10-10','2026-10-11','2026-10-15'],
    'failed current historical proof and closed dates are never removed');
  const untouched=x.writes.filter(([k])=>k===queueKey);
  assert.equal(untouched.length,2,'only verified dates may mutate the queue');
  assert.equal(x.writes.some(([k])=>/snapshot_|fund|portfolio_close_run/.test(k)),false);
}


// Regression: the oldest two permanently incomplete dates must not monopolize
// the two expensive proof slots when a later date is fully persisted.
// Production function + ScriptLock/lease simulation, no stored data mutation.
{
  const backlog=['2026-10-06','2026-10-07','2026-10-08','2026-10-09',
    '2026-10-10','2026-10-11','2026-10-12'];
  const x=setup({proofs:{
    '2026-10-06':{ok:false,reason:'PRICE_HISTORY_INVALID'},
    '2026-10-07':{ok:false,reason:'FULL_SNAPSHOT_CONFLICT'},
    '2026-10-08':complete,
    '2026-10-12':{ok:false,reason:'SOURCE_INCOMPLETE'}
  }});
  x.map.set(queueKey,JSON.stringify(backlog));
  x.p.setProperty(leaseKey,JSON.stringify({token:'proof-lease',until:Date.now()+30000}));
  assert.equal(x.context._pruneVerifiedHistoricalKrxPending_('proof-lease','2026-10-16').cleared,0);
  assert.deepEqual(x.proofCalls,['2026-10-06','2026-10-07']);
  assert.deepEqual(x.proofCursorAtCall,['2026-10-06','2026-10-07'],
    'candidate #2 must not be checkpointed before candidate #1 proof starts');
  assert.equal(x.map.get(pruneCursorKey),'2026-10-07','advance even if all proofs fail');
  assert.deepEqual(JSON.parse(x.map.get(queueKey)),backlog,'failed proof must preserve queue');
  assert.equal(x.context._pruneVerifiedHistoricalKrxPending_('proof-lease','2026-10-16').cleared,1);
  assert.deepEqual(x.proofCalls,['2026-10-06','2026-10-07','2026-10-08','2026-10-12']);
  assert.deepEqual(x.proofCursorAtCall,x.proofCalls,
    'each production proof must see its OWN durable cursor, never a future candidate');
  assert.equal(x.map.get(pruneCursorKey),'2026-10-12');
  assert.deepEqual(JSON.parse(x.map.get(queueKey)),
    backlog.filter(date=>date!=='2026-10-08'),
    'only the complete 39-row full Snapshot + 37-code KRX proof is retired');
  assert.equal(x.context._pruneVerifiedHistoricalKrxPending_('proof-lease','2026-10-16').cleared,0);
  assert.deepEqual(x.proofCalls.slice(-2),['2026-10-06','2026-10-07'],
    'round robin wraps to retained oldest dates');
  assert.equal(x.proofCalls.includes('2026-10-09'),false,'closed dates never cost proof slots');
  assert.equal(x.writes.filter(([key])=>key===queueKey).length,1);
  assert.equal(x.map.has('portfolio_close_backfill_retry_cursor_v1'),false,
    'the existing writer/replay cursor must not be altered by proof scanning');
}
// Even a failed or thrown proof must advance the cursor without clearing
// the queue, and a missing/expired lease must not alter either property.
{
  const x=setup({failPrune:true});
  x.p.setProperty(leaseKey,JSON.stringify({token:'valid',until:Date.now()+20000}));
  assert.equal(x.context._pruneVerifiedHistoricalKrxPending_('valid','2026-10-16').cleared,0);
  assert.deepEqual(x.proofCalls,initial.slice(0,2));
  assert.deepEqual(x.proofCursorAtCall,initial.slice(0,2));
  assert.equal(x.map.get(pruneCursorKey),'2026-10-08');
  assert.equal(x.context._pruneVerifiedHistoricalKrxPending_('valid','2026-10-16').cleared,0);
  assert.deepEqual(x.proofCalls,initial,'subsequent pass inspects next dates');
  assert.deepEqual(JSON.parse(x.map.get(queueKey)),initial);
  const before=x.writes.length;
  assert.equal(x.context._pruneVerifiedHistoricalKrxPending_('wrong-token','2026-10-16').cleared,0);
  assert.equal(x.writes.length,before);
  x.p.setProperty(leaseKey,JSON.stringify({token:'valid',until:Date.now()-100}));
  const beforeExpired=x.writes.length;
  assert.equal(x.context._pruneVerifiedHistoricalKrxPending_('valid','2026-10-16').cleared,0);
  assert.equal(x.writes.length,beforeExpired);
}
{
  const x=setup();
  x.map.set(queueKey,JSON.stringify(['2026-10-09','2026-10-10','2026-10-11']));
  x.p.setProperty(leaseKey,JSON.stringify({token:'closed',until:Date.now()+10000}));
  assert.equal(x.context._pruneVerifiedHistoricalKrxPending_('closed','2026-10-16').cleared,0);
  assert.equal(x.map.has(pruneCursorKey),false,'holiday-only queue must not mutate cursor');
  assert.equal(x.proofCalls.length,0);
}

console.log('KRX backfill complete-date pruning: live functions/leases/safety/liveness/rollover PASS');
