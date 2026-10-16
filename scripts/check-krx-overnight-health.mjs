import assert from 'node:assert/strict';
import {assessKrxOvernightHealth} from './assess-krx-overnight-health.mjs';

const good={
  mode:'READ_ONLY',gasVersion:'9.230',overallStatus:'NORMAL',triggerReady:true,
  pendingDates:[],pendingCount:0,
  officialKrxPriceHistoryLastDate:'2026-10-16',
  snapshotLastDate:'2026-10-16',
  latestBackfill:{attempted:true,ok:true},
  latestHistoricalBackfill:{attempted:true,ok:true},
};
assert.equal(assessKrxOvernightHealth(good).status,'HEALTHY');
const stillQueued={...good,overallStatus:'ERROR',
  pendingDates:['2026-10-09','2026-10-12','2026-10-15'],pendingCount:3,
  officialKrxPriceHistoryLastDate:'2026-10-14',
  snapshotLastDate:'2026-10-14',
  latestBackfill:{attempted:true,ok:false}};
const waiting=assessKrxOvernightHealth(stillQueued);
assert.equal(waiting.status,'ACTION_REQUIRED');
assert.deepEqual(waiting.issues,['PENDING_KRX_DATES','AUTOMATION_NOT_NORMAL']);
assert.equal(waiting.pendingCount,3);
assert.equal(waiting.lastBackfillOk,false);
assert.doesNotMatch(JSON.stringify(waiting),/accessToken|apiKey|SECRET/);
assert.deepEqual(assessKrxOvernightHealth({...good,triggerReady:false}).issues,
  ['TRIGGERS_NOT_READY']);
// Korean market can be closed while a US close legitimately advances
// Snapshot to a later date, without a pending KRX recovery item.
assert.equal(assessKrxOvernightHealth({...good,
  officialKrxPriceHistoryLastDate:'2026-10-15'}).status,'HEALTHY');
assert.deepEqual(assessKrxOvernightHealth({...good,
  snapshotLastDate:'2026-10-15'}).issues,
  ['KRX_SNAPSHOT_STALE']);
assert.deepEqual(assessKrxOvernightHealth({...good,
  snapshotLastDate:'-'}).issues,['LAST_DATE_UNAVAILABLE']);
assert.deepEqual(assessKrxOvernightHealth({...good,overallStatus:'WARNING'}).issues,
  ['AUTOMATION_NOT_NORMAL']);
assert.throws(()=>assessKrxOvernightHealth({...good,pendingCount:2}),
  /KRX_OVERNIGHT_BAD_DIAGNOSTIC/);
assert.throws(()=>assessKrxOvernightHealth({...good,mode:'APPLIED'}),
  /KRX_OVERNIGHT_BAD_DIAGNOSTIC/);
assert.throws(()=>assessKrxOvernightHealth(null),
  /KRX_OVERNIGHT_BAD_DIAGNOSTIC/);
console.log('KRX overnight health: read-only contract, queued/failed/mismatched/healthy checks PASS');
