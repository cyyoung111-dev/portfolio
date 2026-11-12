#!/usr/bin/env node
// #860 v9.292 read-only PRICE/NAV status proposal on exact deployed 9.291.
// Tests the actual generated GAS status function, not a duplicate mock.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {composeIssue860Gas9292CloseStatePreview} from './compose-issue860-gas9292-close-state-preview.mjs';
import {gasSourceBlobSha,extractExpectedGasVersion} from './deploy-gas.mjs';

function functions(source){
 const out=new Map();
 for(const m of source.matchAll(/^function ([A-Za-z_$][\w$]*)\s*\(/gm)){
  const end=source.indexOf('\n}',m.index);
  assert(end>m.index&&!out.has(m[1]),'FUNCTION_BOUNDARY_'+m[1]);
  out.set(m[1],source.slice(m.index,end+2));
 }
 return out;
}
const {parent,source,manifest}=composeIssue860Gas9292CloseStatePreview();
assert.equal(gasSourceBlobSha(parent),'e9311667d513c1e43a8ed1af326a3ecdb9d1ca70');
assert.equal(manifest.parentGitBlob,gasSourceBlobSha(parent));
assert.equal(manifest.candidateGitBlob,gasSourceBlobSha(source));
assert.equal(extractExpectedGasVersion(parent),'9.291');
assert.equal(extractExpectedGasVersion(source),'9.292');
assert.equal(manifest.sourceOnly,true);
assert.equal(manifest.deployable,false);
assert.equal(manifest.financeWrites,0);
new vm.Script(source,{filename:'issue860-9292-source-only.gs'});
const before=functions(parent),after=functions(source);
assert.deepEqual([...after.keys()].filter(x=>!before.has(x)),[],'NO_NEW_GAS_EXECUTION_PATHS');
const changed=[];
for(const [name,fn] of before){
 const updated=after.get(name);
 assert(updated,'MISSING_FUNCTION_'+name);
 if(updated.replaceAll("gasVersion: '9.292'","gasVersion: '9.291'")!==fn)changed.push(name);
}
assert.deepEqual(changed,['_getAutomationStatusData']);
for(const name of ['runDailyPortfolioClose1900','runPortfolioCloseWatchdog2030',
 '_issue860RecoverStoredPriceWatchdog_','runDeferredFundAfterPortfolioCloseFailure',
 '_recordPortfolioCloseStage','_portfolioCloseRunState','saveDailyPriceHistory',
 '_issue507GateEnter_','_issue507GateExit_'])
 assert.equal(after.get(name),before.get(name),'FINANCIAL_OR_RECOVERY_PATH_CHANGED_'+name);

const DATE='2026-11-11',OWNER='owner-860',MS=Date.now()-3600000;
const triggers={hasClean:true,hasMortgage:true,hasClose:true,
 hasWatchdog:true,hasBackfill:true,hasHistoricalBackfill:true,
 hasMidnightBackfill:true,hasMorningBackfill:true,
 hasIntegrityChange:true,hasIntegrityEdit:true,hasLedgerRebuild:true};
function diagnose({stage='FUND_PENDING',priceOk=true,fundOk=false,
 scheduled=true,expiry=false,wrongReservationOwner=false,
 wrongCloseOwner=false,fundError='',fundWarning='',closeErrors=[]}={}){
 const last={runDate:DATE,runId:OWNER,startedMs:MS,
  priceDate:DATE,priceRows:39,priceOk,fundOk,
  fundBusyTriggerId:'nav-uid',errors:closeErrors};
 const reservation={date:DATE,triggerId:'nav-uid',
  owner:{runId:wrongReservationOwner?'other-owner':OWNER,startedMs:MS},
  until:Date.now()+(expiry?-60000:60000),activeUntil:0,attempts:expiry?3:1};
 const props=new Map([
  ['portfolio_close_last_result',JSON.stringify(last)],
  ['portfolio_close_run_id',wrongCloseOwner?'foreign-owner':OWNER],
  ['portfolio_close_run_date',DATE],
  ['portfolio_close_stage',stage],
  ...(scheduled?[['fund_schedule',JSON.stringify(reservation)]]:[]),
  ...(fundError?[['fund_last_error',fundError]]:[]),
  ...(fundWarning?[['fund_last_warning',fundWarning]]:[])
 ]);
 const ctx=vm.createContext({
  CONFIG:{SHEET_SNAPSHOT:'SNAP',SHEET_PH:'PRICE',TIMEZONE:'Asia/Seoul'},
  PORTFOLIO_FUND_SCHEDULE_KEY:'fund_schedule',
  TRADE_SNAPSHOT_REBUILD_PENDING_KEY:'trade_pending',
  TRADE_SNAPSHOT_WORKER_LAST_KEY:'trade_last',
  TRADE_SNAPSHOT_WORKER_BUSY_KEY:'trade_busy',
  PropertiesService:{getScriptProperties:()=>({getProperty:k=>props.get(k)||null})},
  Utilities:{formatDate:()=>DATE+' 20:30:00'},
  getss:()=>({getSheetByName:()=>({})}),
  getCodeItems:()=>[],_ensureDailyTriggers:()=>triggers,
  _getLatestLifecycleValidSnapshotDate:()=>DATE,
  _getLatestDateInColumn:()=>DATE,
  _getOfficialKrxPriceHistoryLastDate:()=>DATE,
  _portfolioCloseRunState:()=>({
   state:stage==='COMPLETE'?'COMPLETE':stage==='ERROR'?'ERROR':'INCOMPLETE',
   stage,runDate:DATE
  }),
  _normalizeDate:x=>String(x||''),
  _fundAttemptDiagnosticState_:()=>null,
  _expectedConfirmedSnapshotDate:()=>DATE,
  _expectedPortfolioCloseRunDate:()=>DATE,
  _isPortfolioCloseRunStale:()=>false,
  _readPendingKrxCloseDates_:()=>[],
  _readTradeSnapshotDeferredState_:()=>({dates:[],cursor:''}),
  _tradeLedgerWriteUnverified_:()=>false,
  _getTradeSnapshotWorkerTriggerAudit_:()=>({}),
  _krxClosePublicationState_:()=>({waiting:false})
 });
 vm.runInContext(after.get('_getAutomationStatusData'),ctx);
 return JSON.parse(JSON.stringify(ctx._getAutomationStatusData()));
}
const pending=diagnose();
assert.equal(pending.overallStatus,'WARNING');
assert.equal(pending.closeRun.state,'INCOMPLETE','NAV PENDING never invents final COMPLETE');
assert.equal(pending.priceCloseState,'COMPLETE');
assert.equal(pending.fundCloseState,'PENDING');
assert.equal(pending.fundReservationVerified,true);
for(const v of [{scheduled:false},{expiry:true},{wrongReservationOwner:true}]){
 const result=diagnose(v);
 assert.equal(result.overallStatus,'INCOMPLETE','unverified NAV must not be normal');
 assert.equal(result.priceCloseState,'COMPLETE','preserve confirmed PRICE');
 assert.equal(result.fundCloseState,'NOT_COMPLETE');
 assert.equal(result.fundReservationVerified,false);
}
const wrongOwner=diagnose({wrongCloseOwner:true});
assert.equal(wrongOwner.priceCloseState,'INCOMPLETE');
assert.equal(wrongOwner.fundReservationVerified,false);
const failed=diagnose({fundError:'NAV failed'});
assert.equal(failed.overallStatus,'ERROR');
assert.equal(failed.fundCloseState,'NOT_COMPLETE');
const badPrice=diagnose({stage:'ERROR',priceOk:false,closeErrors:['PRICE_ERROR']});
assert.equal(badPrice.overallStatus,'ERROR');
assert.equal(badPrice.priceCloseState,'INCOMPLETE');
const complete=diagnose({stage:'COMPLETE',fundOk:true,scheduled:false});
assert.equal(complete.overallStatus,'NORMAL');
assert.equal(complete.priceCloseState,'COMPLETE');
assert.equal(complete.fundCloseState,'DONE');
const carriedNav=diagnose({stage:'COMPLETE',fundOk:true,scheduled:false,
 fundWarning:'NAV carried from prior official date'});
assert.equal(carriedNav.overallStatus,'WARNING');
assert.equal(carriedNav.fundCloseState,'DONE');
console.log(JSON.stringify({kind:'ISSUE860_9292_CLOSE_STATE_SOURCE_ONLY_PASS',
 originalVersion:'9.291',candidateVersion:'9.292',
 testedScenarios:10,protectedFinancialFunctions:9,
 parentBlob:manifest.parentGitBlob,candidateBlob:manifest.candidateGitBlob,
 ownerBoundNavPending:true,realNavErrorsPreserved:true,
 closeCompleteNotFaked:true,financeWrites:0,gasRequests:0,deployments:0}));
