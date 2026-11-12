#!/usr/bin/env node
// No credentials, GAS writes or network: execute the proposed producer path in VM.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {composeIssue734Gas9294OwnerNavPreview}
 from './compose-issue734-gas9294-owner-nav-preview.mjs';

const {parent,source,manifest}=composeIssue734Gas9294OwnerNavPreview();
assert.equal(manifest.deployable,false);
assert.equal(manifest.manualReleaseRequired,true);
assert.equal(manifest.parentVersion,'9.293');
assert.equal(manifest.candidateVersion,'9.294');
assert.equal(manifest.financeWrites,0);
assert.equal(manifest.gasDeployments,0);
assert.equal(parent.includes('_issue734RecoveredCloseReservationOwner_'),false);
assert.match(source,/gasVersion: '9.294'/);
assert.equal(source.includes("gasVersion: '9.293'"),false);
const extract=name=>{
 const i=source.indexOf('function '+name+'(');
 const end=source.indexOf('\n}',i);
 assert(i>=0&&end>i,'ISSUE734_9294_FUNCTION_NOT_FOUND_'+name);
 return source.slice(i,end+2);
};
const helper=extract('_issue734RecoveredCloseReservationOwner_');
const retry=extract('_retryOnePendingKrxClose_');
const reconcile=extract('_reconcileRecoveredPortfolioPrice_');
assert.match(retry,/_issue734RecoveredCloseReservationOwner_\(sharedProps,target,result\)/);
assert.match(retry,/if \(!recoveredOwner\) _completePendingKrxCloseDate_/);
assert.match(retry,/BACKFILL_NAV_OWNER_READBACK_UNVERIFIED/);
assert.match(retry,/_scheduleFundAfterFailedPortfolioPrice_\(recoveredOwner\)/);

const DAY='2026-11-12',NEXT='2026-11-13';
const clock=Date.parse('2026-11-13T00:31:00Z'); // 09:31 KST
const started=Date.parse('2026-11-12T10:00:00Z'); // 19:00 KST
const proof={status:'VALID',expectedRowCount:39,storedRowCount:39};
const owner={
 portfolio_close_run_date:DAY,portfolio_close_run_id:'close-20261112',
 portfolio_close_run_started_ms:String(started),
 portfolio_close_run_started_at:'2026-11-12 19:00:00',
 portfolio_close_stage:'PRICE'
};
const prior={runId:'prior',runDate:'2026-11-11',
 priceOk:true,fundOk:true,errors:[]};
function scenario({propsPatch={},last=prior,failSchedule=false,
 currentDate=NEXT,includeToday=false,savedDate=DAY,verified=true}={}){
 const bag=new Map(Object.entries({...owner,...propsPatch,
   portfolio_close_last_result:JSON.stringify(last)}));
 let queue=[DAY],scheduleCount=0,policies=[],logs=[];
 const props={
   getProperty:k=>bag.has(k)?bag.get(k):null,
   setProperty:(k,v)=>bag.set(k,String(v)),
   deleteProperty:k=>bag.delete(k)
 };
 const ctx={
   Date:{now:()=>clock},
   PORTFOLIO_CLOSE_BACKFILL_RETRY_CURSOR_KEY:'cursor',
   PORTFOLIO_FUND_SCHEDULE_KEY:'nav_schedule',
   _readPendingKrxCloseDates_:()=>queue.slice(),
   saveDailyPriceHistory:()=>({ok:true,date:savedDate,rows:39,krxCloseRequired:true}),
   _portfolioFundAtomic_:fn=>fn(props),
   _portfolioFundState_:(p,key)=>{
     const raw=p.getProperty(key);try{return raw?JSON.parse(raw):null}catch{return null}
   },
   _fundPropertyText:s=>s,
   getss:()=>({}),
   _krxCalendarStatus_:()=> 'OPEN',
   _verifyCompletedKrxPendingDate_:()=>verified
     ?{ok:true,snapshotProof:proof}:{ok:false,reason:'BAD_PROOF'},
   diagnoseSnapshotIntegrity:()=>proof,
   _completePendingKrxCloseDate_:()=>{queue=[]},
   _appendPortfolioCloseSyncLog:(...args)=>logs.push(args),
   _scheduleFundAfterFailedPortfolioPrice_:o=>{
     scheduleCount++;
     if(failSchedule)throw Error('synthetic schedule error');
     const entry={date:o.date,triggerId:'nav-uid',owner:{runId:o.runId}};
     props.setProperty('nav_schedule',JSON.stringify(entry));
     props.setProperty('portfolio_close_stage','FUND_PENDING');
     props.setProperty('portfolio_close_last_result',JSON.stringify({
       runDate:o.date,runId:o.runId,startedAt:o.startedAt,
       startedMs:o.startedMs,priceOk:true,priceDate:o.priceDate,
       priceRows:o.priceRows,fundOk:false,errors:[],fundBusyTriggerId:'nav-uid'
     }));
     return {created:true,triggerId:'nav-uid'};
   }
 };
 vm.runInNewContext([helper,reconcile,retry].join('\n'),ctx);
 const wrappedReconcile=ctx._reconcileRecoveredPortfolioPrice_;
 ctx._reconcileRecoveredPortfolioPrice_=(...args)=>{
   policies.push(args[3]);return wrappedReconcile(...args);
 };
 const result=JSON.parse(JSON.stringify(ctx._retryOnePendingKrxClose_(
   props,currentDate,includeToday)));
 return {result,queue,policies,scheduleCount,logs,
   last:JSON.parse(props.getProperty('portfolio_close_last_result')),
   stage:props.getProperty('portfolio_close_stage')};
}

