import assert from 'node:assert/strict';
import {assessKrxOvernightHealth} from './assess-krx-overnight-health.mjs';

const now=new Date('2026-10-19T02:40:00+09:00');
const slot=(date,state='SUCCEEDED')=>({runDate:date,state});
const assess=value=>assessKrxOvernightHealth(value,{now});
const good={
  mode:'READ_ONLY',gasVersion:'9.236',overallStatus:'NORMAL',triggerReady:true,
  pendingDates:[],pendingCount:0,
  officialKrxPriceHistoryLastDate:'2026-10-16',
  snapshotLastDate:'2026-10-16',
  latestBackfill:{attempted:true,ok:true},
  latestHistoricalBackfill:{attempted:true,ok:true},
  historical2310:slot('2026-10-18'),historical0030:slot('2026-10-19'),
};
assert.equal(assess(good).status,'HEALTHY');
const stillQueued={...good,overallStatus:'ERROR',
  pendingDates:['2026-10-09','2026-10-12','2026-10-15'],pendingCount:3,
  officialKrxPriceHistoryLastDate:'2026-10-14',
  snapshotLastDate:'2026-10-14',
  latestBackfill:{attempted:true,ok:false}};
const waiting=assess(stillQueued);
assert.equal(waiting.status,'ACTION_REQUIRED');
assert.deepEqual(waiting.issues,['PENDING_KRX_DATES','AUTOMATION_NOT_NORMAL']);
assert.equal(waiting.pendingCount,3);
assert.equal(waiting.lastBackfillOk,false);
assert.doesNotMatch(JSON.stringify(waiting),/accessToken|apiKey|SECRET/);
assert.deepEqual(assess({...good,triggerReady:false}).issues,
  ['TRIGGERS_NOT_READY']);
// Korean market can be closed while a US close legitimately advances
// Snapshot to a later date, without a pending KRX recovery item.
assert.equal(assess({...good,
  officialKrxPriceHistoryLastDate:'2026-10-15'}).status,'HEALTHY');
assert.deepEqual(assess({...good,
  snapshotLastDate:'2026-10-15'}).issues,
  ['KRX_SNAPSHOT_STALE']);
assert.deepEqual(assess({...good,
  snapshotLastDate:'-'}).issues,['LAST_DATE_UNAVAILABLE']);
assert.deepEqual(assess({...good,overallStatus:'WARNING'}).issues,
  ['AUTOMATION_NOT_NORMAL']);
assert.throws(()=>assess({...good,pendingCount:2}),
  /KRX_OVERNIGHT_BAD_DIAGNOSTIC/);
assert.throws(()=>assess({...good,mode:'APPLIED'}),
  /KRX_OVERNIGHT_BAD_DIAGNOSTIC/);
assert.throws(()=>assess(null),
  /KRX_OVERNIGHT_BAD_DIAGNOSTIC/);
assert.equal(assess({...good,historical0030:null}).status,'ACTION_REQUIRED');
assert.deepEqual(assess({...good,historical0030:null}).issues,['HISTORICAL_0030_NOT_OBSERVED']);
assert.deepEqual(assess({...good,historical2310:slot('2026-10-17')}).issues,
  ['HISTORICAL_2310_STALE']);
assert.deepEqual(assess({...good,historical0030:slot('2026-10-19','RUNNING')}).issues,
  ['HISTORICAL_0030_UNFINISHED']);
assert.deepEqual(assess({...good,historical0030:slot('2026-10-19','DEFERRED')}).issues,
  ['HISTORICAL_0030_DEFERRED']);
assert.deepEqual(assess({...good,historical0030:slot('2026-10-19','FAILED')}).issues,
  ['HISTORICAL_0030_FAILED']);
assert.deepEqual(assess({...good,historical0030:slot('2026-10-19','NO_WORK')}).issues,[]);
assert.deepEqual(assess({...good,gasVersion:'9.235'}).issues,
  ['HISTORICAL_2310_NOT_OBSERVED','HISTORICAL_0030_NOT_OBSERVED']);
console.log('KRX overnight health: read-only contract, queued/failed/mismatched/healthy checks PASS');
