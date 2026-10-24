import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import crypto from 'node:crypto';
import {runBacklog,selfTest} from './run-issue507-backlog.mjs';
const source=fs.readFileSync('src/gas/apps_script.gs','utf8');
function setup(options={}){
  const props=new Map([['access_token','TEST']]),calls=[];let financialWrites=0,held=false,reads=0;
  const dates=['2026-02-23','2026-02-24','2026-02-25'];
  const snap=(date,code,price=20,manual=false)=>[date,code,code==='000001'?'A':'B',1,10,10,price,price,price-10,(price-10)*10,manual?'MANUAL':'KRX',''];
  const tables={
    '종목코드':[['code','name','asset','market','currency'],['000001','A','주식','KR','KRW'],['000002','B','주식','KR','KRW']],
    '거래이력':[['date','type','account','name','code','qty','price','asset'],...['000001','000002'].map(c=>[dates[0],'buy','TEST',c==='000001'?'A':'B',c,1,10,'주식'])],
    '가격이력':[['date','code','name','price','at','source'],...dates.flatMap(d=>['000001','000002'].map(c=>[d,c,c==='000001'?'A':'B',20,'','KRX']))],
    '스냅샷':[['date','code','name','qty','costUnit','costAmt','price','eval','pnl','pct','source','at'],snap(dates[0],'000001'),snap(dates[0],'000002'),snap(dates[1],'000001',99,true),snap(dates[2],'000001'),snap(dates[2],'000002')],
    '보유현황':[['code','name','qty']], '설정':[['key','value'],['DIVDATA',JSON.stringify({A:{events:[{date:dates[1],payDate:dates[2]}]}})]]
  };
  const ss={getSheetByName:name=>{const a=tables[name];if(!a)return null;return {getLastRow:()=>a.length,getLastColumn:()=>Math.max(...a.map(r=>r.length)),getRange:(r,c,h,w)=>({getValues:()=>{reads++;return Array.from({length:h},(_,i)=>Array.from({length:w},(_,j)=>a[r+i-1]?.[c+j-1]??''));},setValues:()=>{financialWrites++;throw Error('FINANCIAL_WRITE');}})};}};
  const ctx=vm.createContext({Date,Logger:{log(){}},Utilities:{formatDate:d=>new Date(d).toISOString().slice(0,10),DigestAlgorithm:{SHA_256:'SHA_256'},computeDigest:(_a,s)=>[...crypto.createHash('sha256').update(s).digest()]},PropertiesService:{getScriptProperties:()=>({getProperty:k=>props.get(k)||null,setProperty:(k,v)=>{calls.push(k);if(options.failPendingClear&&k==='fail')throw Error('FAIL');props.set(k,v);},deleteProperty:k=>{if(options.failPendingClear&&k==='trade_snapshot_rebuild_pending_v1')throw Error('FAIL');props.delete(k);}})},LockService:{getScriptLock:()=>({tryLock:()=>{if(options.busy)return false;held=true;return true;},hasLock:()=>held,releaseLock:()=>{held=false;}})}});
  let code=source;
  if(options.omitManualGuard){const start=code.indexOf('    // Unique MANUAL rows');const end=code.indexOf('    if (missingExpectedWithHoldings(proof))',start);assert.ok(start>0&&end>start);code=code.slice(0,start)+code.slice(end);}
  vm.runInContext(code,ctx);ctx.today=()=> '2026-02-26';ctx.getss=()=>ss;ctx.jsonOk=x=>({status:'ok',...x});ctx.jsonError=message=>({status:'error',message});
  props.set(ctx.SNAPSHOT_INTEGRITY_SOURCE_REVISION_KEY,JSON.stringify({revision:1,all:1,dates:{},ranges:[]}));
  props.set(ctx.TRADE_SNAPSHOT_REBUILD_PENDING_KEY,JSON.stringify({from:'2026-02-24'}));
  props.set(ctx.TRADE_SNAPSHOT_DEFERRED_DATES_KEY,JSON.stringify({dates:['2026-02-23'],cursor:''}));
  if(options.unverified)ctx._tradeLedgerWriteUnverified_=()=>true;
  if(options.drift){let n=0;ctx._issue507StrictReadSourceDigest_=()=>String(++n);}
  ctx._getAutomationStatusData=()=>({tradeSnapshotDeferredCount:ctx._readTradeSnapshotDeferredState_().dates.length,pendingTradeSnapshotRebuildFrom:ctx._readPendingTradeSnapshotRebuild()?.from||''});
  return {ctx,props,tables,ss,calls,run:flag=>ctx.handleReconcileTradeSnapshotBacklog(flag),stats:()=>({financialWrites,held,reads})};
}
let f=setup(),original=JSON.stringify(f.tables),r=f.run('0');assert.equal(r.status,'ok',JSON.stringify(r));assert.equal(r.checkedDates,3);assert.equal(r.validDates,2);assert.equal(r.manualDates,1);assert.equal(r.projectedDeferred,1);assert.ok(f.props.has(f.ctx.TRADE_SNAPSHOT_REBUILD_PENDING_KEY));assert.equal(f.calls.length,0);
r=f.run('1');assert.equal(r.pendingCleared,true);assert.equal(r.deferredAfter,1);assert.deepEqual(JSON.parse(f.props.get(f.ctx.TRADE_SNAPSHOT_DEFERRED_DATES_KEY)).dates,['2026-02-24']);assert.ok(f.props.has('trade_snapshot_backlog_reconcile_backup_v1'));assert.equal(JSON.stringify(f.tables),original);assert.equal(f.stats().financialWrites,0);assert.equal(f.stats().held,false);assert.equal(f.run('1').pendingCleared,false);
for(const options of [{busy:true},{unverified:true},{drift:true}]){f=setup(options);const before=JSON.stringify([...f.props]);r=f.run('1');assert.equal(r.status,'error');assert.equal(JSON.stringify([...f.props]),before);assert.equal(f.stats().financialWrites,0);assert.equal(f.stats().held,false);}
f=setup({failPendingClear:true});r=f.run('1');assert.equal(r.status,'error');assert.ok(f.props.has(f.ctx.TRADE_SNAPSHOT_REBUILD_PENDING_KEY));assert.deepEqual(JSON.parse(f.props.get(f.ctx.TRADE_SNAPSHOT_DEFERRED_DATES_KEY)).dates,['2026-02-24'],'exceptions must survive a failed cursor clear');
f=setup();let writerCalls=0;f.ctx._rebuildDailySnapshotsLocked=()=>{writerCalls++;return {errors:[]};};r=f.ctx._assessTradeSnapshotWorkerDate_(f.ss,'2026-02-24');assert.equal(r.state,'DEFERRED');assert.equal(r.reason,'MANUAL_PROTECTED');assert.equal(writerCalls,0,'unique MANUAL rows must be preserved before the writer');
f=setup({omitManualGuard:true});writerCalls=0;f.ctx._rebuildDailySnapshotsLocked=()=>{writerCalls++;return {errors:[]};};f.ctx._assessTradeSnapshotWorkerDate_(f.ss,'2026-02-24');assert.equal(writerCalls,1,'pre-fix mutation must reach the financial writer for a unique MANUAL row');
f=setup();f.props.set(f.ctx.TRADE_SNAPSHOT_REBUILD_PENDING_KEY,JSON.stringify({from:'2026-03-01'}));r=f.run('1');assert.equal(r.pendingCleared,false);assert.ok(f.props.has(f.ctx.TRADE_SNAPSHOT_REBUILD_PENDING_KEY));assert.deepEqual(JSON.parse(f.props.get(f.ctx.TRADE_SNAPSHOT_DEFERRED_DATES_KEY)).dates,['2026-02-24']);
f=setup();f.props.set(f.ctx.TRADE_SNAPSHOT_DEFERRED_DATES_KEY,JSON.stringify({dates:['2026-03-01'],cursor:''}));r=f.run('1');assert.equal(r.message,'BACKLOG_FUTURE_DEFERRED');assert.ok(f.props.has(f.ctx.TRADE_SNAPSHOT_REBUILD_PENDING_KEY));
f=setup();const fetchImpl=async(_u,o)=>({ok:true,json:async()=>f.ctx.doPost({postData:{contents:String(o.body)}})});r=await runBacklog({url:'https://script.google.com/macros/s/TEST/exec',token:'TEST',apply:true,fetchImpl});assert.equal(r.pendingCleared,true);assert.equal(r.deferredAfter,1);assert.equal(r.originalDataWritten,false);assert.ok(!JSON.stringify(r).includes('000001'));assert.equal(f.stats().financialWrites,0);
const wf=fs.readFileSync('.github/workflows/issue-507-backlog-reconcile.yml','utf8');for(const text of ["github.ref == 'refs/heads/main'",'environment: portfolio-production-gas','APPROVED_PARENT: 9eecf0cec5fc165f14b21d35a9e6410e155af0eb','git cat-file -e',"github.event.workflow_run.event == 'workflow_run'"])assert.ok(wf.includes(text));
await selfTest();console.log('✅ #507 실제 backlog 전수 진단·큐 원자 순서·원천변화 보존·MANUAL 보호·실제 POST 통합');
