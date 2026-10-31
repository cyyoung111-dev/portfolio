#!/usr/bin/env node
import {isolateGasBusinessLogic} from './gas-business-fixture.mjs';
// Issue #507: execute the real GAS read-only CLOCK trigger audit under VM,
// and validate the production status sanitizer. Never access live Sheets.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {selfTest as testProcessAudit} from './issue507-worker-execution-audit.mjs';
import {summarizeBackfillStatus,assessWorkerRunCheckpoint} from './diagnose-backfill-status.mjs';

const source=isolateGasBusinessLogic(fs.readFileSync('src/gas/apps_script.gs','utf8'));
const name='_getTradeSnapshotWorkerTriggerAudit_';
const start=source.indexOf('function '+name+'('),end=source.indexOf('\n}',start);
assert.ok(start>=0&&end>start,'real GAS audit function missing');
const definition=source.slice(start,end+2);
assert.match(source,/tradeSnapshotWorkerTriggerAudit:\s*tradeSnapshotWorkerTriggerAudit/,
  'production automation response must expose the sanitized audit');

const worker='runPendingTradeSnapshotRebuild';
const clock=()=>({getHandlerFunction:()=>worker,getEventType:()=> 'CLOCK',
  getTriggerSource:()=> 'CLOCK',getUniqueId:()=> 'SECRET_TRIGGER_ID'});
const badEvent=()=>({...clock(),getEventType:()=> 'ON_EDIT'});
const badSource=()=>({...clock(),getTriggerSource:()=> 'SPREADSHEETS'});
const unknown=()=>({getHandlerFunction:()=>worker});
const unrelated=()=>({getHandlerFunction:()=> 'runPortfolioCloseBackfill2210'});
function run(triggers) {
  let read=0,write=0;
  const context=vm.createContext({
    ScriptApp:{EventType:{CLOCK:'CLOCK'},TriggerSource:{CLOCK:'CLOCK'},
      getProjectTriggers:()=>{read++;return triggers;},
      newTrigger:()=>{write++;throw Error('write prohibited');},
      deleteTrigger:()=>{write++;throw Error('write prohibited');}}
  });
  new vm.Script(definition).runInContext(context);
  const result=context[name]();
  assert.equal(read,1,'only one read of current-user trigger metadata');
  assert.equal(write,0,'audit must not edit triggers');
  assert.equal(result.scope,'CURRENT_USER');
  assert.ok(!JSON.stringify(result).includes('SECRET_TRIGGER_ID'),
    'trigger identifiers must never leak');
  return result;
}
const good=run([clock(),unrelated()]);
assert.equal(good.visibleCount,1);assert.equal(good.clockCount,1);
assert.equal(good.nonClockCount,0);assert.equal(good.unknownCount,0);
assert.equal(run([]).visibleCount,0);
assert.equal(run([badEvent()]).nonClockCount,1);
assert.equal(run([badSource()]).nonClockCount,1);
assert.equal(run([unknown()]).unknownCount,1);
assert.equal(run([clock(),clock()]).visibleCount,2);
assert.equal(run([badEvent(),unknown(),clock()]).clockCount,1);
assert.throws(()=>run([{...clock(),getEventType:()=>{throw Error('mock read failed')}}]),
  /mock read failed/,'metadata read failure must not become healthy');

