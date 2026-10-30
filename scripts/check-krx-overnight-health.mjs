import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {summarizeCloseStatus} from './diagnose-backfill-status.mjs';
import YAML from 'yaml';
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
// Publication is T+1 08:00 KST. The 02:30/06:57 check must not
// report an unexpected incident when the *only* missing row is yesterday's
// KRX official open-session close, and all evidence attributes it to KRX.
// Obtain a reachable waiting state from the production GAS source and the
// production read-only sanitizer, not an impossible synthetic close shape.
const gasSource=fs.readFileSync('src/gas/apps_script.gs','utf8');
const begin=gasSource.indexOf('function _krxClosePublicationState_(');
const finish=gasSource.indexOf('\nfunction _getAutomationStatusData()',begin);
assert.ok(begin>0&&finish>begin,'production publication detector must exist');
const productionContext={
  _fundDateOffset:(date,offset)=>new Date(Date.parse(date+'T00:00:00Z')+offset*86400000).toISOString().slice(0,10),
  _krxCalendarStatus_:date=>[0,6].includes(new Date(date+'T00:00:00Z').getUTCDay())?'CLOSED':'OPEN'
};
vm.createContext(productionContext);
vm.runInContext(gasSource.slice(begin,finish),productionContext);
const productionClose={
  runDate:'2026-10-29',priceOk:false,fundOk:true,
  errors:['일반 종목 확정 종가 원천일 불일치: 요청 2026-10-29, 실제 KRX 2026-10-28 · 정상 거래일 종가 이월 확정 금지']
};
const atMorning=new Date('2026-10-30T06:57:00+09:00');
const providerWaiting=productionContext._krxClosePublicationState_(
  productionClose,['2026-10-29'],atMorning.getTime());
assert.equal(providerWaiting.waiting,true);
assert.equal(providerWaiting.availableAfter,'2026-10-30T08:00:00+09:00');
const safePublicationClose=summarizeCloseStatus({
  portfolioClose:productionClose,
  closeRun:{state:'ERROR',stage:'ERROR',runDate:'2026-10-29'},
  fundAttempt:{state:'DONE'},
  portfolioCloseLastError:productionClose.errors.join(' | '),
  portfolioCloseRunStale:false,snapshotStale:false,
  krxPublication:providerWaiting,fundLastError:'',fundLastWarning:''
});
assert.equal(safePublicationClose.closeErrorCount,1);
assert.equal(safePublicationClose.krxPublicationWaiting,true);
assert.equal(safePublicationClose.stage,'ERROR');

const awaitingPublication={...good,close:safePublicationClose,overallStatus:'WARNING',
  pendingCount:1,pendingDates:['2026-10-29'],
  officialKrxPriceHistoryLastDate:'2026-10-28',snapshotLastDate:'2026-10-29',
  latestBackfill:{attempted:true,ok:false,failureClass:'KRX_PRICE_SOURCE_OR_COVERAGE'},
  latestHistoricalBackfill:{attempted:true,ok:false,failureClass:'KRX_PRICE_SOURCE_OR_COVERAGE'},
  historical2310:slot('2026-10-29','NO_WORK'),
  historical0030:slot('2026-10-30','FAILED')};
const publication=assessKrxOvernightHealth(awaitingPublication,{now:atMorning});
assert.equal(publication.status,'AWAITING_PROVIDER_PUBLICATION');
assert.equal(publication.publicationWaitTargetDate,'2026-10-29');
assert.deepEqual(publication.issues,['PENDING_KRX_DATES','AUTOMATION_NOT_NORMAL','HISTORICAL_0030_FAILED']);
assert.equal(assessKrxOvernightHealth(awaitingPublication,{now:new Date('2026-10-30T08:00:00+09:00')}).status,'ACTION_REQUIRED');
assert.equal(assessKrxOvernightHealth({...awaitingPublication,pendingDates:['2026-10-28','2026-10-29'],pendingCount:2},{now:atMorning}).status,'ACTION_REQUIRED');
assert.equal(assessKrxOvernightHealth({...awaitingPublication,
  latestHistoricalBackfill:{...awaitingPublication.latestHistoricalBackfill,failureClass:'BACKUP_SAFETY_FAILED'}},{now:atMorning}).status,'ACTION_REQUIRED');
assert.equal(assessKrxOvernightHealth({...awaitingPublication,triggerReady:false},{now:atMorning}).status,'ACTION_REQUIRED');
assert.equal(assessKrxOvernightHealth({...awaitingPublication,overallStatus:'ERROR'},{now:atMorning}).status,'ACTION_REQUIRED');
assert.equal(assessKrxOvernightHealth({...awaitingPublication,overallStatus:'INCOMPLETE'},{now:atMorning}).status,'ACTION_REQUIRED');
assert.equal(assessKrxOvernightHealth({...awaitingPublication,tradeLedgerWriteUnverified:true},{now:atMorning}).status,'ACTION_REQUIRED');
assert.equal(assessKrxOvernightHealth({...awaitingPublication,
  pendingTradeSnapshotRebuildFrom:'2026-10-29'},{now:atMorning}).status,'ACTION_REQUIRED');
assert.equal(assessKrxOvernightHealth({...awaitingPublication,officialKrxPriceHistoryLastDate:'2026-10-27'},
  {now:atMorning}).status,'ACTION_REQUIRED');
assert.equal(assessKrxOvernightHealth({...awaitingPublication,pendingDates:['2026-10-28']},
  {now:atMorning}).status,'ACTION_REQUIRED');
