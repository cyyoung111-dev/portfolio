#!/usr/bin/env node
// #507 — isolate actual GAS _repairKnownCodeColumns in a Node VM.
// All rows synthetic. No Google Sheets or production credentials.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const gas=fs.readFileSync('src/gas/apps_script.gs','utf8');
const name='_repairKnownCodeColumns';
const pos=gas.indexOf('function '+name+'('),end=gas.indexOf('\n}',pos);
assert.ok(pos>=0&&end>pos,'real GAS repair implementation required');
const functionBody=gas.slice(pos,end+2);
assert.doesNotMatch(functionBody,/range\.setValues\(values\)|_setCodeColumnText\(sheet,\s*column\)/,
 'must not reformat or overwrite every code column cell');
const dup=x=>JSON.parse(JSON.stringify(x));
const initial=[
 ['DATE','CODE','NAME','COST','USER'],
 ['2026-01-14',123,'TARGET','10','=USER_OTHER_COLUMN'],
 ['2026-01-15','000999','FOREIGN','20','FOREIGN_EXTRA'],
 ['2026-01-16','ABC-XYZ','UNKNOWN','30','FOREIGN_2'],
 ['2026-01-17',123,'TARGET-2','40',''],
 ['2026-01-18',' 000123 ','PRESERVE_FORMAT','50',''],
];
const getFmt=(list)=>list.map(x=>x.row+':'+x.col+':'+x.fmt);
function env({beforeWrite,afterBackup,failWriteAt=0,formulaAt=[]}={}) {
 const data=dup(initial),write=[],format=[],backup=[],status=[],revision=[],observed=[],sheets={};
 let writeCount=0,applied=false;
 const sheet={
  getLastRow:()=>data.length,
  getLastColumn:()=>5,
  getRange:(r,c,n=1,w=1)=>{
   assert.ok(r>=1&&c>=1&&n>=1&&w>=1);
   const values=()=>Array.from({length:n},(_,i)=>Array.from({length:w},(_,j)=>data[r-1+i]?.[c-1+j]??''));
   return {
    getValues:()=>dup(values()),
    getFormulas:()=>Array.from({length:n},(_,i)=>Array.from({length:w},(_,j)=>
      formulaAt.some(p=>p.row===r+i&&p.col===c+j)?'=FORMULA':'')),
    setNumberFormat:(fmt)=>{format.push({row:r,col:c,fmt});},
    setValues:(rows)=>{
      assert.equal(rows.length,n);
      assert.ok(rows.every(x=>x.length===w));
      writeCount++;
      if(beforeWrite&&!applied){applied=true;beforeWrite(data);}
      if(failWriteAt&&writeCount===failWriteAt)throw Error('SIMULATED_SECOND_CODE_WRITE_FAILURE');
      rows.forEach((line,i)=>line.forEach((x,j)=>{data[r-1+i][c-1+j]=x}));
      write.push({r,c,n,w});
    },
   };
  },
 };
 sheets['가격이력']=sheet;
 const ss={getSheetByName:n=>sheets[n]||null};
 const ctx=vm.createContext({
  CONFIG:{SHEET_CODES:'종목',SHEET_TRADES:'거래',SHEET_PH:'가격이력',SHEET_SNAPSHOT:'스냅샷'},
  FUND_NAV_SHEET:'NAV',FUND_UNITS_SHEET:'좌수',
  getCodeItems:()=>[{code:'000123'},{code:'000999'}],
  _codeColumnForSheet:n=>n==='가격이력'?2:1,
  _cleanCode:x=>{
    const v=String(x||'').trim();
    return /^\d+$/.test(v)?v.padStart(6,'0'):/^[A-Z0-9]+(?:[.-][A-Z0-9]+)*$/.test(v)?v:'';
  },
  _backupSheetBeforeWrite:(_ss,actual,name)=>{
    assert.equal(actual,sheet);assert.equal(name,'가격이력');
    backup.push('CREATED');
    if(afterBackup)afterBackup(data);
    return {name:'SYNTH_BACKUP'};
  },
  _markSnapshotBackupStatus:(_,value)=>{status.push(value);},
  _cleanupCurrentSystemBackup:()=>{backup.push('CLEANED');return 'CLEANED';},
  _touchSnapshotIntegritySourceRevision:v=>{revision.push(dup(v));},
  SpreadsheetApp:{flush:()=>{}},
 });
 vm.runInContext(functionBody,ctx,{filename:'real-code-column-repair.js'});
 return{run:()=>dup(ctx._repairKnownCodeColumns(ss)),data,write,format,backup,status,revision,observed};
}
// 1. Only numeric damaged master-backed code cells are written; unrelated
// date, name, custom values (including formulas in other columns) untouched.
{
 const x=env({afterBackup:rows=>{
   rows[2][3]='EXTERNAL_20';
   rows[2][4]='EXTERNAL_FOREIGN_EXTRA';
 }});
 const result=x.run();
 assert.equal(result.length,1);
 assert.equal(result[0].repaired,2);
 assert.equal(x.data[1][1],'000123');
 assert.equal(x.data[4][1],'000123');
 assert.equal(x.data[2][3],'EXTERNAL_20');
 assert.equal(x.data[2][4],'EXTERNAL_FOREIGN_EXTRA');
 assert.equal(x.data[3][1],'ABC-XYZ');
 assert.equal(x.data[5][1],' 000123 ','unmodified whitespace cell not normalized opportunistically');
 assert.deepEqual(x.write,[{r:2,c:2,n:1,w:1},{r:5,c:2,n:1,w:1}]);
 assert.deepEqual(getFmt(x.format),['2:2:@','5:2:@']);
 assert.deepEqual(x.status,['COMPLETED']);
 assert.deepEqual(x.revision,[{all:true}]);
 console.log('ISSUE507_CODE_REPAIR_UNRELATED_ROWS_AND_FORMATS_PRESERVED');
}
// 2. Different input has no master-backed repair. No sheet format side effect.
{
 const x=env();
 x.data[1][1]='000123';x.data[4][1]='000123';
 const result=x.run();
 assert.equal(result[0].repaired,0);
 assert.deepEqual(x.format,[]);
 assert.deepEqual(x.write,[]);
 assert.deepEqual(x.backup,[]);
 assert.deepEqual(x.revision,[]);
}
// 3. The code column can contain a formula. Never overwrite its source.
{
 const x=env({formulaAt:[{row:2,col:2}]});
 assert.throws(()=>x.run(),/CODE_REPAIR_FORMULA_OR_UNVERIFIED/);
 assert.deepEqual(x.write,[]);
 assert.deepEqual(x.backup,[]);
 console.log('ISSUE507_CODE_REPAIR_SOURCE_FORMULA_BLOCKED');
}
// 4. A target code changes externally after backup but before commit.
{
 const x=env({afterBackup:rows=>{rows[1][1]='999999';}});
 assert.throws(()=>x.run(),/CODE_REPAIR_COMMIT_UNVERIFIED.*PHYSICAL_ROW_CHANGED/);
 assert.equal(x.data[1][1],'999999');
 assert.deepEqual(x.write,[]);
 assert.deepEqual(x.status,['WRITE_FAILED']);
 assert.deepEqual(x.backup,['CREATED']);
}
// 5. An external writer reassigns target row to another code/name.
{
 const x=env({afterBackup:rows=>{rows[1][2]='FOREIGN_REASSIGNED';}});
 assert.throws(()=>x.run(),/CODE_REPAIR_COMMIT_UNVERIFIED.*PHYSICAL_ROW_CHANGED/);
 assert.equal(x.data[1][2],'FOREIGN_REASSIGNED');
 assert.deepEqual(x.write,[]);
 assert.deepEqual(x.status,['WRITE_FAILED']);
}
// 6. Failure on the second cell doesn't roll back into uncertain physical
// positions. Preserve completed backup and flag the partial state.
{
 const x=env({failWriteAt:2});
 assert.throws(()=>x.run(),/CODE_REPAIR_COMMIT_UNVERIFIED.*SIMULATED_SECOND_CODE_WRITE_FAILURE/);
 assert.equal(x.data[1][1],'000123');
 assert.equal(x.data[4][1],123);
 assert.deepEqual(x.write,[{r:2,c:2,n:1,w:1}]);
 assert.deepEqual(x.status,['WRITE_FAILED']);
 assert.deepEqual(x.backup,['CREATED']);
 assert.deepEqual(x.revision,[]);
 console.log('ISSUE507_CODE_REPAIR_PARTIAL_WRITE_BACKUP_HELD');
}
console.log('ISSUE507_CODE_REPAIR_SCOPED_PRODUCTION_CONTRACT_OK_SAME_CELL_TOCTOU_UNSOLVED');
