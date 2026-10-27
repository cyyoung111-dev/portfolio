import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync('src/gas/apps_script.gs','utf8');
const start=source.indexOf('function handleReconcileHistoricalCheckpoints('),end=source.indexOf('\n}',start)+2;
let now=2000000, values=new Map(),writes=0;
const props={getProperty:k=>values.get(k)||null,setProperty:(k,v)=>{writes++;values.set(k,v);}};
const ctx=vm.createContext({Date:{now:()=>now},PropertiesService:{getScriptProperties:()=>props},PORTFOLIO_FUND_LEASE_KEY:'fund',PORTFOLIO_CLOSE_BACKFILL_LEASE_KEY:'writer',_portfolioFundState_:(p,k)=>{try{return JSON.parse(p.getProperty(k)||'null');}catch{return null;}},_portfolioFundAtomic_:fn=>fn(props),jsonOk:r=>({status:'ok',...r}),jsonError:message=>({status:'error',message})});vm.runInContext(source.slice(start,end),ctx);
const key='portfolio_close_historical_0030_checkpoint_v1';
const running={runDate:'2026-10-24',startedAt:100000,finishedAt:null,state:'RUNNING',attempted:false,ok:null,deferred:false,reason:'STARTED'};
function reset(){values=new Map([['access_token','TEST'],[key,JSON.stringify(running)],['portfolio_close_historical_2310_checkpoint_v1',JSON.stringify({...running,state:'SUCCEEDED',finishedAt:200000,ok:true,reason:'COMPLETE'})],['pending_krx','PRIVATE_PENDING'],['portfolio_close_last_error','PRIVATE_ERROR']]);writes=0;}
reset();assert.equal(ctx.handleReconcileHistoricalCheckpoints('0').stale,1);assert.equal(writes,0);
reset();let r=ctx.handleReconcileHistoricalCheckpoints('1');assert.equal(r.reconciled,1);assert.equal(JSON.parse(values.get(key)).reason,'TIMEOUT');assert.equal(JSON.parse(values.get(key)).ok,false);assert.equal(values.get('pending_krx'),'PRIVATE_PENDING');assert.equal(values.get('portfolio_close_last_error'),'PRIVATE_ERROR');assert.equal(ctx.handleReconcileHistoricalCheckpoints('1').reconciled,0);assert.ok(values.get('historical_checkpoint_reconcile_backup_v1').includes('RUNNING'));
reset();values.set('writer',JSON.stringify({until:now+1}));assert.equal(ctx.handleReconcileHistoricalCheckpoints('1').message,'CHECKPOINT_WRITER_ACTIVE');assert.equal(writes,0);
reset();values.set(key,JSON.stringify({...running,startedAt:now-899999}));assert.equal(ctx.handleReconcileHistoricalCheckpoints('1').reconciled,0);assert.equal(writes,0);
reset();values.set('access_token','');assert.equal(ctx.handleReconcileHistoricalCheckpoints('1').message,'CHECKPOINT_AUTH_REQUIRED');assert.equal(writes,0);
assert.match(source,/params.action === 'reconcileHistoricalCheckpoints'\) return jsonError\('POST_ONLY'\)/);
console.log('Actual GAS checkpoint reconcile: dry-run, backup, old timeout, active writer, recent owner, idempotency, queue/error preservation PASS');

