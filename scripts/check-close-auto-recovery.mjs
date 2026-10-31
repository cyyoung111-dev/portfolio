import {isolateGasBusinessLogic} from './gas-business-fixture.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';
const source=process.argv.includes('--baseline')
 ? execFileSync('git',['show','origin/main:src/gas/apps_script.gs'],{encoding:'utf8',maxBuffer:4000000})
 : isolateGasBusinessLogic(fs.readFileSync('src/gas/apps_script.gs','utf8'));
function fixture(start='2026-10-25T10:00:00Z') {
 let now=Date.parse(start),seq=0,held=false,navCalls=0,priceCalls=0;
 const bag=new Map(),triggers=[];
 const props={getProperty:k=>bag.get(k)||null,setProperty:(k,v)=>{bag.set(k,String(v));return props;},
  deleteProperty:k=>bag.delete(k),setProperties:o=>Object.entries(o).forEach(([k,v])=>bag.set(k,String(v)))};
 class Clock extends Date { constructor(...args){super(...(args.length?args:[now]));}static now(){return now;} }
 const format=d=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(d);
 const ctx=vm.createContext({Date:Clock,console,Logger:{log(){}},PropertiesService:{getScriptProperties:()=>props},
  LockService:{getScriptLock:()=>({hasLock:()=>held,waitLock:()=>{assert.equal(held,false);held=true;},releaseLock:()=>{held=false;}})},
  Utilities:{getUuid:()=>`id-${++seq}`,formatDate:(d,t,p)=>p==='yyyy-MM-dd'?format(d).slice(0,10):format(d)},
  ScriptApp:{getProjectTriggers:()=>triggers,deleteTrigger:t=>triggers.splice(triggers.indexOf(t),1),newTrigger:handler=>({timeBased(){return this;},everyMinutes(n){assert.equal(n,10);return this;},create(){const uid=`trigger-${++seq}`;const t={getUniqueId:()=>uid,getHandlerFunction:()=>handler};triggers.push(t);return t;}})}
 });
 vm.runInContext(source,ctx);
 ctx.today=()=>format(new Clock()).slice(0,10);
 for(const name of ['_ensurePortfolioCloseWatchdogTrigger','_ensurePortfolioCloseBackfillTrigger','_ensurePortfolioHistoricalBackfillTrigger','_ensurePortfolioHistoricalBackfill0010Trigger','_appendPortfolioCloseSyncLog'])ctx[name]=()=>{};
 ctx.saveDailyPriceHistory=()=>{priceCalls++;now+=90000;return{date:ctx.today(),rows:39,krxCloseRequired:false};};
 ctx._readPendingKrxCloseDates_=()=>[];ctx._completePendingKrxCloseDate_=()=>{};
 ctx.runDailyFundValuations=date=>{navCalls++;return{lastDate:date};};
 const close=()=>ctx.runDailyPortfolioClose1900();
 const pending=()=>JSON.parse(bag.get('portfolio_fund_deferred_schedule_v1')||'null');
 const fire=()=>vm.runInContext(`runDeferredFundAfterPortfolioCloseFailure({triggerUid:${JSON.stringify(pending()?.triggerId||'')}})`,ctx,{timeout:80});
 const crash=()=>vm.runInContext('runDailyFundValuations=function(){while(true){}}',ctx);
 const healthy=()=>ctx.runDailyFundValuations=date=>{navCalls++;return{lastDate:date};};
 return{ctx,bag,props,triggers,close,pending,fire,crash,healthy,advance:ms=>{now+=ms;},counts:()=>({navCalls,priceCalls}),resetLock:()=>{held=false;}};
}
{
 const f=fixture(),s=f.close();
 assert.equal(f.counts().navCalls,0,'PRICE success must never start NAV in its already-spent GAS execution');
 assert.equal(s.priceOk,true);assert.equal(s.fundOk,false);
 assert.equal(f.bag.get('portfolio_close_stage'),'FUND_PENDING');
 assert.equal(f.pending().owner.runId,s.runId);assert.equal(f.pending().owner.priceOk,true);
 assert.equal(f.ctx._portfolioCloseRunState(s,f.props).state,'INCOMPLETE');
 assert.equal(f.triggers.length,1);
 f.advance(10*60000);f.fire();
 const done=JSON.parse(f.bag.get('portfolio_close_last_result'));
 assert.equal(done.runId,s.runId);assert.equal(done.priceOk,true);assert.equal(done.fundOk,true);
 assert.equal(f.bag.get('portfolio_close_stage'),'COMPLETE');assert.equal(f.pending(),null);assert.equal(f.triggers.length,0);
 assert.equal(f.counts().priceCalls,1,'automatic continuation must reuse exact confirmed PRICE, not rerun it');
}
{
 const f=fixture('2026-10-25T14:50:00Z'),s=f.close(); // 23:50 KST
 f.advance(10*60000);f.crash();
 assert.throws(()=>f.fire(),/Script execution timed out/);
 assert.equal(f.pending().attempts,1);assert.ok(f.pending().activeUntil);
 assert.ok(f.bag.has('portfolio_fund_run_lease_v1'),'hardkill bypasses finally: shared lease survives');
 f.resetLock();f.healthy();f.advance(10*60000);f.fire();
 const done=JSON.parse(f.bag.get('portfolio_close_last_result'));
 assert.equal(done.runDate,'2026-10-25','after midnight, same owner date must finish');assert.equal(done.runId,s.runId);
 assert.equal(done.fundOk,true);assert.equal(f.bag.get('portfolio_close_stage'),'COMPLETE');
}
{
 const f=fixture();f.close();const uid=f.pending().triggerId;
 f.props.setProperty(f.ctx.PORTFOLIO_CLOSE_BACKFILL_LEASE_KEY,JSON.stringify({until:9999999999999}));
 f.advance(10*60000);f.fire();assert.equal(f.pending().attempts,0,'BUSY cannot consume a real failure attempt');
 f.props.deleteProperty(f.ctx.PORTFOLIO_CLOSE_BACKFILL_LEASE_KEY);
 f.ctx.runDailyFundValuations=()=>{const e=Error('FUND_CONTINUE');e.fundContinuation=true;throw e;};
 f.fire();assert.equal(f.pending().attempts,0,'bounded progress keeps next automatic opportunity');
 assert.equal(f.pending().triggerId,uid);f.healthy();f.advance(10*60000);f.fire();assert.equal(f.pending(),null);
}
for(const newer of [false,true]) {
 const f=fixture(),s=f.close();f.crash();
 for(let n=0;n<3;n++){f.advance(10*60000);assert.throws(()=>f.fire(),/Script execution timed out/);f.resetLock();}
 if(newer){f.props.setProperty('portfolio_close_run_id','new-owner');f.props.setProperty('portfolio_close_stage','PRICE');}
 f.advance(10*60000);f.fire();assert.equal(f.pending(),null);
 if(newer)assert.equal(f.bag.get('portfolio_close_stage'),'PRICE','exhausted old task must never overwrite new close');
 else{assert.equal(f.bag.get('portfolio_close_stage'),'ERROR');assert.match(f.bag.get('portfolio_close_last_error'),/FUND_RETRY_EXHAUSTED/);assert.equal(JSON.parse(f.bag.get('portfolio_close_last_result')).runId,s.runId);}
}
console.log('PASS: actual CLOSE→durable timer→hardkill→automatic retry→exact-owner COMPLETE; midnight, BUSY, continuation, exhaustion');
