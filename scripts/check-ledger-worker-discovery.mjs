import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {fixture} from './issue507-date-discovery-read-profile.mjs';

const gas=fs.readFileSync('src/gas/apps_script.gs','utf8');
assert.match(gas,/TIMEZONE:\s*['"]Asia\/Seoul['"]/);
const start=gas.indexOf('function _collectTradeSnapshotWorkerDates_(');
assert.ok(start>=0,'resumable production helper missing');
const code=gas.slice(start,gas.indexOf('\n}',start)+2);
function setup(rows=1200,production=code){
  const f=fixture(rows),properties=new Map();let time=0,revision='1',calls=0;
  const writes=[];
  f.ctx.PropertiesService={getScriptProperties:()=>({
    getProperty:k=>properties.get(k)||null,
    setProperty:(k,v)=>{assert.ok(v.length<=7500);properties.set(k,v);writes.push({key:k,value:v});},
    deleteProperty:k=>properties.delete(k)
  })};
  f.ctx._getSnapshotIntegritySourceRevision=()=>revision;
  f.ctx.Utilities.computeDigest=(_algorithm,value)=>Array.from(createHash('sha256').update(value).digest());
  f.ctx.Utilities.DigestAlgorithm={SHA_256:'sha256'};
  f.ctx.Date=class extends Date {static now(){return time;}};
  const get=f.ss.getSheetByName;
  f.ss.getSheetByName=name=>{
    const sheet=get(name);if(!sheet)return null;
    return {...sheet,getRange:(r,c,n,w)=>{
      assert.ok(n<=500,'unbounded source read');
      const range=sheet.getRange(r,c,n,w);
      return {getValues:()=>{calls++;time+=400;return range.getValues();}};
    }};
  };
  vm.runInContext(production,f.ctx);
  const step=()=>f.ctx._collectTradeSnapshotWorkerDates_(f.ss,'2026-01-16','2026-01-23',time+800);
  const finish=()=>{for(let i=0;i<100;i++){const x=step();if(x.complete)return x;}
    assert.fail('bounded scanner must eventually finish');};
  return {...f,properties,writes,step,finish,revision:v=>revision=v,calls:()=>calls,
    oracle:()=>f.ctx._collectDailySnapshotDates({getSheetByName:get},'2026-01-16','2026-01-23',{})};
}
{
  const f=setup();
  const first=f.step();assert.equal(first.complete,false);
  assert.ok(f.properties.has('trade_snapshot_date_scan_v1'));
  const saved=JSON.parse(f.properties.get('trade_snapshot_date_scan_v1'));
  assert.equal(saved.row,1002,'resume must retain the next unread row');
  const result=f.finish();
  // Independent oracle: the existing full collector preserves weekday and
  // explicit weekend/nav confirmation/dividend/FX/trade candidate behavior.
  const oracle=Object.keys(f.oracle()).sort();
  assert.deepEqual(Object.keys(result.dates).sort(),oracle);
  assert.equal(f.properties.size,0);assert.equal(f.mutations.length,0);
  assert.ok(f.writes.every(x=>x.key==='trade_snapshot_date_scan_v1'));
}
{
  const f=setup();f.step();
  // Same-size source edit does not change revision/shape. The second hash
  // pass must reject a mix of old and new source rows rather than use it.
  f.values.PRICE_HISTORY[0][0]='2026-01-18';
  let restarted=false;
  for(let i=0;i<60;i++){
    const x=f.step();assert.equal(x.complete,false,'changed source must not be used');
    if(!f.properties.size){restarted=true;break;}
  }
  assert.equal(restarted,true);
  assert.equal(f.finish().dates['2026-01-18'],true);
}
{
  const f=setup();f.step();f.revision('2');f.step();
  assert.match(JSON.parse(f.properties.get('trade_snapshot_date_scan_v1')).identity,/"2"/);
  assert.equal(f.finish().complete,true);
}
{
  const f=setup();f.step();f.values.PRICE_HISTORY.push(['2026-01-18']);
  assert.equal(f.finish().dates['2026-01-18'],true,'shape change must restart');
}
{
  const f=setup();f.step();
  f.values.FUND_NAV[0][1]='PRIVATE_FINANCIAL_PAYLOAD';
  f.finish();
  assert.ok(!JSON.stringify(f.writes).includes('PRIVATE_FINANCIAL_PAYLOAD'));
  assert.equal(f.mutations.length,0);
}
{
  const f=setup();Object.values(f.values).forEach(rows=>rows.splice(0));
  assert.deepEqual(Object.keys(f.finish().dates),[]);
  assert.equal(f.calls(),0);assert.equal(f.properties.size,0);
}
{
  const f=setup();
  f.ctx.Utilities.formatDate=(date,zone)=>new Intl.DateTimeFormat('en-CA',{
    timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
  // Sheets DATE at KST midnight is the previous UTC calendar date.
  f.values.PRICE_HISTORY[0][0]=new Date('2026-01-17T15:00:00Z');
  assert.equal(f.finish().dates['2026-01-18'],true);
  assert.equal(f.oracle()['2026-01-18'],true);
}
// Interrupted date discovery must not advance either the financial cursor
// or deferred dates. The actual worker retains both on a bounded yield.
const workerStart=gas.indexOf('function runPendingTradeSnapshotRebuild(');
const worker=gas.slice(workerStart,gas.indexOf('\n}',workerStart)+2);
{
  let changed=0,released=0;
  const ctx=vm.createContext({Date,PropertiesService:{getScriptProperties:()=>({setProperty:()=>changed++,deleteProperty:()=>changed++})},
    LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock:()=>released++})},
    _markTradeSnapshotWorkerResult_:x=>x,getss:()=>({getSheetByName:()=>({getLastRow:()=>10})}),
    CONFIG:{SHEET_SNAPSHOT:'SNAPSHOT'},_tradeLedgerWriteUnverified_:()=>false,
    _detectExternalTradeLedgerChanges_:()=>({state:'UNCHANGED'}),
    _readPendingTradeSnapshotRebuild:()=>({from:'2026-01-16'}),
    _readTradeSnapshotDeferredState_:()=>({dates:[],cursor:''}),
    _latestConfirmedSnapshotDate:()=> '2026-01-23',
    _collectTradeSnapshotWorkerDates_:()=>({complete:false}),Logger:{log:()=>{}}});
  vm.runInContext(worker,ctx);
  assert.equal(ctx.runPendingTradeSnapshotRebuild().status,'PENDING');
  assert.equal(changed,0);assert.equal(released,1);
}
console.log('Ledger worker bounded/resumable date discovery and source revalidation: PASS');
{
  const f=fixture(1200);let todayCalls=0;
  f.ctx.today=()=>{todayCalls++;return '2026-10-20';};
  f.ctx._collectDailySnapshotDates(f.ss,'2026-01-16','2026-01-23',{});
  assert.equal(todayCalls,1,'date collection must freeze KST day once');
  todayCalls=0;f.ctx._latestConfirmedSnapshotDate(f.ss,false);
  assert.equal(todayCalls,1,'latest-date scan must not format today per row');
}
assert.throws(()=>setup(1200,code.replace('Math.min(500,','Math.min(500000,')).step(),
  /unbounded source read/,'removing row cap must be detected');
{
  const f=setup(1200,code.replace('state.hash === state.expected','true'));
  f.step();f.values.PRICE_HISTORY[0][0]='2026-01-18';
  assert.equal(f.finish().dates['2026-01-18'],undefined,
    'mutation reproduces stale data if content revalidation is bypassed');
}
