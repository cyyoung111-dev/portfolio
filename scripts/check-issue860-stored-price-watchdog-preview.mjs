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
assert.match(scheduler,/owner.issue860VerifiedPriceRecovery === true/);
assert.match(watchdog,/var priceRecovery=_issue860RecoverStoredPriceWatchdog_\(\);/);
assert(!/saveDailyPriceHistory|writeSnapshotRows|batchUpsertPriceHistory/.test(helper));
const date='2026-11-10';
const startedMs=Date.now()-20*60*1000;
let fields=new Map([
 ['portfolio_close_run_date',date],['portfolio_close_stage','PRICE'],
 ['portfolio_close_run_id','test-owner'],['portfolio_close_run_started_ms',String(startedMs)],
 ['portfolio_close_run_started_at','2026-11-10 19:33:00']
]);
const props={getProperty:key=>fields.get(key)||'',setProperty:(key,value)=>fields.set(key,String(value))};
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
  fields.set('portfolio_close_stage','FUND_PENDING');
  fields.set('portfolio_close_last_result',JSON.stringify({
    runId:owner.runId,runDate:owner.date,startedMs:owner.startedMs,
    priceOk:true,priceDate:owner.priceDate,fundOk:false,errors:[],
    fundBusyTriggerId:'tr_test'
  }));
  return {created:true,triggerId:'tr_test'};
 },
 _portfolioFundState_:(properties,key)=>{
  try{return JSON.parse(properties.getProperty(key)||'null');}catch{return null;}
 },
 PORTFOLIO_FUND_SCHEDULE_KEY:'test_portfolio_nav_schedule',
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
assert.equal(fields.get('portfolio_close_stage'),'FUND_PENDING');
// The next watchdog tick must never replay stored PRICE while NAV is pending.
fields.set('test_portfolio_nav_schedule',JSON.stringify({
  date,triggerId:'tr_test',until:Date.now()+600000,
  owner:{runId:'test-owner'}
}));
const navPending=ctx.runPortfolioCloseWatchdog2030();
assert.equal(navPending.reason,'PRICE_COMPLETE_NAV_PENDING');
assert.equal(navPending.priceWriterReplayed,false);
assert.equal(navPending.closeMarkedComplete,false);
assert.equal(navPending.fundOk,false);
assert.equal(auditCalls,1,'FUND_PENDING does not rebuild PRICE');
assert.equal(scheduled,1,'FUND_PENDING does not create duplicate NAV reservation');
fields.delete('test_portfolio_nav_schedule');
const unbooked=ctx._issue860RecoverStoredPriceWatchdog_();
assert.equal(unbooked.reason,'NAV_RESERVATION_NEEDS_REVIEW');
assert.equal(unbooked.priceWriterReplayed,false);
fields.set('portfolio_close_last_result',JSON.stringify({
  runId:'other-owner',runDate:date,startedMs,
  priceOk:true,priceDate:date,fundOk:false,errors:[]
}));
const orphan=ctx._issue860RecoverStoredPriceWatchdog_();
assert.equal(orphan.reason,'FUND_PENDING_OWNER_UNVERIFIED');
assert.equal(orphan.priceWriterReplayed,false);
// PRICE timeout scenarios are independent of the NAV-pending branch.
fields.set('portfolio_close_stage','PRICE');
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
assert.equal(ctx._issue860RecoverStoredPriceWatchdog_().reason,'FUND_PENDING_OWNER_UNVERIFIED');
fields.set('portfolio_close_stage','PRICE');
fields.set('portfolio_close_run_started_ms',String(Date.now()-1000));
assert.equal(ctx._issue860RecoverStoredPriceWatchdog_().reason,'PRICE_OWNER_STILL_WITHIN_LEASE');
assert.equal(scheduled,0);

console.log('PASS: watchdog separate verified PRICE vs pending NAV; lease/revision/raw duplicate/owner guards; no replay; not deployable');
