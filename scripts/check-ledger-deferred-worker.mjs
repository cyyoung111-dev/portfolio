import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const gas = fs.readFileSync('src/gas/apps_script.gs','utf8');
function prod(name) {
  const match = gas.match(new RegExp('function ' + name + '\\([\\s\\S]*?\\n}', 'm'));
  assert.ok(match,'missing real GAS worker implementation: '+name);
  return match[0];
}
const names=[
  '_readTradeSnapshotDeferredState_','_writeTradeSnapshotDeferredState_',
  '_deferTradeSnapshotDate_','_clearTradeSnapshotDeferredDate_',
  '_markTradeSnapshotWorkerResult_','_assessTradeSnapshotWorkerDate_',
  'runPendingTradeSnapshotRebuild'
];
const compiled=names.map(prod).join('\n');
assert.match(gas,/TRADE_SNAPSHOT_DEFERRED_DATES_KEY = 'trade_snapshot_rebuild_deferred_v1'/);
assert.match(gas,/tradeSnapshotDeferredCount: tradeSnapshotDeferred.dates.length/);
assert.match(gas,/tradeSnapshotWorkerLastResult: tradeSnapshotWorkerLastResult/);

function fixture({statusByDate={},writerErrorDate='',badDeferred=false,lockBusy=false,holdingsPresent=true}={}) {
  const props=new Map(),calls=[],logs=[],phaseMarks=[],locks={held:0};
  let dates=['2025-12-31','2026-01-01','2026-01-06'];
  let activeStatus={...statusByDate};
  if(badDeferred)props.set('trade_snapshot_rebuild_deferred_v1',
    JSON.stringify({dates:Array.from({length:601},(_,i)=>'2026-01-01'),cursor:''}));
  props.set('trade_snapshot_rebuild_pending_v1',
    JSON.stringify({from:'2025-12-31'}));
  const scriptProps={
    getProperty:key=>props.get(key)||null,
    setProperty:(key,value)=>{
      calls.push({op:'set',key});
      if(key==='trade_snapshot_worker_last_v1'){
        const data=JSON.parse(value);
        if(data.status==='RUNNING')phaseMarks.push({
          phase:data.phase,blockedDate:data.blockedDate,runStartedAt:data.runStartedAt});
      }
      props.set(key,value);
    },
    deleteProperty:key=>{calls.push({op:'delete',key});props.delete(key)}
  };
  const ctx=vm.createContext({
    TRADE_SNAPSHOT_DEFERRED_DATES_KEY:'trade_snapshot_rebuild_deferred_v1',
    TRADE_SNAPSHOT_WORKER_LAST_KEY:'trade_snapshot_worker_last_v1',
    TRADE_SNAPSHOT_WORKER_BUSY_KEY:'trade_snapshot_worker_busy_v1',
    TRADE_SNAPSHOT_REBUILD_PENDING_KEY:'trade_snapshot_rebuild_pending_v1',
    PropertiesService:{getScriptProperties:()=>scriptProps},
    LockService:{getScriptLock:()=>({tryLock:()=>{if(lockBusy)return false;locks.held++;return true},
      releaseLock:()=>{locks.held--;}})},
    CONFIG:{SHEET_SNAPSHOT:'스냅샷'},
    _normalizeDate:s=>String(s||''),
    _tradeLedgerWriteUnverified_:()=>false,
    _detectExternalTradeLedgerChanges_:()=>({state:'UNCHANGED'}),
    _readPendingTradeSnapshotRebuild:()=>{
      const v=props.get('trade_snapshot_rebuild_pending_v1');
      return v?JSON.parse(v):null;
    },
    _clearPendingTradeSnapshotRebuild:()=>scriptProps.deleteProperty('trade_snapshot_rebuild_pending_v1'),
    _latestConfirmedSnapshotDate:()=> '2026-01-06',
    _collectTradeSnapshotWorkerDates_:(_ss,from,to)=>({complete:true,dates:Object.fromEntries(dates.filter(d=>d>=from&&d<=to).map(d=>[d,true]))}),
    getss:()=>{
      assert.equal(JSON.parse(props.get('trade_snapshot_worker_last_v1')).status,'RUNNING',
        'worker MUST persist RUNNING before reading any sheet');
      return {getSheetByName:()=>({getLastRow:()=>100})};
    },
    diagnoseSnapshotIntegrity:(_ss,date)=>{
      const entry=activeStatus[date]||'VALID';
      const status=typeof entry==='string'?entry:entry.status;
      return {status,
        expectedRowCount:typeof entry==='object'&&entry.expected!==undefined?entry.expected:33,
        storedRowCount:typeof entry==='object'&&entry.stored!==undefined
          ?entry.stored:(status==='VALID'?33:2),
        duplicateKeys:status==='CONFLICT'?['bad']:[],
        sourceDataErrors:status==='SOURCE_INCOMPLETE'?['missing prices']:[]};
    },
    _rebuildDailySnapshotsLocked:(from,to)=>{
      calls.push({op:'rebuild',date:from});
      return writerErrorDate===from?{errors:['writer failure'],skipped:0}:{errors:[],skipped:0};
    },
    _hasSnapshotHoldingsAtDate:()=>holdingsPresent,
    _dateOffset:date=>{const d=new Date(date+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+1);return d.toISOString().slice(0,10)},
    Logger:{log:msg=>logs.push(String(msg))},
  });
  vm.runInContext(compiled,ctx);
  return {ctx,props,calls,locks,logs,phaseMarks,activeStatus,
    pending:()=>JSON.parse(props.get('trade_snapshot_rebuild_pending_v1')||'null'),
    deferred:()=>JSON.parse(props.get('trade_snapshot_rebuild_deferred_v1')||'{"dates":[],"cursor":""}'),
    last:()=>JSON.parse(props.get('trade_snapshot_worker_last_v1')||'null'),
    busy:()=>JSON.parse(props.get('trade_snapshot_worker_busy_v1')||'null')};
}