// Execute actual resume endpoint: immutable latest owner, lease exclusion,
// dry-run purity, real producer proof before scheduling, own lease cleanup.
{
 const extract=name=>{const p=source.indexOf('function '+name+'(');return source.slice(p,source.indexOf('\n}',p)+2);};
 let store=new Map(),producer=0,scheduled=0,continued=0;
 const p={getProperty:k=>store.get(k)||null,setProperty:(k,v)=>store.set(k,v),deleteProperty:k=>store.delete(k)};
 const cx=vm.createContext({Date:{now:()=>2000000},Utilities:{getUuid:()=> 'lease'},today:()=> '2026-10-24',
  PORTFOLIO_FUND_LEASE_KEY:'fund',PORTFOLIO_CLOSE_BACKFILL_LEASE_KEY:'writer',PORTFOLIO_FUND_SCHEDULE_KEY:'schedule',
  _krxClosePublicationState_:()=>({waiting:false}),_readPendingKrxCloseDates_:()=>[],
  _portfolioFundAtomic_:fn=>fn(p),_portfolioFundState_:(p,k)=>JSON.parse(p.getProperty(k)||'null'),
  jsonOk:x=>({status:'ok',...x}),jsonError:message=>({status:'error',message}),
  saveDailyPriceHistory:date=>{producer++;assert.equal(date,'2026-10-24');return {ok:true,date:'2026-10-23',rows:2,krxCloseRequired:false};},
  _scheduleFundAfterFailedPortfolioPrice_:owner=>{scheduled++;assert.equal(owner.runId,'current');assert.equal(owner.priceDate,'2026-10-23');},
  runDeferredFundAfterPortfolioCloseFailure:e=>{continued++;assert.equal(e.triggerUid,'uid');return {completionStatus:'ok'};}
 });
 vm.runInContext(extract('_portfolioCloseRunState')+'\n'+extract('_resumeFundCheckpoint_')+'\n'+extract('handleResumeIncompletePortfolioClose'),cx);
 const reset=()=>{store=new Map([['access_token','TEST'],['portfolio_close_run_date','2026-10-24'],['portfolio_close_run_started_ms','100000'],['portfolio_close_run_started_at','2026-10-24 19:00:00'],['portfolio_close_run_id','current'],['portfolio_close_stage','FUND']]);producer=scheduled=continued=0;};
 reset();assert.equal(cx.handleResumeIncompletePortfolioClose('0').mode,'DRY_RUN');assert.equal(producer,0);assert.equal(store.has('writer'),false);
 assert.equal(cx.handleResumeIncompletePortfolioClose('1').scheduled,true);assert.equal(producer,1);assert.equal(scheduled,1);assert.equal(store.has('writer'),false);
 reset();store.set('fund',JSON.stringify({until:2000001}));assert.equal(cx.handleResumeIncompletePortfolioClose('1').status,'error');assert.equal(producer,0);
 reset();store.set('portfolio_close_run_started_ms','1999999');assert.equal(cx.handleResumeIncompletePortfolioClose('1').status,'error');assert.equal(producer,0);
 reset();store.set('access_token','');assert.equal(cx.handleResumeIncompletePortfolioClose('1').status,'error');assert.equal(producer,0);
 reset();assert.equal(cx.handleResumeIncompletePortfolioClose('1','continue').status,'error');assert.equal(continued,0);
 store.set('schedule',JSON.stringify({date:'2026-10-24',owner:{runId:'current'},triggerId:'uid',until:3000000,attempts:0}));
 assert.equal(cx.handleResumeIncompletePortfolioClose('1','continue').continued,true);assert.equal(continued,1);assert.equal(producer,0);
 for(const pending of [{until:1999999,attempts:0},{until:3000000,attempts:3}]){
  continued=0;store.set('schedule',JSON.stringify({date:'2026-10-24',owner:{runId:'current'},triggerId:'uid',...pending}));
  assert.equal(cx.handleResumeIncompletePortfolioClose('0','continue').status,'error');
  assert.equal(cx.handleResumeIncompletePortfolioClose('1','continue').status,'error');assert.equal(continued,0);
 }
 store.set('schedule',JSON.stringify({date:'2026-10-24',owner:{runId:'current'},triggerId:'uid',until:3000000,attempts:0}));
 cx.runDeferredFundAfterPortfolioCloseFailure=()=>({skipped:true,reason:'RETRY_EXHAUSTED'});
 assert.equal(cx.handleResumeIncompletePortfolioClose('1','continue').status,'error','no false progress after expiry race');
 cx.runDeferredFundAfterPortfolioCloseFailure=()=>({skipped:true,conflict:'CONTINUATION'});
 assert.equal(cx.handleResumeIncompletePortfolioClose('1','continue').continued,true,'actual bounded progress remains resumable');

 reset();store.set('portfolio_close_stage','COMPLETE');store.set('portfolio_close_last_result',JSON.stringify({runId:'current',runDate:'2026-10-24',priceOk:true,fundOk:true,errors:[],startedAt:'2026-10-24 19:00:00'}));
 assert.equal(cx.handleResumeIncompletePortfolioClose('1').complete,true);assert.equal(producer,0,'healthy COMPLETE is a no-op');
 store.set('fund_last_warning','F00002 NAV 미확보');
 assert.equal(cx.handleResumeIncompletePortfolioClose('0').complete,false);assert.equal(producer,0,'warning preview remains pure');
 assert.equal(cx.handleResumeIncompletePortfolioClose('1').scheduled,true);assert.equal(producer,1,'warning recheck requires actual price producer');
 store.set('fund',JSON.stringify({until:2000001}));assert.equal(cx.handleResumeIncompletePortfolioClose('1').status,'error','completed warning cannot bypass active lease');
 reset();store.set('portfolio_close_stage','ERROR');store.set('portfolio_close_last_result',JSON.stringify({runId:'current',runDate:'2026-10-24',priceOk:false,fundOk:false,errors:['SOURCE_PENDING']}));
 cx._krxClosePublicationState_=()=>({waiting:true});
 cx._scheduleFundAfterFailedPortfolioPrice_=owner=>{scheduled++;assert.equal(owner.runId,'current');assert.equal(owner.priceOk,false);assert.equal(owner.errors[0],'SOURCE_PENDING');};
 const wait=cx.handleResumeIncompletePortfolioClose('1');assert.equal(wait.priceAwaitingPublication,true);assert.equal(wait.complete,false);assert.equal(producer,0,'source wait resumes NAV without retrying/relabeling stale PRICE');assert.equal(scheduled,1);
 assert.equal(JSON.parse(store.get('portfolio_close_last_result')).priceOk,false);



}
console.log('Actual GAS close resume: dry-run, exact owner/date, active lease, age, auth, reservation, independent continuation PASS');

