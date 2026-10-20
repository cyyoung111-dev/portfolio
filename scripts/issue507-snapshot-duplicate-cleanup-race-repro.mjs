#!/usr/bin/env node
// Issue #507 — run actual production duplicate-cleanup + classifier in an
// isolated Node VM. PASS documents existing KNOWN-UNSAFE behavior, NOT a fix.
// Synthetic workbook only: no GAS deployment or Google Sheets credentials.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const gas=fs.readFileSync('src/gas/apps_script.gs','utf8');
function functionSource(name) {
  const start=gas.indexOf('function '+name+'(');
  const end=gas.indexOf('\n}',start);
  assert.ok(start>=0 && end>start, 'production function missing: '+name);
  return gas.slice(start,end+2);
}
const production=[
  '_snapshotComparableSignature',
  '_classifyRawSnapshotDuplicateGroups',
  '_cleanupSnapshotDuplicatesLocked',
].map(functionSource).join('\n');
assert.match(production,/sh\.getRange\(1,\s*1,\s*output\.length,\s*colSize\)\.setValues\(output\)/,
 'production full 12-column cleanup rewrite no longer present; rewrite this known-unsafe oracle');
const clone=x=>JSON.parse(JSON.stringify(x));
const dateA='2026-01-14',dateB='2026-01-15';
const header=['DATE','CODE','NAME','QTY','BUY_PRICE','COST','PRICE','VALUE','PNL','RETURN','SOURCE','SAVED','CUSTOM'];
const row=(d,code,source,custom)=>[d,code,'SYNTH',1,10,10,12,12,2,20,source,'',custom];
const originals={
  duplicate12:[
    header.slice(0,12),
    row(dateA,'000111','OLD_A','FIRST_CUSTOM').slice(0,12),
    row(dateA,'000111','OLD_A','DUPLICATE_SECOND_CUSTOM').slice(0,12),
    row(dateB,'000222','OLD_B','FOREIGN_CUSTOM').slice(0,12),
  ],
  // For a 13-column duplicate, the production classifier's keepRow retains
  // the physical width but its output header/unchanged rows are only 12 wide.
  // This can fail before performing even the dangerous full rewrite.
  duplicateWide:[
    header,row(dateA,'000111','OLD_A','FIRST_CUSTOM'),
    row(dateA,'000111','OLD_A','DUPLICATE_SECOND_CUSTOM'),
    row(dateB,'000222','OLD_B','FOREIGN_CUSTOM'),
  ],
  // A zero-unit fund removal doesn't rely on the classifier keepRow, so
  // 12-column compaction succeeds and misattaches column 13 to another code.
  zeroWide:[
    header,row(dateA,'F00001','FUND_NAV_ZERO_UNITS','ZERO_FUND_CUSTOM'),
    row(dateB,'000222','OLD_B','FOREIGN_CUSTOM'),
  ],
};
const payload=r=>r.some(x=>x!==''&&x!=null);
function runCleanup({mode='duplicate12',afterBackup}={}) {
  const stored=clone(originals[mode]);
  assert.ok(stored,'unknown synthetic test mode');
  const width=mode==='duplicate12'?12:13;
  const writes=[],backups=[],statuses=[],revisions=[],alerts=[];
  const sheet={
    getLastRow:()=>{
      for(let i=stored.length-1;i>=0;i--)if(payload(stored[i]))return i+1;
      return 0;
    },
    getLastColumn:()=>width,
    getRange:(r,c,h,w)=>{
      assert.ok(r>=1&&c>=1&&h>=1&&w>=1);
      return{
        getValues:()=>Array.from({length:h},(_,i)=>
          Array.from({length:w},(_,j)=>stored[r-1+i]?.[c-1+j]??'')),
        setValues:values=>{
          assert.equal(values.length,h,'Range.setValues row count');
          assert.ok(values.every(v=>v.length===w),'Range.setValues width mismatch');
          values.forEach((rr,i)=>{
            stored[r-1+i] ||= Array(width).fill('');
            rr.forEach((x,j)=>{stored[r-1+i][c-1+j]=x});
          });
          writes.push({r,c,h,w});
        },
      };
    },
  };
  const ss={getSheetByName:name=>name==='스냅샷'?sheet:null};
  const context=vm.createContext({
    JSON,Math,Array,Object,String,Number,
    CONFIG:{SHEET_SNAPSHOT:'스냅샷'},
    getss:()=>ss,
    _readFundUnits:()=>[],
    _fundUnitsAtDate:()=>({units:0}),
    _isFundCode:code=>String(code)==='F00001',
    _normalizeDate:x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)?x:'',
    _cleanCode:x=>String(x||'').trim(),
    _snapshotIntegrityKey:r=>String(r?.[1]||'').trim(),
    _buildSnapshotRowsFromTradeAndPriceHistory:()=>[clone(originals.duplicate12[1])],
    _backupSnapshotBeforeWrite:(_ss,actualSheet)=>{
      assert.equal(actualSheet,sheet);
      backups.push('BACKUP_PREPARED');
      if(afterBackup)afterBackup(stored);
      return {name:'SYNTH_BACKUP'};
    },
    _markSnapshotBackupStatus:(_record,status)=>{statuses.push(status)},
    _cleanupCurrentSystemBackup:()=>backups.push('BACKUP_CLEANED'),
    _touchSnapshotIntegritySourceRevision:impact=>revisions.push(clone(impact)),
    SpreadsheetApp:{flush:()=>{},getUi:()=>({alert:x=>alerts.push(x)})},
    Logger:{log:()=>{}},
  });
  vm.runInContext(production,context,{filename:'production-duplicate-cleanup.js'});
  let result=null,error=null;
  try{result=clone(context._cleanupSnapshotDuplicatesLocked());}
  catch(e){error=String(e?.message||e);}
  return{result,error,stored,writes,statuses,backups,revisions,alerts};
}
// Exact duplicates on a standard 12-column Snapshot are still cleaned.
// The readback verifies the writer's OWN stale data, not an external edit.
{
 const t=runCleanup();
 assert.equal(t.error,null);
 assert.equal(t.result.removedRows,1);
 assert.equal(t.result.exactDuplicateGroups,1);
 assert.deepEqual(t.statuses,['COMPLETED']);
 assert.deepEqual(t.backups,['BACKUP_PREPARED','BACKUP_CLEANED']);
 assert.equal(t.writes.length,1);
 assert.equal(t.writes[0].w,12);
 assert.equal(t.stored[2][1],'000222');
}
// External editor updates another date AFTER initial snapshot read but before
// cleanup rewrites all original data. Production reports successful cleanup.
{
 const t=runCleanup({afterBackup:rows=>{
   rows[3][7]=777;
   rows[3][10]='EXTERNAL_NEW_SOURCE';
   rows[3][11]='EXTERNAL_TIMESTAMP';
 }});
 assert.equal(t.error,null);
 assert.equal(t.result.removedRows,1);
 assert.deepEqual(t.statuses,['COMPLETED']);
 const foreign=t.stored.find(r=>r[0]===dateB);
 assert.ok(foreign);
 assert.equal(foreign[7],12,'known unsafe: third-party market value lost');
 assert.equal(foreign[10],'OLD_B','known unsafe: third-party provenance lost');
 assert.equal(foreign[11],'','known unsafe: third-party saved time lost');
 assert.equal(t.writes.length,1);
 assert.ok(t.revisions.length);
 console.log('ISSUE507_KNOWN_UNSAFE_CLEANUP_OTHER_DATE_EXTERNAL_LOST_UPDATE');
}
// A different zero-unit maintenance path on 13-column Snapshot silently
// moves A:L rows but leaves custom M physically attached to the old slot.
{
 const t=runCleanup({mode:'zeroWide'});
 assert.equal(t.error,null);
 assert.equal(t.result.zeroUnitFundRowsRemoved,1);
 assert.deepEqual(t.statuses,['COMPLETED']);
 assert.equal(t.stored[1][1],'000222');
 assert.equal(t.stored[1][12],'ZERO_FUND_CUSTOM','custom M belongs to deleted fund not surviving stock');
 assert.equal(t.stored[2][12],'FOREIGN_CUSTOM','stock M now orphaned in cleared row');
 assert.equal(t.writes[0].w,12);
 console.log('ISSUE507_KNOWN_UNSAFE_CLEANUP_CUSTOM_COLUMN_MISASSOCIATION');
}
// 13-column true duplicate uses actual classifier keepRow (13 cells), but
// downstream range writer requires 12. This surfaces WRITE_FAILED, not
// success; never mislabel this failure as a lost update.
{
 const t=runCleanup({mode:'duplicateWide'});
 assert.match(t.error||'',/Range\.setValues width mismatch/);
 assert.deepEqual(t.statuses,['WRITE_FAILED']);
 assert.deepEqual(t.backups,['BACKUP_PREPARED']);
 assert.equal(t.writes.length,0);
 assert.equal(t.stored[2][1],'000111');
 console.log('ISSUE507_KNOWN_UNSAFE_CLEANUP_13COL_DUPLICATE_WIDTH_FAILURE');
}
console.log('ISSUE507_CLEANUP_PRODUCTION_KNOWN_UNSAFE_REPRO_OK_NOT_FIXED');
