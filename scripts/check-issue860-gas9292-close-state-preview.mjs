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
assert.deepEqual(changed.sort(),['_getAutomationStatusData',
 '_issue507GateInvoke_','_issue507GateReconcile_'].sort());
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
// Actual source function regression: expired leases are archived without
// fabricating an execution success or modifying a financial status.
const NOW=Date.parse('2026-11-12T01:30:00Z');
class Clock extends Date{static now(){return NOW;}constructor(...a){super(...(a.length?a:[NOW]));}}
function gateFixture({oldMinutes=46,receipt=false,badArchive=false,saveFailure=false}={}){
 const old={name:'runDailyPortfolioClose1900',startedAt:NOW-oldMinutes*60000};
 const fresh={name:'doPost',startedAt:NOW-2*60000};
 const gate={releaseId:'release',mode:'OPEN',active:{old,fresh},
  completed:[],finished:0,barrierAt:NOW};
 const map=new Map([['issue507_writer_gate_v1',JSON.stringify(gate)]]);
 const key='issue507_writer_expired_unconfirmed_v1_old';
 if(badArchive)map.set(key,JSON.stringify({releaseId:'wrong',token:'old',
  name:old.name,startedAt:old.startedAt,state:'EXPIRED_UNCONFIRMED'}));
 if(receipt)map.set('issue507_writer_end_v1_old',JSON.stringify({
  releaseId:'release',token:'old',name:old.name,startedAt:old.startedAt,
  endedAt:NOW-5000,state:'ENDED',acknowledged:true
 }));
 const props={
  getProperty:k=>map.get(k)||null,
  getProperties:()=>Object.fromEntries(map),
  setProperty:(k,v)=>{if(saveFailure&&k==='issue507_writer_gate_v1')
    throw Error('SAVE_BLOCKED');map.set(k,String(v));},
  deleteProperty:k=>map.delete(k)
 };
 const ctx=vm.createContext({Date:Clock,JSON,Number,Object,
  _issue507GateEndKey_:token=>'issue507_writer_end_v1_'+token,
  _issue507GateSave_:(p,g)=>props.setProperty('issue507_writer_gate_v1',JSON.stringify(g))
 });
 vm.runInContext(after.get('_issue507GateReconcile_'),ctx);
 const run=()=>ctx._issue507GateReconcile_(props,JSON.parse(props.getProperty('issue507_writer_gate_v1')));
 return {run,props,map,key};
}
const expired=gateFixture();
expired.run();
const archive=JSON.parse(expired.props.getProperty(expired.key));
assert.equal(archive.state,'EXPIRED_UNCONFIRMED');
assert.equal(archive.producerReceipt,false);
const gateAfter=JSON.parse(expired.props.getProperty('issue507_writer_gate_v1'));
assert.equal(Object.keys(gateAfter.active).length,1);
assert.equal(gateAfter.active.fresh.name,'doPost');
assert.equal(gateAfter.finished,0,'never count timeout as an ENDED writer');
assert.equal(gateAfter.completed.length,0);
assert.equal(gateAfter.expiredUnconfirmedCount,1);
expired.run();
assert.equal(JSON.parse(expired.props.getProperty('issue507_writer_gate_v1')).expiredUnconfirmedCount,1,
 'next admission must be idempotent');
const live=gateFixture({oldMinutes:44});
live.run();
assert.equal(Object.keys(JSON.parse(live.props.getProperty('issue507_writer_gate_v1')).active).length,2,
 'active process under 45 minutes is protected');
const validReceipt=gateFixture({receipt:true});
validReceipt.run();
assert.equal(JSON.parse(validReceipt.props.getProperty('issue507_writer_gate_v1')).finished,1);
assert.equal(validReceipt.map.has(validReceipt.key),false,
 'valid producer receipt uses ENDED path, never timeout retirement');
const bad=gateFixture({badArchive:true});
assert.throws(()=>bad.run(),/GATE_EXPIRED_AUDIT_CONFLICT/);
assert.equal(Object.keys(JSON.parse(bad.props.getProperty('issue507_writer_gate_v1')).active).length,2);
const cannotSave=gateFixture({saveFailure:true});
assert.throws(()=>cannotSave.run(),/SAVE_BLOCKED/);
assert.equal(Object.keys(JSON.parse(cannotSave.props.getProperty('issue507_writer_gate_v1')).active).length,2,
 'unpersisted gate transition must preserve original active owner');

// One status probe must not register a new writer and must restore the
// reentrance flag even when the read throws.
const ingress=vm.createContext({_issue507GateInside_:false,
 _issue507GateEnter_:()=>{throw Error('WRITER_ENTER_FORBIDDEN');},
 _issue507GateExit_:()=>{throw Error('WRITER_EXIT_FORBIDDEN');},
 _issue507GateStatusRequest_:()=>({status:'ok'})});
vm.runInContext(after.get('_issue507GateInvoke_'),ingress);
assert.equal(ingress._issue507GateInvoke_('doPost',function(){
 assert.equal(ingress._issue507GateInside_,true);
 return 'STATUS_READ_OK';
 },null,[{parameter:{action:'getAutomationStatus'}}]),'STATUS_READ_OK');
assert.equal(ingress._issue507GateInside_,false);
assert.throws(()=>ingress._issue507GateInvoke_('doPost',()=>{
 throw Error('STATUS_HANDLER_FAILED');
 },null,[{parameter:{action:'getAutomationStatus'}}]),/STATUS_HANDLER_FAILED/);
assert.equal(ingress._issue507GateInside_,false);
assert.equal(ingress._issue507GateInvoke_('doGet',()=>{},null,[{parameter:{
 action:'getWriterGateStatus'}}]).status,'ok');

console.log(JSON.stringify({kind:'ISSUE860_9292_CLOSE_STATE_SOURCE_ONLY_PASS',
 originalVersion:'9.291',candidateVersion:'9.292',
 testedScenarios:16,protectedFinancialFunctions:9,\n gateTimeoutArchivedUnconfirmed:true,statusReadNoWriterToken:true,
 parentBlob:manifest.parentGitBlob,candidateBlob:manifest.candidateGitBlob,
 ownerBoundNavPending:true,realNavErrorsPreserved:true,
 closeCompleteNotFaked:true,financeWrites:0,gasRequests:0,deployments:0}));