// Both production completion paths clear only the canonical waiting errors.
{
 const extract=name=>{const p=source.indexOf('function '+name+'(');return source.slice(p,source.indexOf('\n}',p)+2);};
 let values=new Map();const props={getProperty:k=>values.get(k)||null,setProperty:(k,v)=>values.set(k,v),deleteProperty:k=>values.delete(k),setProperties:o=>Object.entries(o).forEach(([k,v])=>values.set(k,v))};
 const cx=vm.createContext({Date:class extends Date{static now(){return 2000000;}},CONFIG:{TIMEZONE:'Asia/Seoul'},LockService:{getScriptLock:()=>({hasLock:()=>true})},Utilities:{formatDate:()=> '2026-10-24 20:00:00'},PORTFOLIO_FUND_SUCCESS_KEY:'success',
 _portfolioFundAtomic_:fn=>fn(props),_portfolioFundState_:(p,k)=>JSON.parse(p.getProperty(k)||'null'),_fundPropertyText:String});
 vm.runInContext(extract('_reconcilePortfolioFundBusy_')+'\n'+extract('_recordPortfolioCloseStage'),cx);
 const owner={date:'2026-10-24',runId:'current',startedMs:100000,startedAt:'2026-10-24 19:00:00',priceOk:true};
 const reset=errors=>{const summary={...owner,runDate:owner.date,priceOk:true,fundOk:false,fundBusyTriggerId:'uid',errors};values=new Map([['portfolio_close_run_id','current'],['portfolio_close_run_date',owner.date],['portfolio_close_run_started_ms','100000'],['portfolio_close_run_started_at',owner.startedAt],['portfolio_close_stage','ERROR'],['portfolio_close_last_result',JSON.stringify(summary)],['success',JSON.stringify({date:owner.date,owner,at:2000000,token:'t',triggerId:'uid'})]]);return summary;};
 const waiting=['펀드: FUND_BUSY: FUND_CONTINUE','펀드: FUND_BUSY · 분할 재개 대기'];
 for(const error of waiting){
  let s=reset([error]);cx._reconcilePortfolioFundBusy_(owner.date);assert.equal(values.get('portfolio_close_stage'),'COMPLETE');assert.deepEqual(JSON.parse(values.get('portfolio_close_last_result')).errors,[]);
  s=reset([error]);assert.equal(cx._recordPortfolioCloseStage(props,owner.date,owner.startedAt,'ERROR','current',s,100000),true);assert.equal(values.get('portfolio_close_stage'),'COMPLETE');assert.equal(s.fundOk,true);assert.equal(s.errors.length,0);
 }
 reset([...waiting,'일반 종목: 실제 실패']);cx._reconcilePortfolioFundBusy_(owner.date);assert.equal(values.get('portfolio_close_stage'),'ERROR');assert.deepEqual(JSON.parse(values.get('portfolio_close_last_result')).errors,['일반 종목: 실제 실패']);
}
console.log('Production CLOSE summary and deferred NAV reconciliation: canonical continuation cleared, real errors preserved PASS');
