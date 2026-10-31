#!/usr/bin/env node
import {isolateGasBusinessLogic} from './gas-business-fixture.mjs';
// Issue #507 — production date-scoped Snapshot writer safety contract.
// Executes actual GAS production functions against synthetic in-memory sheets.
// This must fail if an unrelated date is overwritten by a stale full rewrite.
// No live GAS, real sheets, credentials, or real financial data.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=isolateGasBusinessLogic(fs.readFileSync('src/gas/apps_script.gs','utf8'));
const names=[
  '_normalizeDate','_cleanCode','_dedupeSnapshotRows','_snapshotComparableSignature',
  '_snapshotIntegrityKey','_snapshotRowsSignature','_mergeSnapshotRowsSafely',
  '_normalizeCodeRows','_readRawSnapshotRowsByDate',
  '_writeSnapshotDateScoped_','writeSnapshotRows'
];
const production=names.map(name=>{
  const start=source.indexOf('function '+name+'(');
  assert.ok(start>=0,'missing GAS production function '+name);
  const end=source.indexOf('\n}',start);
  assert.ok(end>start,'missing GAS production end '+name);
  return source.slice(start,end+2);
}).join('\n');
const date1='2026-01-14',date2='2026-01-15';
const makeRow=(date,code,qty)=>[
  date,code,'SYNTH',qty,10,qty*10,11,qty*11,qty,10,
  'SYNTHETIC_SOURCE',''
];
const row1=makeRow(date1,'000111',2);
const row2=makeRow(date2,'000222',3);
const deep=v=>JSON.parse(JSON.stringify(v));
function makeEnv({onBackup,initialRows,failWriteAt,onAppendRead,onBeforeTargetWrite}={}){
  let stored=[Array.from({length:12},(_,i)=>'H'+(i+1)),...deep(initialRows||[row1,row2])];
  let lockHeld=false,backups=0,writes=0,writeCalls=0,flushes=0,revisionUpdates=0,propertyWrites=0,appendReadInjected=false,concurrentWriteInjected=false;
  const writtenRanges=[];
  const sheet={
    getLastRow:()=>{ // Model actual Sheets: trailing fully blank rows are not data.
      for(let i=stored.length-1;i>=0;i--){
        if((stored[i]||[]).some(cell=>cell!==''&&cell!==null&&cell!==undefined))
          return i+1;
      }
      return 0;
    },
    getLastColumn:()=>12,
    getMaxRows:()=>100,
    insertRowsAfter:()=>{throw Error('NO_ROW_EXPANSION_EXPECTED')},
    getRange:(row,col,height,width)=>({
      getValues:()=>{
        assert.equal(col,1);assert.ok(width>=12);
        // Inject an out-of-band append after writer's last-row check.
        if(onAppendRead && !appendReadInjected && row>3){
          appendReadInjected=true;onAppendRead({stored,row});
        }
        return Array.from({length:height},(_,i)=>
          deep(stored[row-1+i]||Array(width).fill('')).map(v=>
            v==='=40+2'?42:v));
      },
      getFormulas:()=>Array.from({length:height},(_,i)=>
        Array.from({length:width},(_,j)=>{
          const v=stored[row-1+i]?.[col-1+j];
          return typeof v==='string' && v.startsWith('=')?v:'';
        })),
      setValues:values=>{
        writeCalls++;
        if (failWriteAt===writeCalls) throw Error('SYNTHETIC_INJECTED_WRITE_FAILURE');
        assert.equal(col,1);
        assert.ok(values.every(v=>v.length===width));
        // Controlled Sheets API concurrency: inject *after* the writer's
        // read/validation and immediately before the Sheets commit.
        if(onBeforeTargetWrite && !concurrentWriteInjected){
          concurrentWriteInjected=true;
          onBeforeTargetWrite({stored,row,col,values:deep(values)});
        }
        writtenRanges.push({row,col,height:values.length,width});
        for(let i=0;i<values.length;i++)stored[row-1+i]=deep(values[i]);
        writes++;
      },
      setBackground:()=>({setFontColor:()=>({setFontWeight:()=>{}})})
    })
  };
  const ss={
    getSheetByName:name=>name==='스냅샷'?sheet:null,
    insertSheet:()=>{throw Error('NO_CREATE_EXPECTED')}
  };
  const lock={
    hasLock:()=>lockHeld,
    waitLock:()=>{lockHeld=true},
    releaseLock:()=>{lockHeld=false}
  };
  const context=vm.createContext({
    JSON,Array,String,Number,Object,Math,Date,parseFloat,
    CONFIG:{TIMEZONE:'Asia/Seoul',SHEET_SNAPSHOT:'스냅샷'},
    LockService:{getScriptLock:()=>lock},
    Utilities:{formatDate:()=>{throw Error('DATE_PARSE_NOT_EXPECTED')}},
    SpreadsheetApp:{flush:()=>{flushes++}},
    Logger:{log:()=>{}},
    PropertiesService:{getScriptProperties:()=>({
      setProperty:()=>{propertyWrites++}
    })},
    _snapshotBackupOperationId:'',
    _isFundCode:()=>false,
    _classifyRawSnapshotDuplicateGroups:()=>[],
    _readFundUnits:()=>{throw Error('NO_FUND_READ_EXPECTED')},
    _filterSnapshotRowsByFundLifecycle:()=>{throw Error('NO_FUND_LIFECYCLE_EXPECTED')},
    _setCodeColumnText:()=>{},
    _touchSnapshotIntegritySourceRevision:()=>{revisionUpdates++},
    _backupSnapshotBeforeWrite:()=>{
      backups++;
      if(onBackup)onBackup({stored,sheet,ss});
      return {name:'SYNTHETIC_BACKUP'};
    },
    _markSnapshotBackupStatus:()=>{},
    _cleanupCurrentSystemBackup:()=>[],
  });
  vm.runInContext(production,context,{filename:'actual-gas-writer.js'});
  return{
    writer:(date,newRows,overwrite,allowEmpty=false)=>context.writeSnapshotRows(
      ss,date,deep(newRows),overwrite,null,null,allowEmpty),
    rows:()=>deep(stored),
    writtenRanges:()=>deep(writtenRanges),
    stats:()=>({backups,writes,flushes,revisionUpdates,propertyWrites}),
  };
}
function byKey(e,date,code){
  return e.rows().slice(1).find(r=>r[0]===date&&r[1]===code);
}
// No-op: real production writer must avoid writes and backup churn.
{
  const x=makeEnv();
  x.writer(date1,[row1],true);
  assert.deepEqual(x.stats(),{backups:0,writes:0,flushes:0,revisionUpdates:0,propertyWrites:0});
  assert.equal(byKey(x,date2,'000222')[3],3);
}
// Adding a new date to a POPULATED snapshot also takes full-sheet rewrite,
// even with overwrite=false. This expands the external-write race surface.
{
  const x=makeEnv();
  x.writer('2026-01-16',[makeRow('2026-01-16','000333',4)],false);
  assert.equal(x.stats().backups,1,'existing snapshot => full-sheet backup');
  assert.equal(x.stats().writes,1);
  assert.equal(x.stats().flushes,1,'existing snapshot => full-sheet write and flush');
  assert.equal(byKey(x,date2,'000222')[3],3);
  assert.equal(byKey(x,'2026-01-16','000333')[3],4);
}
// Existing-date overwrite: backup, date-only write, raw date validation.
{
  const x=makeEnv();
  x.writer(date1,[makeRow(date1,'000111',5)],true);
  assert.equal(x.stats().backups,1);
  assert.equal(x.stats().writes,1);
  assert.equal(byKey(x,date1,'000111')[3],5);
  assert.equal(byKey(x,date2,'000222')[3],3);
}
// Protected race: synthetic external Sheets API edits another date after
// read and after backup was created; only the targeted date may be changed.
{
  let injected=false;
  const x=makeEnv({onBackup:({stored})=>{
    const other=stored.find(r=>r[0]===date2&&r[1]==='000222');
    assert.ok(other);
    other[3]=9; other[5]=90; other[7]=99;
    injected=true;
  }});
  x.writer(date1,[makeRow(date1,'000111',5)],true);
  assert.equal(injected,true);
  assert.equal(x.stats().backups,1);
  assert.equal(byKey(x,date1,'000111')[3],5);
  assert.equal(byKey(x,date2,'000222')[3],9,
    'other-date external update must never be overwritten');
  assert.equal(byKey(x,date2,'000222')[5],90);
}
// Same-date external mutation during backup must be rejected *before*
// writer changes a single original cell.
{
  const x=makeEnv({onBackup:({stored})=>{
    const row=stored.find(r=>r[0]===date1&&r[1]==='000111');
    row[3]=8; row[5]=80;
  }});
  assert.throws(()=>x.writer(date1,[makeRow(date1,'000111',5)],true),
    /Snapshot 대상일 외부 변경/);
  assert.equal(x.stats().writes,0);
  assert.equal(byKey(x,date1,'000111')[3],8);
  assert.equal(byKey(x,date2,'000222')[3],3);
}
// External row append that shifts layout must be rejected rather than
// writing into stale physical row addresses.
{
  const x=makeEnv({onBackup:({stored})=>{
    stored.push(makeRow('2026-01-17','000444',7));
  }});
  assert.throws(()=>x.writer(date1,[makeRow(date1,'000111',5)],true),
    /Snapshot 행 구조 외부 변경/);
  assert.equal(x.stats().writes,0);
  assert.equal(byKey(x,'2026-01-17','000444')[3],7);
}
// Deleting a date does not shift a different date: old physical row is
// cleared instead of compacting/re-writing other dates.
{
  const x=makeEnv();
  x.writer(date1,[],true,true);
  assert.equal(byKey(x,date1,'000111'),undefined);
  assert.equal(byKey(x,date2,'000222')[3],3);
  assert.equal(x.stats().backups,1);
}
// P1 regression: replacing a code on the physical last row first clears
// that row, so real Sheets getLastRow() shrinks under THIS writer's own write.
// Appending the new code at originalLastRow+1 must still complete. This is
// different from a foreign append occupying the destination.
{
  const x=makeEnv();
  const replacement=makeRow(date2,'000999',6);
  replacement[2]='NEW_TEST_ISSUER';
  x.writer(date2,[replacement],true);
  assert.equal(byKey(x,date2,'000222'),undefined);
  assert.equal(byKey(x,date2,'000999')[3],6);
  assert.equal(byKey(x,date1,'000111')[3],2);
  assert.equal(x.stats().writes,2,'clear own last row then append replacement');
}
// This race must still fail closed when a foreign writer places a record in
// the reserved append destination after the original full-sheet read.
{
  const x=makeEnv({onAppendRead:({stored,row})=>{
    stored[row-1]=makeRow('2026-01-18','000666',7);
  }});
  const replacement=makeRow(date2,'000999',6);
  replacement[2]='NEW_TEST_ISSUER';
  assert.throws(()=>x.writer(date2,[replacement],true),
    /Snapshot append 목적지 외부 변경/);
  assert.equal(byKey(x,'2026-01-18','000666')[3],7);
  assert.equal(byKey(x,date2,'000222')[3],3,
    'writer rolls back its own cleared final row after foreign append');
  assert.equal(byKey(x,date2,'000999'),undefined);
}
// Incorrect input date is fail closed and does not create a backup or write.
{
  const x=makeEnv();
  assert.throws(()=>x.writer(date1,[makeRow(date2,'000999',7)],true),
    /요청일과 저장 대상일 불일치/);
  assert.equal(x.stats().writes,0);
  assert.equal(x.stats().backups,0);
}
// P1: two separated date ranges can be updated, but a failure in the
// second request must restore the first without touching another date.
{
  const rows=[row1,row2,makeRow(date1,'000333',2)];
  const x=makeEnv({initialRows:rows});
  x.writer(date1,[makeRow(date1,'000111',5),makeRow(date1,'000333',6)],true);
  assert.equal(byKey(x,date1,'000111')[3],5);
  assert.equal(byKey(x,date1,'000333')[3],6);
  assert.equal(byKey(x,date2,'000222')[3],3);
}
{
  const rows=[row1,row2,makeRow(date1,'000333',2)];
  const x=makeEnv({initialRows:rows,failWriteAt:2});
  assert.throws(()=>x.writer(date1,[makeRow(date1,'000111',5),
    makeRow(date1,'000333',6)],true),/SYNTHETIC_INJECTED_WRITE_FAILURE/);
  assert.equal(byKey(x,date1,'000111')[3],2,'first update rolled back');
  assert.equal(byKey(x,date1,'000333')[3],2,'second update never applied');
  assert.equal(byKey(x,date2,'000222')[3],3,'other date unchanged');
}
// Rewriting an existing code and appending a new one are likewise one
// compensatable operation, not an irreversible partial result.
{
  const x=makeEnv({failWriteAt:2});
  assert.throws(()=>x.writer(date1,[makeRow(date1,'000111',5),
    makeRow(date1,'000555',6)],true),/SYNTHETIC_INJECTED_WRITE_FAILURE/);
  assert.equal(byKey(x,date1,'000111')[3],2);
  assert.equal(byKey(x,date1,'000555'),undefined);
}
// P1 regression: foreign append arrives immediately before the reserved
// append range is read. The new row must survive and no target write occur.
{
  const x=makeEnv({onAppendRead:({stored,row})=>{
    stored[row-1]=makeRow('2026-01-17','000444',7);
  }});
  assert.throws(()=>x.writer('2026-01-16',[
    makeRow('2026-01-16','000333',4)],false),
    /Snapshot append 목적지 외부 변경/);
  assert.equal(x.stats().writes,0);
  assert.equal(byKey(x,'2026-01-17','000444')[3],7);
  assert.equal(byKey(x,'2026-01-16','000333'),undefined);
}
// P2 regression: a rolled-back cell with a formula must restore the formula,
// not a getValues() numeric result. The second disjoint write fails.
{
  const withFormula=deep(row1);withFormula[7]='=40+2';
  const x=makeEnv({initialRows:[withFormula,row2,
    makeRow(date1,'000333',2)],failWriteAt:2});
  assert.throws(()=>x.writer(date1,[makeRow(date1,'000111',5),
    makeRow(date1,'000333',6)],true),/SYNTHETIC_INJECTED_WRITE_FAILURE/);
  assert.equal(byKey(x,date1,'000111')[7],'=40+2',
    'rollback must retain the original formula rather than the value 42');
  assert.equal(byKey(x,date1,'000111')[3],2);
  assert.equal(byKey(x,date2,'000222')[3],3);
}

