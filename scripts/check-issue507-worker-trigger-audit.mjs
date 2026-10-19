#!/usr/bin/env node
// Issue #507: execute the real GAS read-only CLOCK trigger audit under VM,
// and validate the production status sanitizer. Never access live Sheets.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {summarizeBackfillStatus} from './diagnose-backfill-status.mjs';

const source=fs.readFileSync('src/gas/apps_script.gs','utf8');
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
function status(audit,version='9.243') {
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
console.log('Issue #507 real GAS CLOCK trigger audit and fail-closed read-only schema: PASS');
