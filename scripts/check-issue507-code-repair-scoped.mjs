#!/usr/bin/env node
// Issue #507 — execute REAL production _repairKnownCodeColumns against synthetic
// sheets. Never touches live spreadsheet, external services or credentials.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync('src/gas/apps_script.gs','utf8');
const start=source.indexOf('function _repairKnownCodeColumns('),end=source.indexOf('\n}',start);
assert.ok(start>=0&&end>start,'GAS production repair function missing');
const fn=source.slice(start,end+2);
assert.doesNotMatch(fn,/range\.setValues\(values\)|_setCodeColumnText\(sheet,\s*column\)/,
  'must not format or rewrite entire known-code column');
const copy=x=>JSON.parse(JSON.stringify(x));
const cfg={SHEET_CODES:'Codes',SHEET_TRADES:'Trades',SHEET_PH:'Price',
  SHEET_SNAPSHOT:'Snapshot'};
const base={
  Codes:[['Code','Name','Type'],['000123','KNOWN','ETF']],
  Trades:[['date','x','x','x','code','extra'],['2026-01-14','A','','',123,'TRADE_EXT'],['2026-01-15','B','','','000999','FOREIGN_EXT']],
  Price:[['date','code','name','price','time','src','custom'],['2026-01-14',123,'KNOWN',100,'','KRX','ORIGINAL_EXT'],['2026-01-15','000999','OTHER',200,'','TOSS','FOREIGN_EXT']],
  Snapshot:[['date','code','name','qty'],['2026-01-14','000123','KNOWN',1]],
};
function environment({books=base,afterBackup,formula=[],failWriteAt=0}={}){
  const data=copy(books),original=copy(data),writes=[],formats=[],statuses=[],backups=[],rev=[];
  let writeCount=0;
  const sheets={};
  for(const [name,rows] of Object.entries(data)){
    sheets[name]={
      getLastRow:()=>rows.length,
      getRange:(r,c,h=1,w=1)=>{
        assert.ok(r>0&&c>0&&h>0&&w>0);
        const read=()=>Array.from({length:h},(_,i)=>Array.from({length:w},(_,j)=>rows[r-1+i]?.[c-1+j]??''));
        return {
          getValues:()=>copy(read()),
          getFormulas:()=>Array.from({length:h},(_,i)=>Array.from({length:w},(_,j)=>
            formula.some(t=>t.sheet===name&&t.row===r+i&&t.col===c+j)?'=EXTERNAL_FORMULA':'')),
          setNumberFormat:f=>{formats.push({sheet:name,r,c,h,w,f});},
          setValues:values=>{
            assert.equal(values.length,h);assert.ok(values.every(a=>a.length===w));
            writeCount++;
            if(failWriteAt&&writeCount===failWriteAt)
              throw Error('SYNTHETIC_SECOND_CELL_WRITE_FAILURE');
            values.forEach((a,i)=>a.forEach((v,j)=>{rows[r-1+i][c-1+j]=v}));
            writes.push({sheet:name,r,c,h,w});
          }
        };
      }
    };
  }
  const ctx=vm.createContext({
    JSON,Array,Object,String,Number,
    CONFIG:cfg,FUND_NAV_SHEET:'FundNav',FUND_UNITS_SHEET:'FundUnits',
    getCodeItems:()=>[{code:'000123'}],
    _codeColumnForSheet:name=>name==='Trades'?5:name==='Codes'?1:2,
    _cleanCode:x=>{
      const s=String(x??'').trim().toUpperCase();
      return /^\d+$/.test(s)?s.padStart(6,'0'):s;
    },
    _backupSheetBeforeWrite:(_ss,sheet,name)=>{
      assert.equal(sheet,sheets[name]);backups.push(name);
      if(afterBackup)afterBackup(data,name);
      return {name:'BACKUP_'+name};
    },
    _touchSnapshotIntegritySourceRevision:x=>rev.push(copy(x)),
    _markSnapshotBackupStatus:(backup,status)=>statuses.push({name:backup.name,status}),
    _cleanupCurrentSystemBackup:(_ss,b)=>'SYNTH_CLEANED',
    SpreadsheetApp:{flush:()=>{}},
  });
  const ss={getSheetByName:n=>sheets[n]||null};
  vm.runInContext(fn,ctx,{filename:'real-production-code-repair.js'});
  return {run:()=>copy(ctx._repairKnownCodeColumns(ss)),data,original,writes,formats,statuses,backups,rev};
}
// Only corrupted code cells are changed, with leading zeros preserved.
// An external API write to *another date* after backup must survive.
{
 const x=environment({afterBackup:(d,name)=>{
   if(name==='Price'){d.Price[2][3]=777;d.Price[2][5]='EXTERNAL_KRX';d.Price[2][6]='EXTERNAL_CUSTOM';}
 }});
 const res=x.run();
 assert.equal(res.reduce((sum,y)=>sum+y.repaired,0),2);
 assert.deepEqual(x.writes,[{sheet:'Trades',r:2,c:5,h:1,w:1},{sheet:'Price',r:2,c:2,h:1,w:1}]);
 assert.ok(x.formats.every(x=>x.h===1&&x.w===1&&x.f==='@'));
 assert.equal(x.data.Trades[1][4],'000123');
 assert.equal(x.data.Trades[2][5],'FOREIGN_EXT');
 assert.equal(x.data.Price[1][1],'000123');
 assert.equal(x.data.Price[1][6],'ORIGINAL_EXT');
 assert.equal(x.data.Price[2][3],777);
 assert.equal(x.data.Price[2][5],'EXTERNAL_KRX');
 assert.equal(x.data.Price[2][6],'EXTERNAL_CUSTOM');
 assert.equal(x.rev.length,2);
 console.log('ISSUE507_CODE_REPAIR_OTHER_DATE_EXTERNAL_UPDATE_PRESERVED');
}
// A canonical code already fixed in every sheet means zero writes and no
// formatting changes or backup, not merely an idempotent full-column write.
{
 const x=environment({books:{
   Codes:copy(base.Codes),Price:[copy(base.Price[0]),['2026-01-14','000123','KNOWN',100,'','KRX','META']],
 }});
 assert.equal(x.run().every(y=>y.repaired===0),true);
 assert.deepEqual(x.writes,[]);
 assert.deepEqual(x.formats,[]);
 assert.deepEqual(x.backups,[]);
 assert.deepEqual(x.rev,[]);
}
// Code not found in master is not 'repaired' and trim-only mutations are
// not allowed to affect unrelated rows.
{
 const x=environment({books:{
  Codes:copy(base.Codes),Price:[copy(base.Price[0]),['2026-01-14',' 000999 ','UNKNOWN',100,'','OLD','USER']],
 }});
 assert.ok(x.run().every(y=>y.repaired===0));
 assert.equal(x.data.Price[1][1],' 000999 ');
 assert.deepEqual(x.writes,[]);
}
// External changed the same target code between the initial bulk read and
// backup must fail closed without writing the stale replacement.
{
 const x=environment({afterBackup:(d,n)=>{if(n==='Trades')d.Trades[1][4]='000555';}});
 assert.throws(()=>x.run(),/CODE_REPAIR_COMMIT_UNVERIFIED.*CODE_REPAIR_TARGET_IDENTITY_CHANGED/);
 assert.equal(x.data.Trades[1][4],'000555');
 assert.deepEqual(x.writes,[]);
 assert.deepEqual(x.statuses,[{name:'BACKUP_Trades',status:'WRITE_FAILED'}]);
 console.log('ISSUE507_CODE_REPAIR_TARGET_DRIFT_BLOCKED');
}
// Date/name changes on target physical row are identity changes, even if
// the old code happens to match after an external sort.
{
 const x=environment({afterBackup:(d,n)=>{if(n==='Trades')d.Trades[1][0]='2026-01-20';}});
 assert.throws(()=>x.run(),/CODE_REPAIR_TARGET_IDENTITY_CHANGED/);
 assert.equal(x.data.Trades[1][0],'2026-01-20');
 assert.deepEqual(x.writes,[]);
}
// A formula returning a damaged code is evidence and must not be overwritten.
{
 const x=environment({formula:[{sheet:'Trades',row:2,col:5}]});
 assert.throws(()=>x.run(),/CODE_REPAIR_FORMULA_PROTECTED/);
 assert.deepEqual(x.writes,[]);
 assert.deepEqual(x.backups,[]);
 console.log('ISSUE507_CODE_REPAIR_FORMULA_PROTECTED');
}
// Failure during 2nd corrected sheet preserves its backup and the already
// committed first sheet; no false multi-sheet atomicity claim.
{
 const x=environment({failWriteAt:2});
 assert.throws(()=>x.run(),/CODE_REPAIR_COMMIT_UNVERIFIED.*SYNTHETIC_SECOND_CELL_WRITE_FAILURE/);
 assert.equal(x.data.Trades[1][4],'000123');
 assert.equal(x.data.Price[1][1],123);
 assert.deepEqual(x.statuses,[{name:'BACKUP_Trades',status:'COMPLETED'},{name:'BACKUP_Price',status:'WRITE_FAILED'}]);
 assert.deepEqual(x.rev,[{all:true}]);
 console.log('ISSUE507_CODE_REPAIR_PARTIAL_MULTI_SHEET_FAILURE_HELD');
}
console.log('ISSUE507_CODE_REPAIR_SCOPED_PRODUCTION_REGRESSION_OK_SAME_CELL_TOCTOU_UNSOLVED');
