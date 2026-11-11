#!/usr/bin/env node
// #860: source-only watchdog must repair a timed-out close WITHOUT replaying
// persisted PRICE/Snapshot, and cannot promote NAV/close to COMPLETE.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {composeIssue860StoredPriceWatchdogPreview} from './compose-issue860-stored-price-watchdog-preview.mjs';

const {source,manifest}=composeIssue860StoredPriceWatchdogPreview();
assert.equal(manifest.parentVersion,'9.290');
assert.equal(manifest.deployable,false);
assert.equal(manifest.sourceOnly,true);
assert.equal(manifest.rawSnapshotRecomputed,true);
assert.equal(manifest.sourceRevisionGuard,true);
assert.equal(manifest.strictOwnerGuard,true);
assert.equal(manifest.priorPriceWriterReplayed,false);
const extract=name=>{
 const p=source.indexOf('function '+name+'('),q=source.indexOf('\n}',p);
 assert(p>=0&&q>p,name+' extracted');
 return source.slice(p,q+2);
};
const helper=extract('_issue860RecoverStoredPriceWatchdog_');
const watchdog=extract('runPortfolioCloseWatchdog2030');
const scheduler=extract('_scheduleFundAfterFailedPortfolioPrice_');
assert.match(scheduler,/ISSUE860_STORED_PRICE_OWNER_CHANGED/);
assert.match(scheduler,/ISSUE860_STORED_PRICE_SOURCE_CHANGED/);
assert.match(scheduler,/actualStage !== "PRICE"/);
assert.match(watchdog,/var priceRecovery=_issue860RecoverStoredPriceWatchdog_\(\);/);
assert(!/saveDailyPriceHistory|writeSnapshotRows|batchUpsertPriceHistory/.test(helper));
const date='2026-11-10';
const startedMs=Date.now()-20*60*1000;
let fields=new Map([
 ['portfolio_close_run_date',date],['portfolio_close_stage','PRICE'],
 ['portfolio_close_run_id','test-owner'],['portfolio_close_run_started_ms',String(startedMs)],
 ['portfolio_close_run_started_at','2026-11-10 19:33:00']
]);
const props={getProperty:key=>fields.get(key)||''};
let revisions=['rev-1','rev-1'],scheduled=0,auditCalls=0;
let audit={status:'VALID',expectedRowCount:39,storedRowCount:39,
 duplicateKeys:[],sourceDataErrors:[],priceIntegrity:[{status:'VALID'}]};
const ctx={
 PropertiesService:{getScriptProperties:()=>props},today:()=>date,
 _peekSnapshotIntegritySourceRevisionReadonly_:()=>revisions.shift()||'rev-1',
 diagnoseSnapshotIntegrity:(_ss,d)=>{
  assert.equal(d,date);auditCalls++;return audit;
 },
 getss:()=>({}),
 _scheduleFundAfterFailedPortfolioPrice_:owner=>{
  scheduled++;
  assert.equal(owner.runId,'test-owner');
  assert.equal(owner.priceOk,true);
  assert.equal(owner.priceDate,date);
  assert.equal(owner.fundPending,true);
  assert.equal(owner.issue860VerifiedPriceRecovery,true);
  assert.equal(owner.verifiedRevision,'rev-1');
  return {created:true,triggerId:'tr_test'};
 },
 _issue507GateInside_:true
};
vm.createContext(ctx);
vm.runInContext(helper+'\n'+watchdog,ctx);
const success=ctx.runPortfolioCloseWatchdog2030();
assert.equal(success.priceOk,true);
assert.equal(success.fundOk,false);
assert.equal(success.fundPending,true);
assert.equal(success.closeMarkedComplete,false);
assert.equal(success.priceEvidence,'RAW_SNAPSHOT_VERIFIED');
assert.equal(scheduled,1);
assert.equal(auditCalls,1);

scheduled=0;revisions=['rev-1','rev-2'];
assert.equal(ctx._issue860RecoverStoredPriceWatchdog_().reason,'STORED_PRICE_REVISION_CHANGED');
assert.equal(scheduled,0);
revisions=['rev-1','rev-1'];audit={...audit,status:'MISMATCH'};
assert.equal(ctx._issue860RecoverStoredPriceWatchdog_().reason,
 'STORED_PRICE_PRESENT_BUT_NOT_VALID');
assert.equal(scheduled,0);
audit={...audit,status:'NO_SNAPSHOT',storedRowCount:0,expectedRowCount:0};
revisions=['rev-1','rev-1'];
assert.equal(ctx._issue860RecoverStoredPriceWatchdog_(),null);
assert.equal(scheduled,0);
fields.set('portfolio_close_stage','FUND_PENDING');
assert.equal(ctx._issue860RecoverStoredPriceWatchdog_(),null);
fields.set('portfolio_close_stage','PRICE');
fields.set('portfolio_close_run_started_ms',String(Date.now()-1000));
assert.equal(ctx._issue860RecoverStoredPriceWatchdog_().reason,'PRICE_OWNER_STILL_WITHIN_LEASE');
assert.equal(scheduled,0);

console.log('PASS: watchdog separate verified PRICE vs pending NAV; lease/revision/raw duplicate/owner guards; no replay; not deployable');