// Synthetic ranges are recorded at the actual mock setValues boundary;
// do not infer which physical cells were touched from setValues call counts.
function assertPhysicallyUntouched(env,physicalRows){
  const ranges=env.writtenRanges();
  for(const rowNumber of physicalRows){
    assert.ok(ranges.every(x=>x.row>rowNumber||x.row+x.height<=rowNumber),
      'undated physical row '+rowNumber+' must not appear in any write range');
  }
}
// Issue #507 global undated-row preservation regression.
// Real Snapshot currently has populated B/D/F rows with empty column A.
// This reproducer intentionally provides NO inferred date: a date-scoped
// writer must not silently fill, delete, shift or overwrite those rows.
// Historical provenance and recovery eligibility remain UNVERIFIED.
{
  const undated=makeRow('','000777',12);
  undated[5]=120;
  undated[10]='KRX_SYNTHETIC';
  const otherUndated=makeRow(null,'000778',4);
  otherUndated[5]=44;
  otherUndated[10]='FUND_SYNTHETIC';
  const x=makeEnv({initialRows:[row1,undated,row2,otherUndated]});
  const before=[deep(undated),deep(otherUndated)];
  const previousPhysicalOrder=x.rows().map(row=>row[1]);
  x.writer(date1,[makeRow(date1,'000111',5)],true);
  assert.deepEqual(x.rows().map(row=>row[1]),previousPhysicalOrder,
    'physical Snapshot row order must remain identical');
  assertPhysicallyUntouched(x,[3,5]);
  assert.equal(byKey(x,date1,'000111')[3],5);
  assert.equal(byKey(x,date2,'000222')[3],3);
  assert.deepEqual([byKey(x,'','000777'),byKey(x,null,'000778')],before,
    'normal targeted rewrite must preserve both undated rows byte-for-byte');
  assert.equal(x.stats().writes,1,'only the requested dated row is written');
}
// No-op must not churn backups or touch any undated row.
{
  const undated=makeRow('','000777',12);
  const x=makeEnv({initialRows:[row1,undated,row2]});
  x.writer(date1,[row1],true);
  assert.deepEqual(byKey(x,'','000777'),undated);
  assert.deepEqual(x.rows()[2],undated,'no-op must retain undated physical row 3');
  assert.deepEqual(x.writtenRanges(),[]);
  assert.deepEqual(x.stats(),{
    backups:0,writes:0,flushes:0,revisionUpdates:0,propertyWrites:0
  });
}
// Out-of-band mutation to an undated row after backup must survive the
// subsequent independent dated write. ScriptLock does NOT guard Sheets API.
{
  let injected=false;
  const undated=makeRow('','000777',12);
  const x=makeEnv({
    initialRows:[row1,undated,row2],
    onBackup:({stored})=>{
      const target=stored.find(row=>row[0]===''&&row[1]==='000777');
      assert.ok(target);
      target[3]=91;target[5]=910;target[10]='EXTERNAL_SYNTHETIC';
      injected=true;
    }
  });
  x.writer(date1,[makeRow(date1,'000111',5)],true);
  assert.equal(injected,true);
  assert.equal(byKey(x,'','000777')[3],91);
  assert.equal(byKey(x,'','000777')[5],910);
  assert.equal(byKey(x,'','000777')[10],'EXTERNAL_SYNTHETIC');
  assert.equal(x.rows()[2][1],'000777','external undated physical position must remain 3');
  assertPhysicallyUntouched(x,[3]);
  assert.equal(byKey(x,date1,'000111')[3],5);
}
// A disjoint second target-date range can fail after the first range has
// already written. Rollback must preserve intervening undated data.
{
  const undated=makeRow('','000777',12);
  const target2=makeRow(date1,'000333',2);
  const x=makeEnv({
    initialRows:[row1,undated,target2,row2],
    failWriteAt:2
  });
  assert.throws(()=>x.writer(date1,[
    makeRow(date1,'000111',5),makeRow(date1,'000333',6)],true),
    /SYNTHETIC_INJECTED_WRITE_FAILURE/);
  assert.equal(byKey(x,date1,'000111')[3],2);
  assert.equal(byKey(x,date1,'000333')[3],2);
  assert.deepEqual(byKey(x,'','000777'),undated,
    'undated row separating two target blocks must remain unchanged');
  assert.deepEqual(x.rows()[2],undated,'rollback must retain physical row 3');
  assertPhysicallyUntouched(x,[3]);
  assert.equal(byKey(x,date2,'000222')[3],3);
}
console.log('ISSUE507_UNDATED_ROW_PRODUCTION_WRITER_PRESERVED');
// KNOWN UNSAFE (not a protection test): ScriptLock cannot exclude an
// out-of-band Sheets API writer of the same (date,code) between the final
// getValues/getFormulas read and our Range.setValues. We deliberately assert
// the lost update is reproduced so reviewers cannot misread green CI as
// atomic CAS support. Remove this expected-risk assertion only when an
// independently validated cross-writer exclusion/transaction is deployed.
{
  let injected=false;
  const x=makeEnv({onBeforeTargetWrite:({stored,row})=>{
    assert.equal(row,2);
    const foreign=stored.find(r=>r[0]===date1&&r[1]==='000111');
    assert.ok(foreign);
    foreign[3]=8; foreign[5]=80; foreign[7]=88;
    injected=true;
  }});
  x.writer(date1,[makeRow(date1,'000111',5)],true);
  assert.equal(injected,true,'independent external writer actually ran');
  assert.equal(byKey(x,date1,'000111')[3],5,
    'KNOWN_UNSAFE: current GAS overwrites later external same-date quantity');
  assert.notEqual(byKey(x,date1,'000111')[3],8,
    'KNOWN_UNSAFE: external same-date modification is not preserved');
  assert.equal(byKey(x,date2,'000222')[3],3,
    'scope limitation: the unrelated date is still preserved');
}
console.log('ISSUE507_KNOWN_UNSAFE_SAME_DATE_TOCTOU_REPRODUCED');
console.log('ISSUE507_DATE_SCOPED_PRODUCTION_WRITER_SAFETY_OK');
