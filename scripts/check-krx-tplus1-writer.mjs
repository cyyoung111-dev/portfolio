import {isolateGasBusinessLogic} from './gas-business-fixture.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=isolateGasBusinessLogic(fs.readFileSync('src/gas/apps_script.gs','utf8'));
function extract(name){
  const start=source.indexOf('function '+name+'(');
  assert.ok(start>=0,'production function missing: '+name);
  const end=source.indexOf('\n}',start);
  assert.ok(end>start,'function boundary missing: '+name);
  return source.slice(start,end+2);
}
const dateOffset=(day,n)=>{
  const d=new Date(day+'T00:00:00Z');
  d.setUTCDate(d.getUTCDate()+n);
  return d.toISOString().slice(0,10);
};
const closed=new Set(['2026-10-09','2026-10-10','2026-10-11','2026-10-17','2026-10-18']);
const calendar=day=>closed.has(day)?'CLOSED':/^2026-10-\d\d$/.test(day)?'OPEN':'UNKNOWN';
let nowDate='2026-10-19',time='0845',queue=['2026-10-09','2026-10-10','2026-10-16'];
let ready=true, sourceReads=0, writes=0, lastWrite=null;
const ctx=vm.createContext({
  today:()=>nowDate, _fundDateOffset:dateOffset,_krxCalendarStatus_:calendar,
  CONFIG:{TIMEZONE:'Asia/Seoul'},Utilities:{formatDate:()=>time},
  PropertiesService:{getScriptProperties:()=>({})},
  _readPendingKrxCloseDates_:()=>queue.slice(),
  handleGetKrxHeldCloseCoverage:date=>{
    sourceReads++;
    assert.equal(date,'2026-10-16');
    const coverage={requestedDate:date,ready,expectedHeldCodes:37,
      officialExactDateCodes:ready?37:36,missingCodes:ready?0:1,
      staleCodes:0,duplicateMasterCodes:0,orphanLedgerCodes:0};
    return {getContent:()=>JSON.stringify({status:'ok',coverage})};
  },
  _runPendingKrxBackfillWithLease_:(...args)=>{
    writes++;
    lastWrite=args;return {attempted:true,ok:true,date:args[5]};
  },
});
vm.runInContext(extract('runPortfolioMorningKrxBackfill0845'),ctx);
const call=()=>JSON.parse(JSON.stringify(ctx.runPortfolioMorningKrxBackfill0845()));
assert.equal(call().date,'2026-10-16');
assert.equal(writes,1);
assert.equal(lastWrite[1],'2026-10-19');
assert.equal(lastWrite[3],true);
assert.equal(lastWrite[4],null);
assert.equal(lastWrite[5],'2026-10-16');
ready=false;assert.equal(call().reason,'KRX_MORNING_AWAITING_PROVIDER_PUBLICATION');
assert.equal(writes,1,'source partial must not invoke the writer');
queue=['2026-10-09','2026-10-10'];
assert.equal(call().reason,'KRX_MORNING_NOT_PENDING');assert.equal(sourceReads,2);
queue.push('2026-10-16');ready=true;time='0829';
assert.equal(call().reason,'KRX_MORNING_OUTSIDE_WINDOW');assert.equal(writes,1);
time='0845';nowDate='2026-10-18';
assert.equal(call().reason,'KRX_MORNING_CLOSED_OR_UNKNOWN');assert.equal(writes,1);
nowDate='2026-10-19';

const state=new Map([['cursor','2026-10-09']]);
const props={getProperty:k=>state.get(k)??null,
  setProperty:(k,v)=>{state.set(k,v);},deleteProperty:k=>state.delete(k)};