// Live evidence 2026-10-19 GAS v9.240: single-day PARTIAL expected=0/
// stored=2 while indexed range says SOURCE_INCOMPLETE. The old worker
// misclassified this as BLOCKED, starving all following safe dates.
// New worker must persist both source gaps BEFORE moving the pending cursor.
{
  const gap={status:'PARTIAL',expected:0,stored:2};
  const f=fixture({statusByDate:{
    '2025-12-31':gap,'2026-01-01':{...gap,stored:30}
  },writerErrorDate:'2025-12-31'});
  const r=f.ctx.runPendingTradeSnapshotRebuild();
  assert.equal(r.status,'PENDING');
  assert.equal(r.deferred,2);
  assert.equal(f.pending().from,'2026-01-02');
  assert.deepEqual(f.deferred().dates,['2025-12-31','2026-01-01']);
  assert.equal(f.calls.filter(x=>x.op==='rebuild').length,0,
    'zero expected with confirmed ledger holdings must defer BEFORE any write');
  const ops=f.calls.filter(x=>x.op==='set').map(x=>x.key);
  assert.ok(ops.indexOf('trade_snapshot_rebuild_deferred_v1')<
    ops.indexOf('trade_snapshot_rebuild_pending_v1'));
  assert.equal(f.locks.held,0);
}
// Only ledger-confirmed nonempty portfolios qualify. A genuinely empty
// portfolio remains VALID without inventing missing prices.
{
  const f=fixture({statusByDate:{'2025-12-31':{
    status:'NO_SNAPSHOT',expected:0,stored:0
  }},holdingsPresent:false});
  assert.equal(f.ctx._assessTradeSnapshotWorkerDate_({},'2025-12-31').state,'VALID');
  assert.equal(f.calls.filter(x=>x.op==='rebuild').length,0);
}
// Unverified/absent holdings cannot be upgraded to a SOURCE_INCOMPLETE
// exemption. Preserve BLOCKED and the cursor when the writer fails.
{
  const f=fixture({statusByDate:{'2025-12-31':{
    status:'PARTIAL',expected:0,stored:2
  }},holdingsPresent:false,writerErrorDate:'2025-12-31'});
  assert.equal(f.ctx.runPendingTradeSnapshotRebuild().status,'BLOCKED');
  assert.equal(f.pending().from,'2025-12-31');
  assert.deepEqual(f.deferred().dates,[]);
}

