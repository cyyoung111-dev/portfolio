#!/usr/bin/env node
// #507 — actual production _cleanupSnapshotDuplicatesLocked isolated VM repro.
// Pure synthetic rows; no production Spreadsheet, GAS deployment or credentials.
// A PASS means the KNOWN-UNSAFE cleanup can lose external edits and custom cols.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const gas=fs.readFileSync('src/gas/apps_script.gs','utf8');
const func='_cleanupSnapshotDuplicatesLocked';
const start=gas.indexOf('function '+func+'('),end=gas.indexOf('\n}',start);
assert.ok(start>=0 && end>start,'production Snapshot duplicate cleanup not found');
const source=gas.slice(start,end+2);
assert.match(source,/sh\.getRange\(1,\s*1,\s*output\.length,\s*colSize\)\.setValues\(output\)/,
 'whole-sheet 12-column rewrite changed: replace this known-unsafe reproducer with preservation regression');
const clone=x=>JSON.parse(JSON.stringify(x));
const d1='2026-01-14',d2='2026-01-15';
const header=['DATE','CODE','NAME','QTY','BUY_PRICE','COST','PRICE','VALUE','PNL','RETURN','SOURCE','SAVED','CUSTOM'];
const row=(date,code,source,custom)=>[date,code,'SYNTH',1,10,10,12,12,2,20,source,'',custom];
const starting=[
 header,
 row(d1,'000111','OLD_A','FIRST_CUSTOM'),
 row(d1,'000111','OLD_A','DUPLICATE_SECOND_CUSTOM'),
 row(d2,'000222','OLD_B','FOREIGN_CUSTOM'),
];
const rowHas=(r)=>r.some(v=>v!==''&&v!=null);
function runCleanup({afterBackup}={}){
 const data=clone(starting),writes=[],backups=[],stages=[],revisions=[],ui=[];
 const sheet={
  getLastRow:()=>{
    for(let i=data.length-1;i>=0;i--)if(rowHas(data[i]))return i+1;
    return 0;
  },
  getLastColumn:()=>13,
  getRange:(r,c,h,w)=>{
    assert.ok(r>=1 && c>=1 && h>=1 && w>=1);
    return {
      getValues:()=>Array.from({length:h},(_,i)=>Array.from({length:w},(_,j)=>data[r-1+i]?.[c-1+j]??'')),
      setValues:values=>{
        assert.equal(values.length,h);
        assert.ok(values.every(v=>v.length===w),'physical Range.setValues dimension invariant');
        values.forEach((row,i)=>{
          data[r-1+i] ||= Array(13).fill('');
          row.forEach((value,j)=>{data[r-1+i][c-1+j]=value});
        });
        writes.push({r,c,h,w});
      },
    };
  },
 };
 const ss={getSheetByName:name=>name==='스냅샷'?sheet:null};
 const initialLen=data.length;
 const ctx=vm.createContext({
  JSON,Math,Array,Object,String,Number,parseFloat,parseInt,
  CONFIG:{SHEET_SNAPSHOT:'스냅샷'},
  getss:()=>ss,
  _readFundUnits:()=>[],
  _fundUnitsAtDate:()=>({units:1}),
  _isFundCode:()=>false,
  _normalizeDate:s=>typeof s==='string' && /^\d{4}-\d{2}-\d{2}$/.test(s)?s:'',
  _cleanCode:s=>String(s||'').trim(),
  _snapshotIntegrityKey:r=>String(r?.[1]||'').trim(),
  _buildSnapshotRowsFromTradeAndPriceHistory:()=>[clone(starting[1])],
  _classifyRawSnapshotDuplicateGroups:(date,rows)=>{
    // Exact same date/code/12 financial columns (no manual or source conflict).
    if(date!==d1 || rows.length<2)return [];
    assert.deepEqual(rows[0].slice(0,12),rows[1].slice(0,12));
    return [{date,key:'000111',classification:'EXACT_DUPLICATE',
      rawRowCount:2,uniqueRowCount:1,keepRow:clone(rows[0]),autoResolvable:true}];
  },
  _snapshotComparableSignature:r=>JSON.stringify(r.slice(0,12)),
  _backupSnapshotBeforeWrite:(_ss,_sheet)=>{
    assert.equal(_sheet,sheet);backups.push('BACKUP_PREPARED');
    if(afterBackup)afterBackup(data);
    return {name:'SYNTHETIC_BACKUP',source:'스냅샷'};
  },
  _markSnapshotBackupStatus:(record,status)=>{stages.push(status);},
  _cleanupCurrentSystemBackup:()=>{backups.push('BACKUP_CLEANED')},
  _touchSnapshotIntegritySourceRevision:x=>{revisions.push(clone(x))},
  SpreadsheetApp:{flush:()=>{},getUi:()=>({alert:t=>ui.push(t)})},
  Logger:{log:()=>{}},
 });
 vm.runInContext(source,ctx,{filename:'production-snapshot-duplicate-cleanup.js'});
 const result=clone(ctx._cleanupSnapshotDuplicatesLocked());
 return {data,result,writes,backups,stages,revisions,ui,initialLen};
}
// Baseline: one exact duplicate is eligible for cleanup. No live service.
{
 const t=runCleanup();
 assert.equal(t.result.removedRows,1);
 assert.equal(t.result.exactDuplicateGroups,1);
 assert.deepEqual(t.stages,['COMPLETED']);
 assert.equal(t.data[2][1],'000222');
 // Even with NO external edit, a 13th user-managed column stays in its old
 // physical slot while the standard 12 columns move to the preceding row.
 assert.equal(t.data[2][12],'DUPLICATE_SECOND_CUSTOM',
   'KNOWN_UNSAFE: moved foreign row inherits stale custom column from duplicate');
 assert.equal(t.data[3][12],'FOREIGN_CUSTOM',
   'KNOWN_UNSAFE: old physical row retains detached foreign custom value');
 assert.equal(t.writes[0].w,12);
 console.log('ISSUE507_KNOWN_UNSAFE_CLEANUP_CUSTOM_COLUMN_MISASSOCIATION');
}
// Read original Snapshot -> create backup -> other Sheets client writes new
// market/source and custom metadata on ANOTHER date -> full-sheet overwrite.
// The production cleanup reports COMPLETED despite discarding those edits.
{
 const t=runCleanup({afterBackup:rows=>{
   rows[3][7]=777;
   rows[3][10]='EXTERNAL_NEW_SOURCE';
   rows[3][11]='EXTERNAL_SAVED_AT';
   rows[3][12]='EXTERNAL_CUSTOM_VALUE';
 }});
 assert.equal(t.result.removedRows,1);
 assert.deepEqual(t.stages,['COMPLETED']);
 assert.deepEqual(t.backups,['BACKUP_PREPARED','BACKUP_CLEANED']);
 const moved=t.data.find(r=>r[0]===d2);
 assert.ok(moved,'unrelated date remains visible');
 assert.equal(moved[7],12,'KNOWN_UNSAFE: external value update was discarded');
 assert.equal(moved[10],'OLD_B','KNOWN_UNSAFE: external source update was discarded');
 assert.equal(moved[11],'','KNOWN_UNSAFE: external timestamp was discarded');
 assert.equal(moved[12],'DUPLICATE_SECOND_CUSTOM','KNOWN_UNSAFE: custom field follows wrong physical row');
 assert.equal(t.data[3][12],'EXTERNAL_CUSTOM_VALUE','orphan custom remains after removal');
 assert.equal(t.writes.length,1);
 assert.ok(t.revisions.length>0);
 console.log('ISSUE507_KNOWN_UNSAFE_CLEANUP_OTHER_DATE_EXTERNAL_LOST_UPDATE');
}
console.log('ISSUE507_CLEANUP_PRODUCTION_UNSAFE_REPRO_OK_NOT_FIXED');