const all={
  hasClose:true,hasWatchdog:true,hasBackfill:true,
  hasHistoricalBackfill:true,hasMidnightBackfill:true,
  hasIntegrityChange:true,hasIntegrityEdit:true,hasLedgerRebuild:true,
  hasClean:true,hasMortgage:true,hasMorningBackfill:true,
  closeCount:1,watchdogCount:1,backfillCount:1,historicalBackfillCount:1,
  midnightBackfillCount:1,morningBackfillCount:1,
  hasDuplicateCloseTriggers:false,hasDuplicateWatchdogTriggers:false,
  hasDuplicateBackfillTriggers:false,
  hasDuplicateHistoricalBackfillTriggers:false,
  hasDuplicateMidnightBackfillTriggers:false,
  hasDuplicateMorningBackfillTriggers:false,
  hasLegacySplitTriggers:false
};
function status(audit,version='9.244') {
  return {status:'ok',gasVersion:version,automation:{
    gasVersion:version,overallStatus:'WARNING',trigger:all,
    pendingKrxCloseDates:[],tradeLedgerWriteUnverified:false,
    pendingTradeSnapshotRebuildFrom:'2025-12-31',
    tradeSnapshotDeferredCount:0,tradeSnapshotDeferredOldestDate:'',
    tradeSnapshotWorkerLastResult:null,tradeSnapshotWorkerLastBusy:null,
    tradeSnapshotWorkerTriggerAudit:audit,
    officialKrxPriceHistoryLastDate:'2026-10-16',
    snapshotLastDate:'2026-10-16',priceHistoryLastDate:'2026-10-18'
  }};
}
const report=summarizeBackfillStatus(status({...good,sensitive:'SECRET_LEDGER'}));
assert.equal(report.tradeSnapshotWorkerTriggerAudit.clockReady,true);
assert.equal(report.tradeSnapshotWorkerTriggerAudit.scope,'CURRENT_USER');
assert.ok(!JSON.stringify(report).includes('SECRET_LEDGER'));
for(const [input,expected] of [
 [run([badEvent()]),false],[run([badSource()]),false],
 [run([unknown()]),false],[run([clock(),clock()]),false],
 [run([]),false]
]) {
 assert.equal(summarizeBackfillStatus(status(input)).tradeSnapshotWorkerTriggerAudit.clockReady,expected);
}
for (const audit of [null,{}, {...good,scope:'GLOBAL'},
  {...good,clockCount:2},{...good,unknownCount:-1},
  {...good,visibleCount:2},{...good,clockCount:'1'}]) {
 assert.throws(()=>summarizeBackfillStatus(status(audit)),
   /AUTOMATION_DIAG_BAD_WORKER_TRIGGER_AUDIT/);
}
assert.equal(summarizeBackfillStatus(status(undefined,'9.239'))
  .tradeSnapshotWorkerTriggerAudit,null,'pre-9.240 remains backward compatible');
// Real observed v9.244 checkpoint: 09:02 KST entry, 09:51 KST probe.
const observedAt=Date.parse('2026-10-20T00:51:55.000Z');
const staleWorker={status:'RUNNING',at:'2026-10-20T00:03:20.326Z',
  processed:0,deferred:0,blockedDate:'',sourceCheck:'',
  phase:'DATE_DISCOVERY',runStartedAt:'2026-10-20T00:02:31.413Z'};
assert.equal(assessWorkerRunCheckpoint(staleWorker,observedAt),
  'STALE_RUNNING_TIMEOUT_SUSPECTED');
assert.equal(assessWorkerRunCheckpoint({...staleWorker,
  runStartedAt:'2026-10-20T00:47:00.000Z',at:'2026-10-20T00:47:10.000Z'},observedAt),
  'RUNNING_RECENT_UNCONFIRMED');
assert.equal(assessWorkerRunCheckpoint({...staleWorker,runStartedAt:''},observedAt),
  'RUNNING_START_UNAVAILABLE');
assert.equal(assessWorkerRunCheckpoint({...staleWorker,
  runStartedAt:'2026-10-20T01:00:00.000Z'},observedAt),
  'FUTURE_START_UNVERIFIED');
assert.equal(assessWorkerRunCheckpoint({...staleWorker,status:'PENDING'},observedAt),
  'NOT_RUNNING');
assert.equal(assessWorkerRunCheckpoint(null,observedAt),'NO_CHECKPOINT');
assert.throws(()=>assessWorkerRunCheckpoint(staleWorker,-1),
  /AUTOMATION_DIAG_BAD_OBSERVATION_TIME/);
const staleResponse=status(good);
staleResponse.automation.tradeSnapshotWorkerLastResult=staleWorker;
assert.equal(summarizeBackfillStatus(staleResponse).tradeSnapshotWorkerRuntimeAssessment,
  'STALE_RUNNING_TIMEOUT_SUSPECTED');
assert.equal(summarizeBackfillStatus(status(good)).tradeSnapshotWorkerRuntimeAssessment,
  'NO_CHECKPOINT');
