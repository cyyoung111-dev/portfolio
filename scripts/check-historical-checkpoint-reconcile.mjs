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
