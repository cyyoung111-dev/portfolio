import assert from 'node:assert/strict';
import {runDiagnosis,summarizeConflictDay,summarizeHolidaySnapshotRange,
  summarizePendingStatus} from './diagnose-holiday-snapshot-readonly.mjs';
const dates=['2026-09-15','2026-09-16','2026-10-08'];
const dup={groups:39,exactDuplicate:0,singleExpectedMatch:35,
  manualProtected:1,unresolvedConflict:3,sourceIncomplete:0};
const expected={
  status:'ok',diagnostics:dates.map((date,i)=>({
    date,status:i<2?'CONFLICT':'VALID',
    expectedRowCount:39,storedRowCount:i===0?77:i===1?156:39,
    duplicateSummary:i===2?{groups:0,exactDuplicate:0,singleExpectedMatch:0,
      manualProtected:0,unresolvedConflict:0,sourceIncomplete:0}:dup,
    missingCodes:[],unexpectedCodes:[],duplicateKeys:[],
    qtyMismatches:i===1?[{}]:[],
    costAmtMismatches:[],evalUnitMismatches:[],evalAmtMismatches:[],
    sourceMismatches:[],fundNavStates:[],sourceDataErrors:[]
  }))
};
assert.equal(summarizeHolidaySnapshotRange(expected)[1].qtyMismatchCount,1);
assert.equal(summarizeConflictDay(expected.diagnostics[0]).storedRows,77);
assert.throws(()=>summarizeHolidaySnapshotRange({...expected,diagnostics:[]}),
  /HOLIDAY_SNAPSHOT_INVALID_RESPONSE/);
assert.throws(()=>summarizeConflictDay({...expected.diagnostics[0],date:'2026-10-09'}),
  /HOLIDAY_SNAPSHOT_INVALID_DATE/);
const statusData={status:'ok',automation:{gasVersion:'9.230',
  overallStatus:'WARNING',pendingKrxCloseDates:['2026-10-09','2026-10-10','2026-10-11'],
  officialKrxPriceHistoryLastDate:'2026-10-15',snapshotLastDate:'2026-10-15'}};
assert.deepEqual(summarizePendingStatus(statusData).holidayPendingDates,
  ['2026-10-09','2026-10-10','2026-10-11']);
const requests=[];
const secret='NEVER_LOG_THIS_SECRET';
const endpoint='https://script.google.com/macros/s/safe-exec/exec';
const fake=async(_url,opts)=>{
  assert.equal(opts.method,'POST');
  const v=opts.body;
  requests.push({action:v.get('action'),date:v.get('date'),dates:v.get('dates')});
  const action=v.get('action');
  assert.ok(['getAutomationStatus','diagnoseSnapshotIntegrityRange',
    'getKrxSourceDiagnostics'].includes(action),'no GAS write action');
  if(v.get('accessToken')!==secret)
    return {ok:true,json:async()=>({status:'error',message:'인증 실패'})};
  if(action==='getAutomationStatus')return {ok:true,json:async()=>statusData};
  if(action==='diagnoseSnapshotIntegrityRange'){
    assert.equal(v.get('dates'),'2026-09-15,2026-09-16,2026-10-08');
    return {ok:true,json:async()=>expected};
  }
  return {ok:true,json:async()=>({status:'ok',requestedDate:v.get('date'),
    networkStatus:'RECEIVED',keyConfigured:true,
    storedCoverage:{status:'OK',expectedHeldCodes:37,officialExactDateCodes:0,
      snapshotRows:0,queuedForBackfill:true},markets:[]})};
};
const output=await runDiagnosis({url:endpoint,token:secret,fetchImpl:fake});
assert.equal(output.mode,'READ_ONLY');
assert.equal(output.holidays.length,3);
assert.deepEqual(requests.map(r=>r.action),[
  'getAutomationStatus','getAutomationStatus','diagnoseSnapshotIntegrityRange',
  'getKrxSourceDiagnostics','getKrxSourceDiagnostics','getKrxSourceDiagnostics'
]);
assert.deepEqual(output.holidays.map(r=>r.date),
  ['2026-10-09','2026-10-10','2026-10-11']);
assert.doesNotMatch(JSON.stringify(output),/NEVER_LOG_THIS_SECRET/);
console.log('Holiday/Snapshot read-only diagnosis: fixed actions, auth, aggregates, safety PASS');