const recovered=scenario();
assert.equal(recovered.result.ok,true);
assert.deepEqual(recovered.policies,['CREATE']);
assert.equal(recovered.scheduleCount,1);
assert.equal(recovered.queue.length,0);
assert.equal(recovered.last.runDate,DAY);
assert.equal(recovered.last.runId,owner.portfolio_close_run_id);
assert.equal(recovered.last.priceOk,true);
assert.equal(recovered.last.fundOk,false,'scheduled NAV is never proof of completion');
assert.equal(recovered.stage,'FUND_PENDING');

const unreserved=scenario({failSchedule:true});
assert.equal(unreserved.result.ok,false);
assert.equal(unreserved.result.error,'BACKFILL_NAV_RESERVATION_UNVERIFIED');
assert.equal(unreserved.scheduleCount,1);
assert.deepEqual(unreserved.queue,[DAY],
 'failed NAV reservation cannot erase backed-up pending work');

const newer=scenario({propsPatch:{
 portfolio_close_run_date:NEXT,portfolio_close_run_id:'newer',
 portfolio_close_stage:'FUND_PENDING'
},last:{...prior,runDate:NEXT,runId:'newer'}});
assert.equal(newer.result.ok,true);
assert.equal(newer.scheduleCount,0);
assert.deepEqual(newer.policies,['CLEAN']);
assert.equal(newer.last.runDate,NEXT);

const existingNav=scenario({last:{runDate:DAY,runId:owner.portfolio_close_run_id,
  startedAt:owner.portfolio_close_run_started_at,startedMs:started,
  priceOk:false,fundOk:true,errors:[]},propsPatch:{portfolio_close_stage:'ERROR'}});
assert.equal(existingNav.result.ok,true);
assert.equal(existingNav.scheduleCount,0);
assert.equal(existingNav.last.fundOk,true);

const failedProof=scenario({verified:false});
assert.equal(failedProof.result.ok,false);
assert.equal(failedProof.scheduleCount,0);
assert.deepEqual(failedProof.queue,[DAY]);

const wrongOwner=scenario({propsPatch:{portfolio_close_run_date:NEXT,
  portfolio_close_run_id:'close-20261113'},last:prior});
assert.equal(wrongOwner.scheduleCount,0);
assert.deepEqual(wrongOwner.policies,['CLEAN']);

const dayOf=scenario({currentDate:DAY,includeToday:true});
assert.equal(dayOf.result.ok,true);
assert.equal(dayOf.scheduleCount,1);

const noId=scenario({propsPatch:{portfolio_close_run_id:''}});
assert.equal(noId.scheduleCount,0);

console.log(JSON.stringify({kind:'ISSUE734_GAS9294_CLOSE_NAV_OWNER_PREVIEW_PASS',
 scenarios:8,candidateBlob:manifest.candidateGitBlob,
 sourceOnly:true,financeWrites:0,gasDeployments:0}));
