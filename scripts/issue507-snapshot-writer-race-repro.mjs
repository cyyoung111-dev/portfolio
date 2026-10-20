#!/usr/bin/env node
// Issue #507 — reproducible existing GAS full-sheet writer race, READ ONLY.
// Runs original production writeSnapshotRows against entirely synthetic memory.
// WARNING: a passing race test proves the current hazard EXISTS, not that it is fixed.
// Never call live GAS, Sheets, credential sources, or cleanup endpoints.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync('src/gas/apps_script.gs','utf8');
const names=[
  '_normalizeDate','_cleanCode','_dedupeSnapshotRows','_snapshotComparableSignature',
  '_snapshotIntegrityKey','_snapshotRowsSignature','_mergeSnapshotRowsSafely',
  '_normalizeCodeRows','_readRawSnapshotRowsByDate','writeSnapshotRows'
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
function makeEnv({onBackup}={}){
  let stored=[Array.from({length:12},(_,i)=>'H'+(i+1)),deep(row1),deep(row2)];
  let lockHeld=false,backups=0,writes=0,flushes=0,revisionUpdates=0,propertyWrites=0;
  const sheet={
    getLastRow:()=>stored.length,
    getLastColumn:()=>12,
    getMaxRows:()=>100,
    insertRowsAfter:()=>{throw Error('NO_ROW_EXPANSION_EXPECTED')},
    getRange:(row,col,height,width)=>({
      getValues:()=>{
        assert.equal(col,1);assert.ok(width>=12);
        return deep(stored.slice(row-1,row-1+height));
      },
      setValues:values=>{
        assert.equal(col,1);
        assert.ok(values.every(v=>v.length===width));
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
    writer:(date,newRows,overwrite)=>context.writeSnapshotRows(ss,date,deep(newRows),overwrite),
    rows:()=>deep(stored),
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
// Append a new date without touching earlier rows.
{
  const x=makeEnv();
  x.writer('2026-01-16',[makeRow('2026-01-16','000333',4)],false);
  assert.equal(x.stats().backups,0);
  assert.equal(x.stats().writes,1);
  assert.equal(byKey(x,date2,'000222')[3],3);
  assert.equal(byKey(x,'2026-01-16','000333')[3],4);
}
// Existing-date overwrite: backup and raw-date validation succeed.
{
  const x=makeEnv();
  x.writer(date1,[makeRow(date1,'000111',5)],true);
  assert.equal(x.stats().backups,1);
  assert.equal(x.stats().writes,1);
  assert.equal(byKey(x,date1,'000111')[3],5);
  assert.equal(byKey(x,date2,'000222')[3],3);
}
// Known unsafe race: external Sheets API modifies a *different* date after
// the GAS writer read its full snapshot, but before its full-sheet commit.
// ScriptLock is held, yet cannot stop such an external write.
{
  let injected=false;
  const x=makeEnv({onBackup:({stored})=>{
    const foreign=stored.find(r=>r[0]===date2&&r[1]==='000222');
    assert.ok(foreign);
    foreign[3]=9; foreign[5]=90;foreign[7]=99; // synthetic out-of-band edit
    injected=true;
  }});
  x.writer(date1,[makeRow(date1,'000111',5)],true);
  assert.equal(injected,true);
  assert.equal(x.stats().backups,1);
  // This asserts the hazard reproduced, NOT that this state is acceptable.
  assert.equal(byKey(x,date2,'000222')[3],3,
    'KNOWN_UNSAFE: external change overwritten by stale full-sheet combined');
  assert.notEqual(byKey(x,date2,'000222')[3],9,
    'KNOWN_UNSAFE: writer did not preserve newer other-date change');
  assert.equal(byKey(x,date1,'000111')[3],5,
    'the target-date validation still succeeds despite unrelated data loss');
}
console.log('ISSUE507_KNOWN_UNSAFE_FULL_REWRITE_RACE_REPRODUCED');
