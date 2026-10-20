#!/usr/bin/env node
// #507: production _cleanupPriceHistoryDuplicatesLocked, synthetic VM only.
// Verifies physical-row scoped cleanup and explicit source-evidence gates.
// PASS is not an external Sheets API CAS or real-world restoration approval.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const gas=fs.readFileSync('src/gas/apps_script.gs','utf8');
const name='_cleanupPriceHistoryDuplicatesLocked';
const begin=gas.indexOf('function '+name+'('),end=gas.indexOf('\n}',begin);
assert.ok(begin>=0&&end>begin,'production cleanup function unavailable');
const source=gas.slice(begin,end+2);
assert.doesNotMatch(source,/ph\.clearContents\(|ph\.getRange\(2,\s*1,\s*deduped\.length/,
 'must not clear or copy entire price history');
const clone=x=>JSON.parse(JSON.stringify(x));
const d1='2026-01-14',d2='2026-01-15';
const base=(date,code,price=100,src='KRX',saved='',extra='')=>
 [date,code,'SYNTHETIC',price,saved,src,extra];
const header=['DATE','CODE','NAME','PRICE','SAVED','SRC','USER'];
const cases={
 standard:()=>[header.slice(0,6),base(d1,'000111',100).slice(0,6),
  base(d1,'000111',100).slice(0,6),base(d2,'000222',200).slice(0,6)],
 wide:()=>[header,base(d1,'000111',100,'KRX','',''),
  base(d1,'000111',100,'KRX','','ORIGINAL_USER'),base(d2,'000222',200,'OLD','','FOREIGN_USER')],
 manual:()=>[header.slice(0,6),base(d1,'000111',99,'MANUAL').slice(0,6),
  base(d1,'000111',105,'KRX').slice(0,6),base(d2,'000222',200).slice(0,6)],
 unsafeManual:()=>[header.slice(0,6),base(d1,'000111',99,'MANUAL').slice(0,6),
  base(d1,'000111',105,'MANUAL').slice(0,6),base(d2,'000222',200).slice(0,6)],
 timestamp:()=>[header.slice(0,6),base(d1,'000111',90,'KRX','2026-01-14 09:00:00').slice(0,6),
  base(d1,'000111',95,'TOSS','2026-01-14 10:00:00').slice(0,6),
  base(d1,'000111',100,'KRX','').slice(0,6),
  base(d2,'000222',200).slice(0,6)],
 triple:()=>[header.slice(0,6),base(d1,'000111',100).slice(0,6),
  base(d1,'000111',100).slice(0,6),base(d1,'000111',100).slice(0,6),
  base(d2,'000222',200).slice(0,6)],
 noDup:()=>[header.slice(0,6),base(d1,'000111',100).slice(0,6),
  base(d2,'000222',200).slice(0,6)],
};
function create({mode='standard',afterBackup,formula=[],failWriteAt=0}={}){
 const data=clone(cases[mode]());
 let setCall=0;
 const backups=[],statuses=[],revision=[],writes=[],alerts=[];
 const width=data[0].length;
 const sheet={
  getLastRow:()=>{
   for(let i=data.length-1;i>=0;i--)if(data[i].some(v=>v!==''&&v!=null))return i+1;
   return 0;
  },
  getLastColumn:()=>width,
  getRange:(r,c,n=1,w=1)=>{
   assert.ok(r>=1&&c>=1&&n>0&&w>0);
   const read=()=>Array.from({length:n},(_,i)=>Array.from({length:w},(_,j)=>data[r-1+i]?.[c-1+j]??''));
   return {
    getValues:()=>clone(read()),
    getFormulas:()=>Array.from({length:n},(_,i)=>
      Array.from({length:w},(_,j)=>formula.some(f=>f.row===r+i&&f.col===c+j)?'=EXTERNAL_FORMULA':'')),
    setValues:rows=>{
     assert.equal(rows.length,n);
     assert.ok(rows.every(rr=>rr.length===w),'setValues width mismatch');
     setCall++;
     if(failWriteAt&&setCall===failWriteAt)throw Error('SIMULATED_PRICE_CLEANUP_SECOND_WRITE_FAILURE');
     rows.forEach((rr,i)=>rr.forEach((v,j)=>{data[r-1+i][c-1+j]=v}));
     writes.push({r,c,n,w});
    }
   };
  }
 };
 const ss={getSheetByName:name=>name==='가격이력'?sheet:null};
 const ctx=vm.createContext({
  JSON,Array,Object,String,Number,
  CONFIG:{SHEET_PH:'가격이력'},
  getss:()=>ss,
  _normalizeDate:x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)?x:'',
  _cleanCode:x=>String(x||'').trim(),
  _normalizeDatetime:x=>String(x||'').trim(),
  _backupSheetBeforeWrite:(_ss,actualSheet,name)=>{
   assert.equal(actualSheet,sheet);
   assert.equal(name,'가격이력');
   backups.push('PREPARED');
   if(afterBackup)afterBackup(data);
   return {name:'SYNTHETIC_BACKUP'};
  },
  _touchSnapshotIntegritySourceRevision:x=>revision.push(clone(x)),
  _markSnapshotBackupStatus:(_b,state)=>statuses.push(state),
  _cleanupCurrentSystemBackup:()=>backups.push('CLEANED'),
  SpreadsheetApp:{flush:()=>{},getUi:()=>({alert:x=>alerts.push(x)})},
  Logger:{log:()=>{}}
 });
 vm.runInContext(source,ctx,{filename:'actual-production-price-duplicate-cleanup.js'});
 return {run:()=>ctx._cleanupPriceHistoryDuplicatesLocked(),data,writes,backups,statuses,revision,alerts};
}
{
 const x=create({afterBackup:rows=>{
  rows[3][3]=777;rows[3][5]='EXTERNAL_SOURCE';
 }});
 x.run();
 assert.ok(x.data[1].every(v=>v===''));
 assert.equal(x.data[2][1],'000111');
 assert.equal(x.data[3][3],777,'another date price must survive');
 assert.equal(x.data[3][5],'EXTERNAL_SOURCE');
 assert.deepEqual(x.writes,[{r:2,c:1,n:1,w:6}]);
 assert.deepEqual(x.revision,[{dates:[d1]}]);
 assert.deepEqual(x.statuses,['COMPLETED']);
 console.log('ISSUE507_PRICE_CLEANUP_OTHER_DATE_EXTERNAL_UPDATE_PRESERVED');
}
{
 const x=create({mode:'wide'});
 x.run();
 assert.equal(x.data[2][6],'ORIGINAL_USER','keeper custom evidence preserved');
 assert.equal(x.data[3][6],'FOREIGN_USER','different code custom evidence preserved');
 assert.ok(x.data[1].every(v=>v===''));
 assert.deepEqual(x.writes,[{r:2,c:1,n:1,w:7}]);
 console.log('ISSUE507_PRICE_CLEANUP_CUSTOM_COLUMNS_NOT_MOVED');
}
{
 const x=create({mode:'wide'});
 x.data[1][6]='LOSER_USER_DATA';
 assert.throws(()=>x.run(),/PRICE_CLEANUP_UNSAFE_EVIDENCE_REQUIRES_REVIEW.*CUSTOM_COLUMNS/);
 assert.equal(x.data[1][6],'LOSER_USER_DATA');
 assert.deepEqual(x.backups,[]);
}
{
 const x=create({mode:'manual'});
 x.run();
 assert.equal(x.data[1][3],99);
 assert.equal(x.data[1][5],'MANUAL');
 assert.ok(x.data[2].every(v=>v===''));
}
{
 const x=create({mode:'unsafeManual'});
 assert.throws(()=>x.run(),/PRICE_CLEANUP_UNSAFE_EVIDENCE_REQUIRES_REVIEW.*MANUAL_OR_TIMESTAMP/);
 assert.deepEqual(x.backups,[]);
}
{
 const x=create({mode:'timestamp'});
 assert.throws(()=>x.run(),/PRICE_CLEANUP_UNSAFE_EVIDENCE_REQUIRES_REVIEW.*MANUAL_OR_TIMESTAMP/,
  'older timestamped source is user evidence; do not automatically erase');
 assert.deepEqual(x.writes,[]);
}
{
 const x=create({mode:'standard',formula:[{row:2,col:4}]});
 assert.throws(()=>x.run(),/PRICE_CLEANUP_UNSAFE_EVIDENCE_REQUIRES_REVIEW.*FORMULA_OR_UNVERIFIED/);
 assert.deepEqual(x.backups,[]);
 console.log('ISSUE507_PRICE_CLEANUP_FORMULA_SOURCE_PROTECTED');
}
{
 const x=create({mode:'standard',afterBackup:rows=>{rows[1][5]='DIRECT_API';}});
 assert.throws(()=>x.run(),/PRICE_CLEANUP_COMMIT_UNVERIFIED.*TARGET_CHANGED/);
 assert.equal(x.data[1][5],'DIRECT_API');
 assert.deepEqual(x.writes,[]);
 assert.deepEqual(x.statuses,['WRITE_FAILED']);
 console.log('ISSUE507_PRICE_CLEANUP_TARGET_DRIFT_BLOCKED');
}
{
 const x=create({mode:'standard',afterBackup:rows=>{rows[2][3]=500;}});
 assert.throws(()=>x.run(),/PRICE_CLEANUP_COMMIT_UNVERIFIED.*KEEPER_CHANGED/);
 assert.equal(x.data[2][3],500);
 assert.equal(x.data[1][1],'000111');
 assert.deepEqual(x.writes,[]);
 assert.deepEqual(x.statuses,['WRITE_FAILED']);
 console.log('ISSUE507_PRICE_CLEANUP_KEEPER_DRIFT_BLOCKED');
}
{
 const x=create({mode:'triple',failWriteAt:2});
 assert.throws(()=>x.run(),/PRICE_CLEANUP_COMMIT_UNVERIFIED.*SIMULATED_PRICE_CLEANUP_SECOND_WRITE_FAILURE/);
 assert.ok(x.data[1].every(v=>v===''));
 assert.ok(x.data[2].every(v=>v===''));
 assert.equal(x.data[3][1],'000111');
 assert.equal(x.data[4][1],'000222');
 assert.deepEqual(x.statuses,['WRITE_FAILED']);
 assert.deepEqual(x.backups,['PREPARED']);
 assert.deepEqual(x.revision,[]);
 console.log('ISSUE507_PRICE_CLEANUP_PARTIAL_FAILURE_BACKUP_HELD');
}
{
 const x=create({mode:'noDup'});
 x.run();
 assert.deepEqual(x.writes,[]);
 assert.deepEqual(x.backups,[]);
 assert.deepEqual(x.revision,[]);
}
console.log('ISSUE507_PRICE_CLEANUP_SCOPED_PRODUCTION_CONTRACT_OK_SAME_CELL_TOCTOU_UNSOLVED');
