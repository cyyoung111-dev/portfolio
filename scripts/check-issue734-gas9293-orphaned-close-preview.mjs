#!/usr/bin/env node
// Preview-only production-function regression. No GAS API or Sheet calls.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {composeIssue734Gas9293OrphanedClosePreview}
 from './compose-issue734-gas9293-orphaned-close-preview.mjs';

const {parent,source,manifest}=composeIssue734Gas9293OrphanedClosePreview();
assert.equal(manifest.deployable,false);
assert.equal(manifest.manualReleaseRequired,true);
assert.equal(manifest.financeWrites,0);
assert.equal(manifest.gasDeployments,0);
assert.equal(manifest.parentVersion,'9.292');
assert.equal(manifest.candidateVersion,'9.293');
assert.match(source,/gasVersion: '9.293'/);
assert.match(source,/var ISSUE507_GATE_API_VERSION='9.293'/);
assert.equal(source.includes("gasVersion: '9.292'"),false);
assert.equal(parent.includes('_issue734SeedOrphanedCurrentClose_'),false);
assert.equal(source.split('_issue734SeedOrphanedCurrentClose_(ss, sharedProps, runDate);').length,2);
const name='_issue734SeedOrphanedCurrentClose_';
const start=source.indexOf('function '+name+'(');
const end=source.indexOf('\n}',start);
assert(start>=0&&end>start,'NEW_HELPER_NOT_EXTRACTED');
const helper=source.slice(start,end+2);

const now=Date.parse('2026-11-12T13:11:00Z'); // 22:11 KST
const props=(items)=>({getProperty:key=>items[key]??null});
const base={portfolio_close_run_date:'2026-11-12',portfolio_close_stage:'PRICE',
 portfolio_close_run_started_ms:String(now-3*60*60*1000)};
function exercise({values={},market='OPEN',rows=[],hasKrx=true,saved=true}={}){
 const entries=[];let snapshotReads=0;
 const ctx={
  Date:{now:()=>now},
  _krxCalendarStatus_:()=>market,
  _normalizeDate:d=>String(d||''),
  _readRawSnapshotRowsByDate_:()=>{throw Error('WRONG_FUNC');},
  _readRawSnapshotRowsByDate:()=>{snapshotReads++;return rows;},
  getCodeItems:()=>[{code:'005930'}],
  _hasKrxHoldingsForCloseDate_:()=>hasKrx,
  _enqueuePendingKrxCloseDate_:(p,d,allowClosed,urgent)=>{
   entries.push({date:d,allowClosed,urgent});return saved;
  }
 };
 vm.runInNewContext(helper,ctx);
 const result=ctx[name]({},props({...base,...values}),'2026-11-12');
 return {result:JSON.parse(JSON.stringify(result)),entries,snapshotReads};
}
const good=exercise();
assert.deepEqual(good.result,{queued:true,reason:'ORPHANED_DAY_QUEUED'});
assert.deepEqual(good.entries,[{date:'2026-11-12',allowClosed:true,urgent:true}]);
assert.equal(good.snapshotReads,1);
for(const [params,reason] of [
 [{market:'CLOSED'},'NON_KRX_SESSION'],
 [{values:{portfolio_close_run_date:'2026-11-11'}},'NO_SAME_DAY_OWNER'],
 [{values:{portfolio_close_stage:'COMPLETE'}},'NOT_ORPHANED_PHASE'],
 [{values:{portfolio_close_stage:'ERROR'}},'NOT_ORPHANED_PHASE'],
 [{values:{portfolio_close_run_started_ms:String(now-30*60*1000)}},'NOT_STALE'],
 [{values:{portfolio_close_run_started_ms:String(now+60*1000)}},'NOT_STALE'],
 [{values:{portfolio_close_run_started_ms:'0'}},'NOT_STALE'],
 [{rows:[['2026-11-12','005930']]},'SNAPSHOT_PRESENT_OR_PARTIAL'],
 [{hasKrx:false},'NO_KRX_HOLDINGS'],
 [{saved:false},'QUEUE_NOT_SAVED']
]){
 const item=exercise(params);
 assert.equal(item.result.reason,reason,reason);
 if(reason!=='QUEUE_NOT_SAVED')assert.equal(item.entries.length,0,reason);
}
const fundPhase=exercise({values:{portfolio_close_stage:'FUND'}});
assert.equal(fundPhase.result.queued,true);
const wrap=source.slice(source.indexOf('function _runPendingKrxBackfillWithLease_('),
 source.indexOf('\n}',source.indexOf('function _runPendingKrxBackfillWithLease_('))+2);
const seed=wrap.indexOf('_seedRecentMissingKrxSnapshotDays_(ss, sharedProps, runDate);');
const orphan=wrap.indexOf('_issue734SeedOrphanedCurrentClose_(ss, sharedProps, runDate);');
assert(seed>=0&&orphan>seed,'ORPHAN_HELPER_NOT_BEFORE_QUEUE_SELECTION');
const selector=wrap.indexOf('_retryOnePendingKrxClose_(props, runDate,');
assert(selector>orphan,'CURRENT_DATE_QUEUE_MUST_PRECEDE_CANDIDATE_PICK');
assert.match(wrap,/if \(acquired !== 'ACQUIRED'\) return/);
assert.match(wrap,/_portfolioFundAtomic_\(function\(sharedProps\)/);
console.log(JSON.stringify({kind:'ISSUE734_GAS9293_ORPHAN_BACKFILL_PREVIEW_PASS',
 regressionCases:12,candidateGitBlob:manifest.candidateGitBlob,queueOnly:true,liveWriteAuthorized:false,
 productionFinanceWrites:0,gasDeployments:0}));