// Connect actual assessor emissions and actual persisted checkpoint encoding
// to the production read-only consumer. Unknown phases remain fail-closed.
const productionFunction=n=>{
  const m=source.match(new RegExp('function '+n+'\\([\\s\\S]*?\\n}', 'm'));
  assert.ok(m,'missing production function '+n);return m[0];
};
const emitted=new Set();
for(const writerFails of [false,true]) {
  const context=vm.createContext({
    TRADE_SNAPSHOT_WORKER_LAST_KEY:'checkpoint',
    PropertiesService:{getScriptProperties:()=>({setProperty:(_key,value)=>{
      const checkpoint=JSON.parse(value),input=status(good,'9.256');
      emitted.add(checkpoint.phase);
      input.automation.tradeSnapshotWorkerLastResult={...checkpoint,secret:'MUST_NOT_LEAK'};
      const output=summarizeBackfillStatus(input);
      assert.equal(output.tradeSnapshotWorkerLastResult.phase,checkpoint.phase);
      assert.equal(output.tradeSnapshotWorkerLastResult.blockedDate,'2026-02-25');
      assert.ok(!JSON.stringify(output).includes('MUST_NOT_LEAK'));
      assert.equal(assessWorkerRunCheckpoint(checkpoint,Date.parse(checkpoint.at)+600001),
        'STALE_RUNNING_TIMEOUT_SUSPECTED');
    }})},
    _buildSnapshotRangeReadContext:ss=>({ss}),
    diagnoseSnapshotIntegrity:()=>({status:'VALID',expectedRowCount:33,storedRowCount:33,
      duplicateKeys:[],sourceDataErrors:[]}),
    _rebuildDailySnapshotsLocked:()=>({errors:writerFails?['SYNTHETIC_ERROR']:[],skipped:0})
  });
  vm.runInContext(['_markTradeSnapshotWorkerResult_','_diagnoseTradeSnapshotWorkerDate_','_assessTradeSnapshotWorkerDate_']
    .map(productionFunction).join('\n'),context);
  const started=new Date().toISOString();
  context._assessTradeSnapshotWorkerDate_({},'2026-02-25',(phase,date)=>
    context._markTradeSnapshotWorkerResult_({status:'RUNNING',processed:0,
      phase,blockedDate:date,runStartedAt:started}));
}
assert.deepEqual([...emitted].sort(),['DATE_PRECHECK','DATE_PRECHECK_COMPLETE',
  'DATE_REBUILD','DATE_REBUILD_COMPLETE','DATE_POSTCHECK','DATE_POSTCHECK_COMPLETE',
  'DATE_FAILURE_RECHECK','DATE_FAILURE_RECHECK_COMPLETE'].sort());
const invalidPhase=status(good,'9.256');
invalidPhase.automation.tradeSnapshotWorkerLastResult={...staleWorker,phase:'UNTRUSTED_PHASE'};
assert.throws(()=>summarizeBackfillStatus(invalidPhase),
  /AUTOMATION_DIAG_BAD_LEDGER_WORKER_CHECKPOINT/);
console.log('Issue #507 real GAS CLOCK trigger audit and fail-closed read-only schema: PASS');

await testProcessAudit();
const auditSource=fs.readFileSync('scripts/issue507-worker-execution-audit.mjs','utf8')
  .replace("'./deploy-gas.mjs'",JSON.stringify(new URL('./deploy-gas.mjs',import.meta.url).href));
for(const [before,after] of [
  ["if(failed)issues.push('RECENT_WORKER_FAILURE')","if(false)issues.push('RECENT_WORKER_FAILURE')"],
  ['>3*60*60*1000','>300*60*60*1000'],
  ['pause,now,clock=Date.now','pause,now=Date.now(),clock=Date.now']
]){
  const mutated=auditSource.replace(before,after);
  assert.notEqual(mutated,auditSource);
  const module=await import('data:text/javascript;base64,'+Buffer.from(mutated).toString('base64'));
  await assert.rejects(()=>module.selfTest(),{name:'AssertionError'});
}
console.log('Issue #507 scheduled process health, bounded retries and workflow mutations: PASS');