let written=[];
const qctx=vm.createContext({
  _readPendingKrxCloseDates_:()=>queue.slice(),
  PORTFOLIO_CLOSE_BACKFILL_RETRY_CURSOR_KEY:'cursor',
  _krxCalendarStatus_:calendar,
  saveDailyPriceHistory:(date,opts)=>{
    written.push(date);
    assert.equal(opts.deferQueueCompletion,true);
    return {ok:true,date,rows:39,krxCloseRequired:true};
  },
  _portfolioFundAtomic_:fn=>fn(props),
  getss:()=>({}),
  _verifyCompletedKrxPendingDate_:()=>({ok:true,
    snapshotProof:{status:'VALID',expectedRowCount:39,storedRowCount:39}}),
  _reconcileRecoveredPortfolioPrice_:()=>true,
  _completePendingKrxCloseDate_:()=>{},
  diagnoseSnapshotIntegrity:()=>({status:'VALID',expectedRowCount:39,storedRowCount:39}),
  _appendPortfolioCloseSyncLog:()=>{},
});
vm.runInContext(extract('_retryOnePendingKrxClose_'),qctx);
const accepted=qctx._retryOnePendingKrxClose_(props,'2026-10-19',false,null,'2026-10-16');
assert.equal(accepted.ok,true);
assert.deepEqual(written,['2026-10-16']);
assert.equal(state.get('cursor'),'2026-10-09','morning must not advance night cursor');
queue=['2026-10-09','2026-10-10'];
written=[];
const skipped=qctx._retryOnePendingKrxClose_(props,'2026-10-19',false,null,'2026-10-16');
assert.equal(skipped.attempted,false);
assert.equal(written.length,0,'removed preferred date must not fall back to holiday queue');
assert.equal(state.get('cursor'),'2026-10-09');

assert.match(source,/function _ensurePortfolioMorningKrxBackfillTrigger\(autoFix\)/);
assert.match(source,/\.atHour\(8\)\.nearMinute\(45\)\.create\(\)/);
assert.match(source,/runPortfolioMorningKrxBackfill0845\(08:45\)/);

const selfHealBase={
  hasClean:true,hasSave:true,hasMortgage:true,hasFund:true,
  hasWatchdog:true,hasBackfill:true,hasHistoricalBackfill:true,
  hasMidnightBackfill:true,hasMorningBackfill:true,hasIntegrityChange:true,
  hasIntegrityEdit:true,hasLedgerRebuild:true,
  hasLegacySplitTriggers:false,hasDuplicateCloseTriggers:false,
  hasDuplicateWatchdogTriggers:false,hasDuplicateBackfillTriggers:false,
  hasDuplicateHistoricalBackfillTriggers:false,
  hasDuplicateMidnightBackfillTriggers:false,
  hasDuplicateMorningBackfillTriggers:false,
};
function runMorningSelfHeal(overrides,postOverrides={}) {
  const before={...selfHealBase,...overrides},after={...selfHealBase,...postOverrides};
  const records=new Map([['daily_triggers_checked_date',
    '2026-10-19|integrity-change-v8-close-watchdog-midnight-backfill']]);
  let repairCalls=0,scanCalls=0;
  const props={getProperty:k=>records.get(k)||null,
    setProperty:(k,v)=>records.set(k,v)};
  const healCtx=vm.createContext({
    PropertiesService:{getScriptProperties:()=>props},
    _ensureDailyTriggers:fix=>{
      if(fix){repairCalls++;return after;}scanCalls++;return before;
    },
    Logger:{log:()=>{}},
  });
  vm.runInContext(extract('_ensureDailyTriggersOncePerDay'),healCtx);
  const result=healCtx._ensureDailyTriggersOncePerDay('2026-10-19');
  assert.equal(scanCalls,1,'new v9 token must invalidate stale same-day cache');
  return {result:JSON.parse(JSON.stringify(result)),
    repairCalls,token:records.get('daily_triggers_checked_date')};
}
let heal=runMorningSelfHeal({hasMorningBackfill:false});
assert.equal(heal.repairCalls,1,'missing 08:45 trigger must be repaired');
assert.equal(heal.result.autoFixed,true);
assert.match(heal.token,/morning-tplus1\\|ledger-authority-v1$/);
heal=runMorningSelfHeal({hasDuplicateMorningBackfillTriggers:true});
assert.equal(heal.repairCalls,1,'duplicate 08:45 trigger must be repaired');
assert.equal(heal.result.autoFixed,true);
heal=runMorningSelfHeal({hasMorningBackfill:false},{hasMorningBackfill:false});
assert.equal(heal.repairCalls,1);
assert.doesNotMatch(heal.token,/morning-tplus1\\|ledger-authority-v1$/,
  'failed registration must not write a healthy checkpoint');
heal=runMorningSelfHeal({});
assert.equal(heal.repairCalls,0,'healthy trigger set must stay read-only');
assert.equal(heal.result.autoFixed,false);

console.log('T+1 morning writer and once-per-day trigger self-repair PASS');
