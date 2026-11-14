import {isolateGasBusinessLogic} from './gas-business-fixture.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {summarizeCloseStatus,classifyOvernightFundWarning} from './diagnose-backfill-status.mjs';
import YAML from 'yaml';
import {assessKrxOvernightHealth,describeWorkerCheckpointEvidence,describeFundCloseCheckpoint} from './assess-krx-overnight-health.mjs';

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
assert.equal(assess(good).snapshotDateAlignment,'DATES_MATCH');
assert.equal(assess(good).alertFocus,'NONE');
// Actual 2026-11-13 07:51 class of incident: complete price-date storage
// is different from authenticated GAS CLOSE owner/terminal proof.
const orphan20261112={
 ...good,gasVersion:'9.293',overallStatus:'INCOMPLETE',
 officialKrxPriceHistoryLastDate:'2026-11-12',
 snapshotLastDate:'2026-11-12',
 historical2310:slot('2026-11-12','NO_WORK'),
 historical0030:slot('2026-11-13','SUCCEEDED'),
 close:{state:'INCOMPLETE',stage:'PRICE',runDate:'2026-11-12',
   priceOk:true,fundOk:true,fundState:'DONE',fundErrorCode:'NONE'}
};
const observed=assessKrxOvernightHealth(orphan20261112,{
 now:new Date('2026-11-13T07:51:00+09:00')});
assert.equal(observed.status,'ACTION_REQUIRED',
 'never mask a persistently incomplete CLOSE marker');
assert.deepEqual(observed.issues,['AUTOMATION_NOT_NORMAL']);
assert.equal(observed.snapshotDateAlignment,'DATES_MATCH');
assert.equal(observed.alertFocus,'PERSISTED_CLOSE_FINALITY_UNVERIFIED');
assert.equal(observed.fundCloseCheckpointEvidence.closeState,'INCOMPLETE');
const rawDateDrift=assessKrxOvernightHealth({
 ...orphan20261112,snapshotLastDate:'2026-11-11'
},{now:new Date('2026-11-13T07:51:00+09:00')});
assert.equal(rawDateDrift.alertFocus,'MIXED_OR_UNVERIFIED');
assert.equal(rawDateDrift.snapshotDateAlignment,'SNAPSHOT_BEHIND_OFFICIAL');
assert(rawDateDrift.issues.includes('KRX_SNAPSHOT_STALE'));


const time=new Date('2026-10-19T02:40:00+09:00');
const workerLog={status:'RUNNING',at:'2026-10-18T17:35:00.000Z',
  processed:0,deferred:0,sourceCheck:'UNCHANGED',phase:'ENTRY'};
const syntheticWorker={...good,tradeSnapshotWorkerLastResult:workerLog,
  tradeSnapshotWorkerRuntimeAssessment:'RUNNING_RECENT_UNCONFIRMED',
  tradeSnapshotWorkerTriggerAudit:{scope:'CURRENT_USER',clockReady:true,
    visibleCount:1,clockCount:1,nonClockCount:0,unknownCount:0}};
const workerEvidence=describeWorkerCheckpointEvidence(syntheticWorker,{now:time});
assert.deepEqual(workerEvidence,{
  level:'GAS_SAVED_CHECKPOINT_ONLY',processApiExecutionVerified:false,
  snapshotIntegrityVerified:false,checkpointStatus:'RUNNING',
  checkpointAge:'WITHIN_3H',runtimeAssessment:'RUNNING_RECENT_UNCONFIRMED',
  triggerVisibility:'ONE_VISIBLE_CLOCK_TRIGGER'
});
const assessedWorker=assessKrxOvernightHealth(syntheticWorker,{now:time});
assert.deepEqual(assessedWorker.workerCheckpointEvidence,workerEvidence);
assert.equal(assessedWorker.status,'HEALTHY',
  'do not silently reinterpret existing KRX health gate from checkpoint-only evidence');
