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
 let queue=[DAY],scheduleCount=0,policies=[],logs=[],priceWriterCalls=0;
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
   saveDailyPriceHistory:()=>{priceWriterCalls++;return {ok:true,date:savedDate,rows:39,krxCloseRequired:true}},
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
 return {result,queue,policies,scheduleCount,priceWriterCalls,logs,
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
assert.equal(recovered.priceWriterCalls,0,'39/39 same-owner Snapshot must not be overwritten');

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
assert.equal(newer.priceWriterCalls,1,'unrelated close must retain backed-up price writer');

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

// Actual pre-replay prune must preserve an orphan whose NAV reservation failed,
// even when 39/39 PRICE/Snapshot evidence itself is already verified.
const prune=extract('_pruneVerifiedHistoricalKrxPending_');
const navGuard=extract('_issue734PendingCloseOwnerRequiresNav_');
assert.match(prune,/_issue734PendingCloseOwnerRequiresNav_\(sharedProps,date\)/);
function pruneScenario(complete){
 const state=new Map(Object.entries({
   ...owner,
   portfolio_close_stage:complete?'COMPLETE':'ERROR',
   portfolio_close_last_result:JSON.stringify(complete
     ?{...unreserved.last,runDate:DAY,runId:owner.portfolio_close_run_id,
       priceOk:true,priceDate:DAY,fundOk:true,errors:[]}
     :unreserved.last),
   lease:JSON.stringify({token:'lease-uid',until:clock+600000}),
   pending:JSON.stringify([DAY])
 }));
 const props={
   getProperty:k=>state.has(k)?state.get(k):null,
   setProperty:(k,v)=>state.set(k,String(v)),
   deleteProperty:k=>state.delete(k)
 };
 const ctx={
   Date:{now:()=>clock},
   PORTFOLIO_CLOSE_BACKFILL_LEASE_KEY:'lease',
   PORTFOLIO_CLOSE_BACKFILL_PRUNE_CURSOR_KEY:'cursor',
   PORTFOLIO_CLOSE_PENDING_KRX_DATES_KEY:'pending',
   _portfolioFundAtomic_:fn=>fn(props),
   _portfolioFundState_:(p,k)=>{
     try{return JSON.parse(p.getProperty(k)||'null')}catch{return null}
   },
   _readPendingKrxCloseDates_:()=>JSON.parse(props.getProperty('pending')),
   _krxCalendarStatus_:()=> 'OPEN',
   _verifyCompletedKrxPendingDate_:()=>({ok:true,verifiedCodes:37}),
   getss:()=>({})
 };
 vm.runInNewContext([navGuard,prune].join('\n'),ctx);
 const result=JSON.parse(JSON.stringify(
   ctx._pruneVerifiedHistoricalKrxPending_('lease-uid',NEXT)));
 return {result,pending:JSON.parse(props.getProperty('pending'))};
}
const stillNeedsNav=pruneScenario(false);
assert.equal(stillNeedsNav.result.cleared,0);
assert.deepEqual(stillNeedsNav.pending,[DAY],
 'a scheduled retry must still see the orphan after NAV reservation fails');
const fullyClosed=pruneScenario(true);
assert.equal(fullyClosed.result.cleared,1);
assert.deepEqual(fullyClosed.pending,[],
 'a separately confirmed same-owner COMPLETE may be pruned');


// Empty pending queue + exact orphaned 39-row Snapshot: nightly worker must
// admit the exact owner so retry can reuse the stored proof and schedule NAV.
const orphanSeed=extract('_issue734SeedOrphanedCurrentClose_');
const leased=extract('_runPendingKrxBackfillWithLease_');
assert.match(orphanSeed,/VERIFIED_SNAPSHOT_OWNER_QUEUED/);
assert.match(retry,/if \(!result\) result = saveDailyPriceHistory/);

function seedScenario({date=DAY,nowDate=NEXT,stored=true,valid=true,
 stage='PRICE',startedMs=started,last=prior,ownerId='close-20261112',
 market='OPEN'}={}){
 let queued=[],proofCalls=0;
 const map=new Map(Object.entries({...owner,
   portfolio_close_run_date:date,
   portfolio_close_stage:stage,
   portfolio_close_run_id:ownerId,
   portfolio_close_run_started_ms:String(startedMs),
   portfolio_close_last_result:JSON.stringify(last)}));
 const props={getProperty:k=>map.get(k)??null,
  setProperty:(k,v)=>map.set(k,String(v)),deleteProperty:k=>map.delete(k)};
 const ctx={
   Date:{now:()=>clock},
   _krxCalendarStatus_:()=>market,
   _portfolioFundState_:(p,key)=>JSON.parse(p.getProperty(key)||'null'),
   _readRawSnapshotRowsByDate:()=>stored?[['row']]:[],
   _verifyCompletedKrxPendingDate_:()=>{
     proofCalls++;
     return valid?{ok:true,snapshotProof:proof}:{ok:false,reason:'BAD_SNAPSHOT'};
   },
   _hasKrxHoldingsForCloseDate_:()=>true,
   getCodeItems:()=>[],
   _enqueuePendingKrxCloseDate_:(p,day)=>{queued.push(day);return true}
 };
 vm.runInNewContext(orphanSeed,ctx);
 const result=JSON.parse(JSON.stringify(
   ctx._issue734SeedOrphanedCurrentClose_({},props,nowDate)));
 return {result,queued,proofCalls};
}
const verifiedYesterday=seedScenario();
assert.equal(verifiedYesterday.result.queued,true);
assert.deepEqual(verifiedYesterday.queued,[DAY]);
assert.equal(verifiedYesterday.result.reason,'VERIFIED_SNAPSHOT_OWNER_QUEUED');
assert.equal(verifiedYesterday.proofCalls,1);
const verifiedToday=seedScenario({nowDate:DAY});
assert.equal(verifiedToday.result.queued,true);
assert.equal(seedScenario({valid:false}).result.queued,false);
assert.deepEqual(seedScenario({valid:false}).queued,[]);
assert.equal(seedScenario({date:DAY,nowDate:NEXT,stored:false}).result.queued,false);
assert.equal(seedScenario({date:DAY,nowDate:DAY,stored:false}).result.queued,true);
assert.equal(seedScenario({date:NEXT,nowDate:DAY}).result.queued,false);
assert.equal(seedScenario({ownerId:''}).result.queued,false);
assert.equal(seedScenario({startedMs:clock-120000}).result.queued,false);
assert.equal(seedScenario({stage:'COMPLETE'}).result.queued,false);
assert.equal(seedScenario({market:'CLOSED'}).result.queued,false);
assert.equal(seedScenario({last:{runDate:DAY,runId:owner.portfolio_close_run_id,
 priceOk:true,fundOk:true,errors:[]}}).result.queued,false);

console.log(JSON.stringify({kind:'ISSUE734_GAS9294_CLOSE_NAV_OWNER_PREVIEW_PASS',
 scenarios:22,candidateBlob:manifest.candidateGitBlob,
 verifiedSnapshotFastPath:true,seededWithoutPendingQueue:true,
 sourceOnly:true,financeWrites:0,gasDeployments:0}));