for(const brokenClose of [
  {...safePublicationClose,state:'INCOMPLETE'},
  {...safePublicationClose,state:'COMPLETE'},
  {...safePublicationClose,stage:'FUND'},
  {...safePublicationClose,priceOk:true},
  {...safePublicationClose,runDate:'2026-10-28'},
  {...safePublicationClose,fundErrorPresent:true},
  {...safePublicationClose,fundWarningPresent:true},
  {...safePublicationClose,fundState:'ERROR'},
  {...safePublicationClose,fundOk:false},
  {...safePublicationClose,closeErrorCount:0},
  {...safePublicationClose,closeErrorCount:-1},
  {...safePublicationClose,summaryRunDate:'2026-10-28'},
  {...safePublicationClose,krxPublicationWaiting:false},
  {...safePublicationClose,krxPublicationTradeDate:'2026-10-28'},
  {...safePublicationClose,krxPublicationAvailableAfter:'2026-10-31T08:00:00+09:00'},
  {...safePublicationClose,runStale:true},
  {...safePublicationClose,snapshotStale:true},
  null,
]) assert.equal(assessKrxOvernightHealth({...awaitingPublication,close:brokenClose},
  {now:atMorning}).status,'ACTION_REQUIRED',
  'independent close/fund errors or missing proof must not be silenced');


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
// An authenticated nightly workflow is NOT safe on a feature-branch
// workflow_dispatch. Check the actual workflow, not a copied test fixture.
const workflowPath='.github/workflows/krx-nightly-health.yml';
const authGate="github.ref == 'refs/heads/main' && (github.event_name == 'schedule' || github.event_name == 'workflow_dispatch')";
function assertNightlyWorkflowGuard(source) {
  const doc=YAML.parseDocument(source,{version:'1.2',uniqueKeys:true});
  assert.equal(doc.errors.length,0,'nightly workflow must parse');
  const wf=doc.toJS({maxAliasCount:0});
  assert.equal(wf.permissions?.contents,'read','nightly workflow read rights');
  assert.ok(wf.on && Object.hasOwn(wf.on,'workflow_dispatch'),'nightly manual event');
  assert.deepEqual(wf.on.schedule?.map(x=>x.cron),['30 17 * * *'],
    '02:30 KST nightly schedule must not drift');
  assert.ok(!Object.hasOwn(wf.on,'push'),'push must not run GAS secrets');
  assert.deepEqual(Object.keys(wf.jobs||{}),['check'],'no unguarded extra jobs');
  const job=wf.jobs.check;
  assert.equal(job.if,authGate,'nightly GAS credentialed job must be main-only');
  assert.equal(job.env,undefined,'credential only on reviewed read-only step');
  const credentialed=(job.steps||[]).filter(step=>
    String(step.env?.GAS_ACCESS_TOKEN||'').includes('secrets.GAS_ACCESS_TOKEN'));
  assert.equal(credentialed.length,1,'exactly one authenticated read-only step');
  assert.equal(credentialed[0].env.GAS_ACCESS_TOKEN,
    String.fromCharCode(36)+'{{ secrets.GAS_ACCESS_TOKEN }}');
  // P2: allow exactly the approved command, not a substring plus a
  // credentialed recovery invocation. Preserve the quoted output path.
  const expectedCommand='node scripts/diagnose-backfill-status.mjs > "'
    +String.fromCharCode(36)+'{RUNNER_TEMP}/krx-nightly-status.json"';
  assert.equal(String(credentialed[0].run||'').trim(),expectedCommand,
    'credentialed step must contain the single approved READ ONLY command');
  assert.deepEqual(Object.keys(credentialed[0].env).sort(),
    ['GAS_ACCESS_TOKEN','GAS_WEB_APP_URL'],'no recovery-control variables');
  assert.equal(credentialed[0].env.GAS_WEB_APP_URL,
    String.fromCharCode(36)+'{{ vars.GAS_WEB_APP_URL }}',
    'approved endpoint only');
}
const nightlySource=fs.readFileSync(workflowPath,'utf8');
assertNightlyWorkflowGuard(nightlySource);
for (const weaker of [
 "github.event_name == 'workflow_dispatch'",
 "github.ref == 'refs/heads/main'",
 "(github.event_name == 'schedule' || github.event_name == 'workflow_dispatch')",
]) {
 const mutated=nightlySource.replace(authGate,weaker);
 assert.notEqual(mutated,nightlySource);
 assert.throws(()=>assertNightlyWorkflowGuard(mutated),
   /nightly GAS credentialed job must be main-only/);
}
// Codex P2 regression: both a recovery command chained to the approved
// command and a recovery-control environment variable must fail closed.
const approvedCommand='node scripts/diagnose-backfill-status.mjs > "'
  +String.fromCharCode(36)+'{RUNNER_TEMP}/krx-nightly-status.json"';
const appendedRecovery=nightlySource.replace(approvedCommand,
  approvedCommand+'\n          node scripts/run-krx-targeted-recovery.mjs');
assert.notEqual(appendedRecovery,nightlySource,'must mutate actual YAML');
assert.throws(()=>assertNightlyWorkflowGuard(appendedRecovery),
  /single approved READ ONLY command/);
const extraRecoveryEnv=nightlySource.replace(
  '          GAS_ACCESS_TOKEN: '+String.fromCharCode(36)+'{{ secrets.GAS_ACCESS_TOKEN }}',
  '          GAS_ACCESS_TOKEN: '+String.fromCharCode(36)+'{{ secrets.GAS_ACCESS_TOKEN }}'+'\n          RECOVERY_APPLY: "true"');
assert.notEqual(extraRecoveryEnv,nightlySource,'must mutate actual env');
assert.throws(()=>assertNightlyWorkflowGuard(extraRecoveryEnv),
  /no recovery-control variables/);
console.log('KRX overnight health: read-only contract, queued/failed/mismatched/healthy checks PASS');