const staleWorker=describeWorkerCheckpointEvidence({...syntheticWorker,
  tradeSnapshotWorkerRuntimeAssessment:'STALE_RUNNING_TIMEOUT_SUSPECTED',
  tradeSnapshotWorkerLastResult:{...workerLog,at:'2026-10-18T11:35:00.000Z'},
  tradeSnapshotWorkerTriggerAudit:{scope:'CURRENT_USER',clockReady:false}}, {now:time});
assert.equal(staleWorker.checkpointAge,'OLDER_THAN_3H');
assert.equal(staleWorker.runtimeAssessment,'STALE_RUNNING_TIMEOUT_SUSPECTED');
assert.equal(staleWorker.triggerVisibility,'NOT_READY');
assert.equal(staleWorker.processApiExecutionVerified,false);
assert.equal(describeWorkerCheckpointEvidence(good,{now:time}).checkpointAge,'NOT_OBSERVED');
assert.equal(describeWorkerCheckpointEvidence(good,{now:time}).triggerVisibility,'NOT_OBSERVED');
assert.equal(describeWorkerCheckpointEvidence({...syntheticWorker,
  tradeSnapshotWorkerLastResult:{...workerLog,at:'2026-10-19T00:00:00.000Z'}},{now:time}).checkpointAge,
  'FUTURE_UNVERIFIED');
const privateMarker='DONT_LEAK_WORKER_SECRET_42';
const privacy=describeWorkerCheckpointEvidence({...syntheticWorker,
  tradeSnapshotWorkerLastResult:{status:privateMarker,at:'untrusted-value'},
  tradeSnapshotWorkerRuntimeAssessment:privateMarker,
  tradeSnapshotWorkerTriggerAudit:{scope:privateMarker,clockReady:true}},{now:time});
assert.equal(privacy.checkpointStatus,'UNVERIFIED');
assert.equal(privacy.runtimeAssessment,'UNVERIFIED');
assert.equal(privacy.triggerVisibility,'UNVERIFIED');
assert.equal(privacy.checkpointAge,'NOT_OBSERVED');
assert.doesNotMatch(JSON.stringify(privacy),/DONT_LEAK_WORKER_SECRET_42/);
// The same number of credentialed GAS calls is retained (single read-only
// getAutomationStatus workflow step); proof is a projection of its result.
const workerAssessorSource=fs.readFileSync('scripts/assess-krx-overnight-health.mjs','utf8');
assert.match(workerAssessorSource,/Worker 실제 프로세스 실행 증명 \| 미확인/);
assert.match(workerAssessorSource,/GAS_SAVED_CHECKPOINT_ONLY/);

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
const gasSource=isolateGasBusinessLogic(fs.readFileSync('src/gas/apps_script.gs','utf8'));
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
  tradeSnapshotDeferredCount:0,
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
assert.equal(assessKrxOvernightHealth({...awaitingPublication,tradeSnapshotDeferredCount:1},{now:atMorning}).status,'ACTION_REQUIRED');
assert.equal(assessKrxOvernightHealth({...awaitingPublication,
  tradeSnapshotWorkerTriggerAudit:{clockReady:false}},{now:atMorning}).status,'ACTION_REQUIRED');
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
  assert.deepEqual(wf.on.schedule?.map(x=>x.cron),['30 17 * * 1-6'],
    '02:30 KST Tue-Sun only, no Monday no-new-session audit');
  // UTC Mon-Sat 17:30 corresponds to KST Tue-Sun 02:30. Preserve Sunday
  // after US Friday close; skip KST Monday without disabling manual audit.
  assert.deepEqual([1,2,3,4,5,6].map(utcDow=>(utcDow+1)%7),[2,3,4,5,6,0]);
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
assert.throws(()=>assertNightlyWorkflowGuard(nightlySource.replace(
  "cron: '30 17 * * 1-6'","cron: '30 17 * * *'")),
  /02:30 KST Tue-Sun only/,'do not reintroduce Monday 02:30 no-new-session run');
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
// The existing single READ_ONLY getAutomationStatus already has the
// sanitized closeRun/fundAttempt and fund_resume_checkpoint. Publish its
// *fixed enums* without any new endpoint, write, or exposure of raw errors.
const closeEvidence={
 ...good,overallStatus:'ERROR',
 close:summarizeCloseStatus({
   portfolioClose:{runDate:'2026-10-18',priceOk:true,fundOk:false,
     errors:['SENSITIVE_HOLDING_OR_ACCOUNT_VALUE_42']},
   closeRun:{state:'ERROR',stage:'FUND',runDate:'2026-10-18'},
   fundAttempt:{state:'TIMEOUT_SUSPECTED',date:'2026-10-18'},
   fundLastError:'Apps Script 실행 시간 초과',
 }),
 fundResumeCheckpoint:{stage:'VALUATION',lastWorkStage:'navWrite',
   requestId:'0e6f130a-6eb9-4a47-8923-984928312174',atMs:1,
   elapsedMs:1000,sequence:3}
};
const fundEvidence=describeFundCloseCheckpoint(closeEvidence);
assert.deepEqual(fundEvidence,{
 level:'GAS_SAVED_CHECKPOINT_ONLY',processApiExecutionVerified:false,
 closeState:'ERROR',closeStage:'FUND',closeRunDate:'2026-10-18',
 priceOk:true,fundOk:false,fundAttemptState:'TIMEOUT_SUSPECTED',
 fundFailureClass:'TIMEOUT',fundWorkStage:'navWrite',
 fundResumeCheckpointPresent:true
});
assert.deepEqual(assessKrxOvernightHealth(closeEvidence,{now}).issues,
 ['AUTOMATION_NOT_NORMAL'],
 'reporting diagnostic evidence must not relax or tighten existing KRX gate');