// Two missing-source days are NOT discarded. Forward cursor can still reach
// Jan 6 without changing any historical trading record or prices.
{
  const f=fixture({statusByDate:{'2025-12-31':'SOURCE_INCOMPLETE',
    '2026-01-01':'SOURCE_INCOMPLETE'}});
  const a=f.ctx.runPendingTradeSnapshotRebuild();
  assert.equal(a.status,'PENDING');
  assert.equal(a.deferred,2);
  assert.equal(a.processed,0);
  assert.equal(f.pending().from,'2026-01-02');
  assert.deepEqual(f.deferred().dates,['2025-12-31','2026-01-01']);
  assert.equal(f.calls.filter(x=>x.op==='rebuild').length,0,
    'source-incomplete days must never invoke full-sheet writer');
  assert.equal(f.locks.held,0);
  // The unresolved record must be stored BEFORE the cursor is advanced.
  const set=f.calls.filter(x=>x.op==='set').map(x=>x.key);
  assert.ok(set.indexOf('trade_snapshot_rebuild_deferred_v1')
    < set.indexOf('trade_snapshot_rebuild_pending_v1'));
  const b=f.ctx.runPendingTradeSnapshotRebuild();
  assert.equal(b.status,'COMPLETED');
  assert.equal(b.processed,1);
  assert.equal(f.pending(),null);
  assert.deepEqual(f.deferred().dates,['2025-12-31','2026-01-01']);
  assert.deepEqual(f.calls.filter(x=>x.op==='rebuild').map(x=>x.date),['2026-01-06']);
  const retry=f.ctx.runPendingTradeSnapshotRebuild();
  assert.equal(retry.status,'DEFERRED_RETRY');
  assert.equal(f.deferred().cursor,'2025-12-31');
  assert.equal(f.pending(),null);
  assert.equal(f.last().status,'DEFERRED_RETRY');
  assert.match(f.last().at,/^\d{4}-\d\d-\d\dT/);
  f.activeStatus['2026-01-01']='VALID';
  const resolved=f.ctx.runPendingTradeSnapshotRebuild();
  assert.equal(resolved.status,'DEFERRED_RESOLVED');
  assert.deepEqual(f.deferred().dates,['2025-12-31']);
  assert.equal(f.locks.held,0);
}
// Existing valid day is not incorrectly certified when writer fails; a
// non-source MISMATCH must retain the forward cursor (fail-closed).
{
  const f=fixture({statusByDate:{'2025-12-31':'MISMATCH'},
    writerErrorDate:'2025-12-31'});
  const r=f.ctx.runPendingTradeSnapshotRebuild();
  assert.equal(r.status,'BLOCKED');
  assert.equal(r.blockedDate,'2025-12-31');
  assert.equal(f.pending().from,'2025-12-31');
  assert.deepEqual(f.deferred().dates,[]);
  assert.equal(f.locks.held,0);
}
// MANUAL-protected conflict is never rewritten. It is always listed as
// unresolved before the next valid day is visited.
{
  const f=fixture({statusByDate:{'2025-12-31':'CONFLICT',
    '2026-01-01':'PRICE_SUSPICIOUS'}});
  const r=f.ctx.runPendingTradeSnapshotRebuild();
  assert.equal(r.deferred,2);
  assert.equal(f.calls.filter(x=>x.op==='rebuild').length,0);
  assert.deepEqual(f.deferred().dates,['2025-12-31','2026-01-01']);
}
// Invalid or oversized persistent state blocks progress and never discards a
// source exception silently.
{
  const f=fixture({badDeferred:true});
  assert.equal(f.ctx.runPendingTradeSnapshotRebuild().status,'ERROR');
  assert.equal(f.pending().from,'2025-12-31');
  assert.equal(f.locks.held,0);
}
{
  const f=fixture({statusByDate:{'2025-12-31':'SOURCE_INCOMPLETE'}});
  f.props.set('trade_snapshot_rebuild_deferred_v1','{broken');
  const r=f.ctx.runPendingTradeSnapshotRebuild();
  assert.equal(r.status,'ERROR');
  assert.equal(f.pending().from,'2025-12-31');
}
// The first successful script-lock acquisition must checkpoint RUNNING before
// any SpreadsheetApp or ledger fingerprint/price operation. If GAS hard-kills
// that execution, its final RUNNING marker remains a reliable last-entry hint.
{
  const f=fixture({statusByDate:{'2025-12-31':'SOURCE_INCOMPLETE'}});
  const result=f.ctx.runPendingTradeSnapshotRebuild();
  assert.equal(result.status,'PENDING');
  const updates=f.calls.filter(x=>x.op==='set').map(x=>x.key);
  assert.equal(updates[0],'trade_snapshot_worker_last_v1');
  assert.equal(f.busy(),null);
  assert.equal(f.last().status,'PENDING');
  assert.deepEqual(f.phaseMarks.slice(0,7).map(x=>x.phase),
    ['ENTRY','LEDGER_FINGERPRINT','QUEUE_READ','DATE_DISCOVERY',
     'DATE_SOURCE_COLLECTION','DATE_DISCOVERY_COMPLETE','DATE_DIAGNOSTIC']);
  assert.equal(f.phaseMarks.at(-1).phase,'CURSOR_COMMIT');
  assert.ok(f.phaseMarks.every(x=>x.runStartedAt===f.phaseMarks[0].runStartedAt),
    'step checkpoint must retain the original entry timestamp');
  assert.ok(f.phaseMarks.every(x=>x.blockedDate==='' ||
    /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(x.blockedDate)),
    'phase markers contain only safe date or blank; no financial payload');
  assert.equal(f.locks.held,0);
}
// Lock collisions must not overwrite the active worker's last RUNNING phase.
// Keep lock-denial telemetry separate, and do not try to open the Spreadsheet.
{
  const f=fixture({lockBusy:true});
  f.props.set('trade_snapshot_worker_last_v1',JSON.stringify({
    status:'RUNNING',at:'2026-10-19T08:00:00.000Z',processed:0,deferred:0,
    blockedDate:'',sourceCheck:''}));
  const result=f.ctx.runPendingTradeSnapshotRebuild();
  assert.equal(result.status,'BUSY');
  assert.equal(f.last().status,'RUNNING');
  assert.equal(f.last().at,'2026-10-19T08:00:00.000Z');
  assert.equal(f.busy().status,'BUSY');
  assert.match(f.busy().at,/^[0-9]{4}-[0-9]{2}-[0-9]{2}T/);
  assert.equal(f.pending().from,'2025-12-31');
  assert.equal(f.calls.filter(x=>x.key==='trade_snapshot_rebuild_pending_v1').length,0);
  assert.equal(f.locks.held,0);
}
// Production boundary regressions: in ordinary thrown failures the worker
// records ERROR, but the last RUNNING phase still identifies the exact helper
// it was entering. Hard GAS kills may retain the same last RUNNING marker.
for (const [helper,expected] of [
  ['_latestConfirmedSnapshotDate','DATE_DISCOVERY'],
  ['_collectTradeSnapshotWorkerDates_','DATE_SOURCE_COLLECTION']
]) {
  const f=fixture({statusByDate:{'2025-12-31':'SOURCE_INCOMPLETE'}});
  f.ctx[helper]=()=>{throw Error('SYNTHETIC_READ_INTERRUPTED');};
  assert.equal(f.ctx.runPendingTradeSnapshotRebuild().status,'ERROR');
  assert.equal(f.phaseMarks.at(-1).phase,expected,
    'last checkpoint must uniquely localize interrupted helper');
  assert.equal(f.pending().from,'2025-12-31',
    'failed read must not move pending cursor');
  assert.deepEqual(f.deferred().dates,[],
    'failed read must not silently append deferred dates');
  assert.equal(f.calls.filter(x=>x.op==='rebuild').length,0,
    'failed read must not reach any Snapshot write');
  assert.equal(f.locks.held,0,'ordinary errors must release script lock');
}
// Once the first date consumed the soft budget, preserve the next date for
// another hourly invocation instead of starting a second expensive writer.
{
  const f=fixture();let elapsed=0;
  f.ctx.Date=class extends Date {static now(){return elapsed;}};
  const assess=f.ctx._assessTradeSnapshotWorkerDate_;
  f.ctx._assessTradeSnapshotWorkerDate_=(ss,date)=>{
    const result=assess(ss,date);elapsed+=181000;return result;
  };
  const result=f.ctx.runPendingTradeSnapshotRebuild();
  assert.equal(result.status,'PENDING');assert.equal(result.processed,1);
  assert.equal(f.calls.filter(x=>x.op==='rebuild').length,1);
  assert.equal(f.pending().from,'2026-01-01');assert.equal(f.locks.held,0);
}
// The same production assessor with/without observation must keep its result
// and writer calls. Only phase names and the requested date reach the observer.
{
  const plain=fixture(),observed=fixture(),phases=[];
  const a=plain.ctx._assessTradeSnapshotWorkerDate_({},'2026-01-06');
  const b=observed.ctx._assessTradeSnapshotWorkerDate_({},'2026-01-06',
    (phase,date)=>phases.push([phase,date]));
  assert.equal(JSON.stringify(a),JSON.stringify(b));
  assert.deepEqual(observed.calls,plain.calls);
  assert.deepEqual(phases.map(x=>x[0]),['DATE_PRECHECK','DATE_PRECHECK_COMPLETE',
    'DATE_REBUILD','DATE_REBUILD_COMPLETE','DATE_POSTCHECK','DATE_POSTCHECK_COMPLETE']);
  assert.ok(phases.every(x=>x.length===2&&x[1]==='2026-01-06'));
}
{
  const f=fixture({writerErrorDate:'2026-01-06'}),phases=[];
  const r=f.ctx._assessTradeSnapshotWorkerDate_({},'2026-01-06',p=>phases.push(p));
  assert.equal(r.state,'BLOCKED');assert.equal(r.reason,'REBUILD_ERROR');
  assert.deepEqual(phases,['DATE_PRECHECK','DATE_PRECHECK_COMPLETE','DATE_REBUILD',
    'DATE_REBUILD_COMPLETE','DATE_FAILURE_RECHECK','DATE_FAILURE_RECHECK_COMPLETE']);
}
// Interrupt each actual stage and assert the last reached phase and cursor
// preservation. This distinguishes precheck, writer and postcheck hard stops.
for(const stage of ['DATE_PRECHECK','DATE_REBUILD','DATE_POSTCHECK']){
  const f=fixture();let reads=0;
  const diagnose=f.ctx.diagnoseSnapshotIntegrity;
  f.ctx.diagnoseSnapshotIntegrity=(...args)=>{
    reads++;
    if((stage==='DATE_PRECHECK'&&reads===1)||(stage==='DATE_POSTCHECK'&&reads===2))
      throw Error('SYNTHETIC_INTERRUPT');
    return diagnose(...args);
  };
  if(stage==='DATE_REBUILD')f.ctx._rebuildDailySnapshotsLocked=()=>{throw Error('SYNTHETIC_INTERRUPT');};
  assert.equal(f.ctx.runPendingTradeSnapshotRebuild().status,'ERROR');
  assert.equal(f.phaseMarks.at(-1).phase,stage);
  assert.equal(f.pending().from,'2025-12-31');assert.deepEqual(f.deferred().dates,[]);
  assert.equal(f.locks.held,0);
}
{
  const f=fixture({statusByDate:{'2025-12-31':'SOURCE_INCOMPLETE'}});
  f.props.delete('trade_snapshot_rebuild_pending_v1');
  f.props.set('trade_snapshot_rebuild_deferred_v1',JSON.stringify({dates:['2025-12-31'],cursor:''}));
  assert.equal(f.ctx.runPendingTradeSnapshotRebuild().status,'DEFERRED_RETRY');
  assert.ok(f.phaseMarks.some(x=>x.phase==='DATE_PRECHECK'&&x.blockedDate==='2025-12-31'));
  assert.equal(f.calls.filter(x=>x.op==='rebuild').length,0);
}
console.log('Issue #507 deferred ledger worker production VM tests PASS');
