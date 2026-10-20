#!/usr/bin/env node
// Issue #507 — actual production cleanup scopes deletion to the exact physical
// row and fails closed on custom/formula/identity ambiguity. Synthetic only.
// Real external same-cell TOCTOU still requires shared writer serialization.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const gas=fs.readFileSync('src/gas/apps_script.gs','utf8');
const getFunc=name=>{
  const start=gas.indexOf('function '+name+'('),end=gas.indexOf('\n}',start);
  assert.ok(start>=0 && end>start,'Missing production function: '+name);
  return gas.slice(start,end+2);
};
const code=[
 '_snapshotComparableSignature',
 '_classifyRawSnapshotDuplicateGroups',
 '_cleanupSnapshotDuplicatesLocked',
].map(getFunc).join('\n');
assert.doesNotMatch(code,/sh\.getRange\(1,\s*1,\s*output\.length,\s*colSize\)\.setValues\(output\)/,
 'whole Snapshot rewrite must not return');
assert.match(code,/SNAPSHOT_CLEANUP_UNSAFE_SOURCE_REQUIRES_REVIEW/,
 'unsafe custom/formula rows must be fail closed');

const copy=x=>JSON.parse(JSON.stringify(x));
const d1='2026-01-14',d2='2026-01-15';
const row=(date,code,src,ext='')=>[date,code,'TEST',1,10,10,12,12,2,20,src,'',ext];
const head=['DATE','CODE','NAME','QTY','BUY','COST','PRICE','EVAL','PNL','RETURN','SOURCE','STAMP','EXTRA'];
const mk=(mode)=>{
 switch(mode){
  case 'duplicate12':return [head.slice(0,12),row(d1,'000111','KRX').slice(0,12),
   row(d1,'000111','KRX').slice(0,12),row(d2,'000222','OLD_B').slice(0,12)];
  case 'wideZero':return [head,row(d1,'F00001','ZERO','ZERO_USER'),
   row(d2,'000222','OLD_B','FOREIGN_EXTRA')];
  case 'wideDuplicate':return [head,row(d1,'000111','KRX','KEEP_EXTRA'),
   row(d1,'000111','KRX','DUP_EXTRA'),row(d2,'000222','OLD_B','FOREIGN_EXTRA')];
  case 'missingDate':return [head.slice(0,12),['','000999','UNVERIFIED',1,10,10,12,12,2,20,'UNKNOWN',''],
   row(d2,'000222','OLD_B').slice(0,12)];
  case 'manual':return [head.slice(0,12),row(d1,'000111','MANUAL').slice(0,12),
   row(d1,'000111','MANUAL').slice(0,12),row(d2,'000222','OLD_B').slice(0,12)];
  case 'doubleZero':return [head.slice(0,12),row(d1,'F00001','ZERO').slice(0,12),
   row(d1,'F00002','ZERO').slice(0,12),row(d2,'000222','OLD_B').slice(0,12)];
  default:throw Error('unsupported mode '+mode);
 }
};
function env({mode='duplicate12',afterBackup,failWriteAt=0,formulaAt=[],sourceOverride}={}){
 const data=copy(mk(mode)),original=copy(data);let calls=0;
 const width=data[0].length,backs=[],status=[],revision=[],writes=[];
 const getLastRow=()=>{
   for(let i=data.length-1;i>=0;i--)if(data[i].some(v=>v!==''&&v!=null))return i+1;
   return 0;
 };
 const sheet={
  getLastRow,getLastColumn:()=>width,
  getRange:(r,c,h,w)=>{
   assert.ok(Number.isInteger(r)&&r>0&&c>0&&h>0&&w>0);
   const get=()=>Array.from({length:h},(_,i)=>
     Array.from({length:w},(_,j)=>data[r-1+i]?.[c-1+j]??''));
   return {
    getValues:()=>copy(get()),
    getFormulas:()=>Array.from({length:h},(_,i)=>
      Array.from({length:w},(_,j)=>formulaAt.some(x=>x.row===r+i&&x.col===c+j)?'=USER_FORMULA':'')),
    setValues:values=>{
      calls++;
      assert.equal(values.length,h);
      assert.ok(values.every(row=>row.length===w),'Range.setValues physical width');
      if(failWriteAt&&calls===failWriteAt)throw Error('SIMULATED_SECOND_CLEANUP_WRITE_FAILURE');
      values.forEach((valuesRow,i)=>{
        assert.ok(data[r-1+i]);
        valuesRow.forEach((value,j)=>{data[r-1+i][c-1+j]=value;});
      });
      writes.push({r,c,h,w});
    }
   };
  },
 };
 const ss={getSheetByName:n=>n==='스냅샷'?sheet:null};
 const ctx=vm.createContext({
  JSON,Math,Array,Object,String,Number,
  CONFIG:{SHEET_SNAPSHOT:'스냅샷'},getss:()=>ss,
  _readFundUnits:()=>[],
  _fundUnitsAtDate:()=>({units:0}),
  _isFundCode:x=>/^F0000[12]$/.test(String(x)),
  _normalizeDate:x=>typeof x==='string' && /^\d{4}-\d{2}-\d{2}$/.test(x)?x:'',
  _cleanCode:x=>String(x||'').trim(),
  _snapshotIntegrityKey:r=>String(r?.[1]||'').trim(),
  _buildSnapshotRowsFromTradeAndPriceHistory:()=>[copy(data[1])],
  _backupSnapshotBeforeWrite:(_ss,actualSheet)=>{
    assert.equal(actualSheet,sheet);
    backs.push('BACKUP_PREPARED');
    if(afterBackup)afterBackup(data);
    return {name:'SYNTHETIC_BACKUP'};
  },
  _markSnapshotBackupStatus:(_record,state)=>status.push(state),
  _cleanupCurrentSystemBackup:()=>backs.push('BACKUP_CLEANED'),
  _touchSnapshotIntegritySourceRevision:x=>revision.push(copy(x)),
  SpreadsheetApp:{flush:()=>{},getUi:()=>({alert:()=>{}})},
  Logger:{log:()=>{}},
 });
 vm.runInContext(code,ctx,{filename:'production-scoped-snapshot-cleanup.js'});
 const run=()=>copy(ctx._cleanupSnapshotDuplicatesLocked());
 return {run,data,original,backs,status,revision,writes,exists:(code)=>data.some(r=>r[1]===code)};
}
// 1. Exact 12-column duplicate: clear only one physical row.
// Inject unrelated other-date writer AFTER backup.
{
 const x=env({afterBackup:rows=>{
   rows[3][7]=777;rows[3][10]='EXTERNAL_KRX';rows[3][11]='NEW_FOREIGN_STAMP';
 }});
 const r=x.run();
 assert.equal(r.removedRows,1);
 assert.equal(r.duplicateRowsRemoved,1);
 assert.deepEqual(x.status,['COMPLETED']);
 assert.deepEqual(x.backs,['BACKUP_PREPARED','BACKUP_CLEANED']);
 assert.equal(x.writes.length,1);
 assert.deepEqual(x.writes[0],{r:3,c:1,h:1,w:12});
 assert.equal(x.data[1][1],'000111');
 assert.ok(x.data[2].every(v=>v===''),'duplicate row is blank at original position');
 assert.equal(x.data[3][7],777);
 assert.equal(x.data[3][10],'EXTERNAL_KRX');
 assert.equal(x.data[3][11],'NEW_FOREIGN_STAMP');
 assert.deepEqual(x.revision,[{dates:[d1]}]);
 console.log('ISSUE507_CLEANUP_OTHER_DATE_EXTERNAL_EDIT_PRESERVED');
}
// 2. A zero-unit fund row with M-column data is NOT safe to erase.
{
 const x=env({mode:'wideZero'});
 assert.throws(()=>x.run(),/SNAPSHOT_CLEANUP_UNSAFE_SOURCE_REQUIRES_REVIEW:.*CUSTOM_COLUMN_ROW/);
 assert.deepEqual(x.data,x.original);
 assert.deepEqual(x.backs,[]);
 console.log('ISSUE507_CLEANUP_USER_CUSTOM_SOURCE_BLOCKED');
}
// 3. If the doomed zero-unit fund has no M custom data, clear only its
// physical row. Another date's M stays attached to its original code.
{
 const x=env({mode:'wideZero'});
 x.data[1][12]='';
 const r=x.run();
 assert.equal(r.zeroUnitFundRowsRemoved,1);
 assert.equal(r.removedRows,1);
 assert.equal(x.data[2][1],'000222');
 assert.equal(x.data[2][12],'FOREIGN_EXTRA');
 assert.ok(x.data[1].every(v=>v===''));
 assert.equal(x.writes[0].w,13);
 console.log('ISSUE507_CLEANUP_ZERO_UNITS_NO_PHYSICAL_COMPACTION');
}
// 4. 13-column exact duplicates with unique extended metadata are held,
// NOT copied into the wrong security. Explicit manual review needed.
{
 const x=env({mode:'wideDuplicate'});
 assert.throws(()=>x.run(),/CUSTOM_COLUMN_ROW/);
 assert.deepEqual(x.data,x.original);
}
// 5. Clean identical 13-column duplicate with empty M only on removed row.
// The kept row's arbitrary M value and the other code's M survive intact.
{
 const x=env({mode:'wideDuplicate'});
 x.data[2][12]='';
 const r=x.run();
 assert.equal(r.duplicateRowsRemoved,1);
 assert.equal(x.data[1][12],'KEEP_EXTRA');
 assert.equal(x.data[3][12],'FOREIGN_EXTRA');
 assert.equal(x.data[3][1],'000222');
 assert.equal(x.writes[0].w,13);
}
// 6. Missing date cannot be reconstructed from the malformed row itself.
// Preserve payload, do not erase original ledger evidence.
{
 const x=env({mode:'missingDate'});
 const r=x.run();
 assert.equal(r.invalidDateRowsRemoved,0);
 assert.equal(r.invalidDateRowsBlocked,1);
 assert.equal(r.removedRows,0);
 assert.deepEqual(x.data,x.original);
 assert.deepEqual(x.writes,[]);
 console.log('ISSUE507_CLEANUP_MISSING_DATE_SOURCE_PRESERVED');
}
// 7. Any MANUAL duplicate is not an automatic cleanup target.
{
 const x=env({mode:'manual'});
 assert.throws(()=>x.run(),/SNAPSHOT_CLEANUP_UNSAFE_SOURCE_REQUIRES_REVIEW:.*DUPLICATE_MANUAL/);
 assert.deepEqual(x.data,x.original);
 assert.deepEqual(x.backs,[]);
}
// 8. A formula in the removal target must be blocked before creating backup.
{
 const x=env({formulaAt:[{row:3,col:7}]});
 assert.throws(()=>x.run(),/FORMULA_ROW/);
 assert.deepEqual(x.backs,[]);
 assert.deepEqual(x.data,x.original);
}
// 9. If target changes externally after backup, don't overwrite it.
{
 const x=env({afterBackup:rows=>{rows[2][10]='EXTERNAL_TARGET_SOURCE';}});
 assert.throws(()=>x.run(),/SNAPSHOT_CLEANUP_COMMIT_UNVERIFIED.*TARGET_CHANGED/);
 assert.equal(x.data[2][10],'EXTERNAL_TARGET_SOURCE');
 assert.deepEqual(x.writes,[]);
 assert.deepEqual(x.status,['WRITE_FAILED']);
}
// 10. A different client changes the keeper row after backup. Deleting
// the redundant row would silently destroy the only original keeper proof.
// Reject instead and keep the completed backup marked WRITE_FAILED.
{
 const x=env({afterBackup:rows=>{rows[1][10]='EXTERNAL_KEEPER_CHANGE';}});
 assert.throws(()=>x.run(),/SNAPSHOT_CLEANUP_COMMIT_UNVERIFIED.*KEEP_ROW_CHANGED/);
 assert.equal(x.data[1][10],'EXTERNAL_KEEPER_CHANGE');
 assert.equal(x.data[2][1],'000111','redundant original row must remain');
 assert.deepEqual(x.writes,[]);
 assert.deepEqual(x.status,['WRITE_FAILED']);
 assert.deepEqual(x.backs,['BACKUP_PREPARED']);
 console.log('ISSUE507_CLEANUP_KEEPER_ROW_EXTERNAL_CHANGE_BLOCKED');
}
// 11. Two intended removals, second write fails. First empty physical row
// remains explicitly COMMIT_UNVERIFIED for supervised recovery. Other dates
// remain unchanged and backup is retained.
{
 const x=env({mode:'doubleZero',failWriteAt:2});
 const beforeForeign=copy(x.data[3]);
 assert.throws(()=>x.run(),/SNAPSHOT_CLEANUP_COMMIT_UNVERIFIED.*SIMULATED_SECOND/);
 assert.ok(x.data[1].every(v=>v===''));
 assert.equal(x.data[2][1],'F00002');
 assert.deepEqual(x.data[3],beforeForeign);
 assert.deepEqual(x.status,['WRITE_FAILED']);
 assert.deepEqual(x.backs,['BACKUP_PREPARED']);
 assert.deepEqual(x.revision,[]);
 console.log('ISSUE507_CLEANUP_PARTIAL_FAILURE_PRESERVES_BACKUP');
}
console.log('ISSUE507_SNAPSHOT_CLEANUP_SCOPED_PRODUCTION_REGRESSION_OK_NOT_LIVE_SAFE');