assert.deepEqual(assessKrxOvernightHealth(closeEvidence,{now}).fundCloseCheckpointEvidence,
 fundEvidence);
const unsupported=describeFundCloseCheckpoint({
 close:{state:'SECRET_INSIDE_42',stage:'SECRET_INSIDE_42',
   fundState:'SECRET_INSIDE_42',fundErrorCode:'SECRET_INSIDE_42',
   runDate:'2026-10-18'},fundResumeCheckpoint:{lastWorkStage:'SECRET_INSIDE_42'}
});
assert.equal(unsupported.closeState,'UNVERIFIED');
assert.equal(unsupported.fundWorkStage,'UNVERIFIED');
assert.doesNotMatch(JSON.stringify(unsupported),/SECRET_INSIDE_42/);
assert.doesNotMatch(JSON.stringify(fundEvidence),
 /SENSITIVE_HOLDING_OR_ACCOUNT_VALUE_42|0e6f130a|accessToken|GAS_WEB_APP_URL/);
assert.equal(describeFundCloseCheckpoint(good).fundWorkStage,'NOT_REPORTED');
const nightlyAssessorSource=fs.readFileSync('scripts/assess-krx-overnight-health.mjs','utf8');
assert.match(nightlyAssessorSource,/펀드 마지막 단계/);
assert.doesNotMatch(nightlyAssessorSource,/action:['"](?:collectKbFundNav|resumeIncompletePortfolioClose|runDailyFundValuations)['"]/);
console.log('KRX overnight health: read-only contract, queued/failed/mismatched/healthy checks PASS');

// 2026-11-14 07:47 KST: live nightly KRX had 0 backlog, 11/13 aligned
// price/Snapshot, COMPLETE close + fund, NO_WORK recovery slots but a saved
// partial-fund NAV warning. KRX job must not fail on *that exact source-only*
// warning, while unknown or stale GAS conditions remain actionable.
{
 const observedAt=new Date('2026-11-14T07:47:00+09:00');
 const date='2026-11-13';
 const persisted={
  portfolioClose:{runDate:date,priceOk:true,fundOk:true,errors:[]},
  closeRun:{state:'COMPLETE',stage:'COMPLETE',runDate:date},
  fundAttempt:{date,state:'DONE'},
  portfolioCloseLastError:'',fundLastError:'',
  fundLastWarning:'F00001 부분 완료 | F00002 부분 완료',
  portfolioCloseRunStale:false,snapshotStale:false,
  expectedPortfolioCloseRunDate:date,expectedSnapshotDate:date
 };
 const goodClose=summarizeCloseStatus(persisted);
 assert.equal(goodClose.closeErrorCount,0);
 assert.equal(goodClose.fundWarningPresent,true);
 assert.equal(goodClose.fundErrorCode,'NONE');
 const warning=classifyOvernightFundWarning(persisted.fundLastWarning);
 assert.equal(warning,'PARTIAL_FUND_VALUATION');
 assert.equal(classifyOvernightFundWarning('NAV_MISSING'), 'NAV_PUBLICATION_OR_INPUT_PENDING');
 assert.equal(classifyOvernightFundWarning('Snapshot 보호 충돌: PRIVATE_DETAIL'),
  'SNAPSHOT_PROTECTED');
 assert.equal(classifyOvernightFundWarning('UNKNOWN_PRIVATE_USER_ACCOUNT_123'),
  'UNCLASSIFIED');
 const realShape={...good,gasVersion:'9.294',overallStatus:'WARNING',
  fundWarningClass:warning,
  officialKrxPriceHistoryLastDate:date,
  snapshotLastDate:date,priceHistoryLastDate:date,
  tradeSnapshotDeferredCount:0,
  historical2310:slot(date,'NO_WORK'),
  historical0030:slot('2026-11-14','NO_WORK'),
  latestBackfill:{attempted:false,ok:null},
  latestHistoricalBackfill:{attempted:true,ok:true},
  close:goodClose
 };
 const diagnose=x=>assessKrxOvernightHealth(x,{now:observedAt});
 const healthyKrx=diagnose(realShape);
 assert.equal(healthyKrx.status,'KRX_COMPLETE_FUND_NAV_WARNING_UNVERIFIED');
 assert.deepEqual(healthyKrx.issues,['AUTOMATION_NOT_NORMAL'],
  'preserve persisted overall WARNING evidence');
 assert.equal(healthyKrx.rawOverallStatus,'WARNING');
 assert.equal(healthyKrx.fundWarningClass,warning);
 assert.equal(healthyKrx.isolatedFundWarning,true);
 assert.equal(healthyKrx.alertFocus,'KRX_COMPLETE_FUND_NAV_WARNING_SEPARATE_REVIEW');
 assert.equal(healthyKrx.fundCloseCheckpointEvidence.processApiExecutionVerified,false);
 for(const change of [
  {fundWarningClass:'NONE'},
  {fundWarningClass:'UNCLASSIFIED'},
  {fundWarningClass:'SNAPSHOT_PROTECTED'},
  {close:{...goodClose,closeErrorPresent:true}},
  {close:{...goodClose,closeErrorCount:1}},
  {close:{...goodClose,fundErrorPresent:true}},
  {close:{...goodClose,fundErrorCode:'NAV_CONFLICT'}},
  {close:{...goodClose,fundState:'ERROR'}},
  {close:{...goodClose,runStale:true}},
  {close:{...goodClose,summaryRunDate:'2026-11-12'}},
  {close:{...goodClose,stage:'FUND'}},
  {close:{...goodClose,fundAttemptDate:'2026-11-12'}},
  {close:{...goodClose,expectedRunDate:'2026-11-12'}},
  {close:{...goodClose,fundWarningPresent:false}},
  {triggerReady:false},
  {pendingDates:[date],pendingCount:1},
  {tradeLedgerWriteUnverified:true},
  {pendingTradeSnapshotRebuildFrom:date},
  {tradeSnapshotDeferredCount:1},
  {snapshotLastDate:'2026-11-12'},
  {officialKrxPriceHistoryLastDate:'2026-11-12'},
  {priceHistoryLastDate:'2026-11-12'},
  {historical0030:slot('2026-11-14','FAILED')},
  {historical2310:slot('2026-11-13','DEFERRED')},
  {latestBackfill:{attempted:true,ok:false}},
  {latestHistoricalBackfill:{attempted:true,ok:false}},
  {overallStatus:'ERROR'},
  {overallStatus:'INCOMPLETE'}
 ]) {
  const got=diagnose({...realShape,...change});
  assert.equal(got.status,'ACTION_REQUIRED',
   'A changed GAS/Writer/KRX safety condition must not be concealed');
  assert.equal(got.isolatedFundWarning,false);
 }
 assert.equal(diagnose({...realShape,
  close:{...goodClose,closeState:'INCOMPLETE',state:'INCOMPLETE'}}).status,'ACTION_REQUIRED');
 assert.equal(diagnose({...realShape,
  fundWarningClass:'NAV_PUBLICATION_OR_INPUT_PENDING'}).status,
  'KRX_COMPLETE_FUND_NAV_WARNING_UNVERIFIED');
 assert.equal(diagnose({...realShape,overallStatus:'NORMAL',
  fundWarningClass:'NONE',close:{...goodClose,fundWarningPresent:false}}).status,'HEALTHY');
 assert.equal(assessKrxOvernightHealth(realShape,{
  now:new Date('2026-11-17T07:47:00+09:00')}).status,'ACTION_REQUIRED',
  'An old 11/13 close must never be called current on next Tuesday');
 // #734 2026-11-14 actual class: 11/13 owner COMPLETE, 39/39 date
 // alignment, empty queue and NO_WORK recovery slots, but the broader GAS
 // overallStatus was not NORMAL. That is NOT evidence of lost Snapshot.
 // Preserve red ACTION_REQUIRED for unclassified upstream WARNING/ERROR,
 // while naming precisely what did / did not pass.
 const unrelatedWarning=diagnose({...realShape,
  fundWarningClass:'UNCLASSIFIED',
  close:{...goodClose,fundWarningPresent:false}});
 assert.equal(unrelatedWarning.status,'ACTION_REQUIRED');
 assert.equal(unrelatedWarning.closeSavedCompleteButOverallNonNormal,true);
 assert.equal(unrelatedWarning.alertFocus,
  'CLOSE_SAVED_COMPLETE_UPSTREAM_STATUS_UNVERIFIED');
 assert.equal(unrelatedWarning.fundCloseCheckpointEvidence.closeState,'COMPLETE');
 assert.equal(unrelatedWarning.snapshotDateAlignment,'DATES_MATCH');
 assert.equal(unrelatedWarning.workerCheckpointEvidence.processApiExecutionVerified,false);
 const upstreamError=diagnose({...realShape,overallStatus:'ERROR',
  fundWarningClass:'UNCLASSIFIED',
  close:{...goodClose,fundWarningPresent:false}});
 assert.equal(upstreamError.status,'ACTION_REQUIRED');
 assert.equal(upstreamError.closeSavedCompleteButOverallNonNormal,true);
 for(const fail of [
  {close:{...goodClose,priceOk:false}},
  {close:{...goodClose,closeErrorPresent:true}},
  {close:{...goodClose,runStale:true}},
  {snapshotLastDate:'2026-11-12'},
  {pendingDates:[date],pendingCount:1},
  {historical0030:slot('2026-11-14','FAILED')},
  {tradeSnapshotDeferredCount:1}
 ]){
  const got=diagnose({...realShape,fundWarningClass:'UNCLASSIFIED',
   close:{...goodClose,fundWarningPresent:false},...fail});
  assert.equal(got.status,'ACTION_REQUIRED');
  assert.equal(got.closeSavedCompleteButOverallNonNormal,false,
   'a real CLOSE, queue, date or slot fault must not get the isolated label');
 }
 console.log('KRX_CLOSE_COMPLETE_UPSTREAM_UNVERIFIED_SPLIT_PASS no false loss, no green promotion');

 assert.doesNotMatch(JSON.stringify(healthyKrx),/PRIVATE_DETAIL|UNKNOWN_PRIVATE_USER_ACCOUNT/);
}
console.log('KRX nightly known fund NAV warning split: 33 fail-closed gates PASS');
