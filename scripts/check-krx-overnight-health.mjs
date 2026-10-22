import assert from 'node:assert/strict';
import {assessKrxOvernightHealth} from './assess-krx-overnight-health.mjs';

const now=new Date('2026-10-19T02:40:00+09:00');
const slot=(date,state='SUCCEEDED')=>({runDate:date,state});
const assess=value=>assessKrxOvernightHealth(value,{now});
const good={
  mode:'READ_ONLY',gasVersion:'9.237',overallStatus:'NORMAL',triggerReady:true,
  pendingDates:[],pendingCount:0,pendingTradeSnapshotRebuildFrom:'-',
  tradeLedgerWriteUnverified:false,
  officialKrxPriceHistoryLastDate:'2026-10-16',
  snapshotLastDate:'2026-10-16',
  latestBackfill:{attempted:true,ok:true},
  latestHistoricalBackfill:{attempted:true,ok:true},
  historical2310:slot('2026-10-18'),historical0030:slot('2026-10-19'),
};
assert.equal(assess(good).status,'HEALTHY');
assert.deepEqual(assess(good).pendingSessionCounts,{open:0,closed:0,unknown:0});
assert.equal(assess(good).historicalSlotReasons['2310'],'NOT_REPORTED');
assert.equal(assess(good).historicalSlotRunDates['0030'],'2026-10-19');
assert.equal(assess(good).lastBackfillFailureClass,'NOT_REPORTED');
// Real diagnostics already sanitize these fixed-enum fields. Confirm they
// survive the health assessor without requiring free-form GAS exceptions.
const annotated=assess({...good,
  historical2310:{...slot('2026-10-18'),reason:'COMPLETE'},
  historical0030:{...slot('2026-10-19','FAILED'),reason:'EXCEPTION'},
  latestBackfill:{attempted:true,ok:false,failureClass:'BACKUP_SAFETY_FAILED'},
  latestHistoricalBackfill:{attempted:true,ok:false,
    failureClass:'SAVED_KRX_OR_SNAPSHOT_PROOF_FAILED'}
});
assert.deepEqual(annotated.historicalSlotReasons,
  {'2310':'COMPLETE','0030':'EXCEPTION'});
assert.deepEqual(annotated.historicalSlotRunDates,
  {'2310':'2026-10-18','0030':'2026-10-19'});
assert.equal(annotated.lastBackfillFailureClass,'BACKUP_SAFETY_FAILED');
assert.equal(annotated.lastHistoricalFailureClass,
  'SAVED_KRX_OR_SNAPSHOT_PROOF_FAILED');
assert.deepEqual(annotated.issues,['HISTORICAL_0030_FAILED']);
const stale=assess({...good,
  historical2310:{...slot('2026-10-16','FAILED'),reason:'LEASE_CONFLICT'}});
assert.deepEqual(stale.issues,['HISTORICAL_2310_STALE']);
assert.equal(stale.historicalSlotRunDates['2310'],'2026-10-16');
assert.equal(stale.historicalSlotReasons['2310'],'LEASE_CONFLICT');
const unsafe=assess({...good,
  historical2310:{...slot('2026-10-18'),reason:'SECRET_RAW_GAS_EXCEPTION'},
  historical0030:{...slot('2026-02-30'),reason:'FAILED'},
  latestBackfill:{attempted:true,ok:false,
    failureClass:'SECRET_RAW_GAS_EXCEPTION'}});
assert.equal(unsafe.historicalSlotReasons['2310'],'UNVERIFIED');
assert.equal(unsafe.historicalSlotRunDates['0030'],'-');
assert.equal(unsafe.lastBackfillFailureClass,'UNVERIFIED');
assert.doesNotMatch(JSON.stringify(unsafe),/SECRET_RAW_GAS_EXCEPTION/);
assert.equal(assess({...good,historical0030:null}).historicalSlotReasons['0030'],
  'NOT_OBSERVED');
assert.deepEqual(assess({...good,tradeLedgerWriteUnverified:true}).issues,
  ['TRADE_LEDGER_WRITE_UNVERIFIED']);
const withPendingLedger=assess({...good,pendingTradeSnapshotRebuildFrom:'2026-06-05'});
assert.equal(withPendingLedger.status,'ACTION_REQUIRED');
assert.deepEqual(withPendingLedger.issues,['PENDING_TRADE_LEDGER_REBUILD']);
assert.equal(withPendingLedger.pendingTradeSnapshotRebuildFrom,'2026-06-05');
assert.throws(()=>assess({...good,pendingTradeSnapshotRebuildFrom:'bad-date'}),/KRX_OVERNIGHT_BAD_DIAGNOSTIC/);
const stillQueued={...good,overallStatus:'ERROR',
  pendingDates:['2026-10-09','2026-10-12','2026-10-15'],pendingCount:3,
  officialKrxPriceHistoryLastDate:'2026-10-14',
  snapshotLastDate:'2026-10-14',
  latestBackfill:{attempted:true,ok:false}};
const waiting=assess(stillQueued);
assert.equal(waiting.status,'ACTION_REQUIRED');
assert.deepEqual(waiting.issues,['PENDING_KRX_DATES','AUTOMATION_NOT_NORMAL']);
assert.equal(waiting.pendingCount,3);
assert.deepEqual(waiting.pendingSessionCounts,{open:2,closed:1,unknown:0});
assert.equal(waiting.lastBackfillOk,false);
// Oct 10 was KRX CLOSED. It cannot be used as an official KRX close date,
// but may still need a foreign/fund Snapshot. Do NOT clear it or mark healthy.
const holidayPending=assess({...good,pendingCount:1,pendingDates:['2026-10-10']});
assert.deepEqual(holidayPending.pendingSessionCounts,{open:0,closed:1,unknown:0});
assert.equal(holidayPending.status,'ACTION_REQUIRED');
assert.deepEqual(holidayPending.issues,['PENDING_KRX_DATES']);
assert.deepEqual(holidayPending.pendingDates,['2026-10-10']);
const mixedPending=assess({...good,pendingCount:2,
  pendingDates:['2026-10-10','2026-10-21']});
assert.deepEqual(mixedPending.pendingSessionCounts,{open:1,closed:1,unknown:0});
assert.deepEqual(mixedPending.pendingDates,['2026-10-10','2026-10-21']);
const unknownCalendar=assess({...good,pendingCount:1,
  pendingDates:['2028-01-04']});
assert.deepEqual(unknownCalendar.pendingSessionCounts,{open:0,closed:0,unknown:1});
assert.deepEqual(unknownCalendar.issues,
  ['PENDING_KRX_DATES','PENDING_KRX_SESSION_UNVERIFIED']);
assert.equal(unknownCalendar.status,'ACTION_REQUIRED');
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