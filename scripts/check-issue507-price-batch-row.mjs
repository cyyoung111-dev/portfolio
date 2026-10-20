#!/usr/bin/env node
// #507. Execute real production batchUpsertPriceHistory in synthetic VM.
// No live GAS/Sheets API, source credentials or user financial records.
// Preserves same-cell external writer TOCTOU and cross-row atomicity caveats.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const gas=fs.readFileSync('src/gas/apps_script.gs','utf8');
const name='batchUpsertPriceHistory';
const start=gas.indexOf('function '+name+'('),end=gas.indexOf('\n}',start);
assert.ok(start>=0 && end>start);
const production=gas.slice(start,end+2);
assert.match(production,/ph\.getRange\(item\.row,4,1,3\)\.setValues\(\[item\.after\]\)/);
assert.doesNotMatch(production,/getRange\(startRow,\s*4,\s*prices\.length,\s*1\)\.setValues/);
const copy=x=>JSON.parse(JSON.stringify(x));
const d1='2026-01-14',d2='2026-01-15';
const header=['DATE','CODE','NAME','PRICE','STAMP','SOURCE','USER'];
const row=(d,code,price,source='KRX',saved='',custom='')=>[d,code,'SYNTHETIC',price,saved,source,custom];
const mk=(mode)=>{
 switch(mode){
  case 'normal':return [header,row(d1,'000111',100,'OLD','',''),row(d2,'000222',200,'KRX','','FOREIGN')];
  case 'two':return [header,row(d1,'000111',100,'OLD','',''),row(d1,'000333',300,'OLD','',''),row(d2,'000222',200,'KRX','','FOREIGN')];
  case 'manual':return [header,row(d1,'000111',100,' MANUAL ','2026-01-14 12:00:00','KEEP'),
    row(d2,'000222',200,'KRX','','FOREIGN')];
  case 'empty':return [header];
  default:throw Error('fixture '+mode);
 }
};
function makeEnv({mode='normal',beforePreflight,atAppendRead,failWriteNumber=0,formula=[]}={}){
 const stored=copy(mk(mode)), initial=copy(stored);
 const writes=[],revisions=[],formats=[],inserts=[];let attempts=0,preflightCalled=false,appendCalled=false,failed=false,flushes=0;
 const width=mode==='empty'?6:7;
 const last=()=>{for(let i=stored.length-1;i>=0;i--){
   if(stored[i].some(x=>x!==''&&x!=null))return i+1;
 }return 0};
 const sheet={
  getLastRow:last,getLastColumn:()=>width,
  getRange:(r,c,h=1,w=1)=>{
   if(c===1&&r===2&&!preflightCalled&&beforePreflight){preflightCalled=true;beforePreflight(stored);}
   if(c===1&&r===initial.length+1&&!appendCalled&&atAppendRead){appendCalled=true;atAppendRead(stored);}
   const get=()=>Array.from({length:h},(_,i)=>Array.from({length:w},(_,j)=>stored[r-1+i]?.[c-1+j]??''));
   return{
    getValues:()=>copy(get()),
    getFormulas:()=>Array.from({length:h},(_,i)=>Array.from({length:w},(_,j)=>
      formula.some(f=>f.row===r+i&&f.col===c+j)?'=USER_FORMULA':'')),
    setValues:values=>{
     assert.equal(values.length,h);assert.ok(values.every(a=>a.length===w));
     attempts++;
     if(failWriteNumber&&!failed&&attempts===failWriteNumber){
       failed=true;throw Error('SIMULATED_SECOND_PRICE_ROW_WRITE_FAILURE');
     }
     values.forEach((v,i)=>{
      stored[r-1+i] ||= Array(width).fill('');
      v.forEach((val,j)=>{stored[r-1+i][c-1+j]=val;});
     });
     writes.push({r,c,h,w});
    }
   };
  }
 };
 const ss={getSheetByName:key=>key==='가격이력'?sheet:null,insertSheet:key=>{inserts.push(key);return sheet;}};
 const ctx=vm.createContext({
  CONFIG:{SHEET_PH:'가격이력'},
  _cleanCode:x=>String(x||'').trim(),
  _normalizeDate:x=>String(x||'').slice(0,10),
  _normalizeCodeRows:x=>copy(x),
  _setCodeColumnText:()=>formats.push('CODE_TEXT'),
  _touchSnapshotIntegritySourceRevision:x=>revisions.push(copy(x)),
  SpreadsheetApp:{flush:()=>{flushes++;}},
  Logger:{log:()=>{}},
 });
 vm.runInContext(production,ctx,{filename:'production-price-batch.js'});
 const item=(code,price,source='KRX',savedAt='')=>({code,name:'SYNTHETIC',price,source,savedAt});
 return{run:(items,date=d1)=>ctx.batchUpsertPriceHistory(ss,date,items),item,
  rows:()=>copy(stored),initial,writes,revisions,formats,inserts,stats:()=>({attempts,flushes})};
}
// Single row D:F must be written as one range and leave custom/unrelated row untouched.
{
 const e=makeEnv(),x=e.item('000111',111,'KRX','');
 e.run([x]);
 assert.equal(e.rows()[1][3],111);
 assert.deepEqual(e.rows()[1].slice(4,6),['','KRX']);
 assert.deepEqual(e.rows()[2],e.initial[2]);
 assert.deepEqual(e.writes,[{r:2,c:4,h:1,w:3}]);
 assert.deepEqual(e.revisions,[{from:d1}]);
 console.log('ISSUE507_BATCH_PRICE_AND_SOURCE_SINGLE_RANGE');
}
// New MANUAL source injected externally after stale initial read must not be overwritten.
{
 const e=makeEnv({beforePreflight:rows=>{rows[1][5]=' MANUAL ';}});
 assert.throws(()=>e.run([e.item('000111',115)]),/PRICE_HISTORY_BATCH_TARGET_CHANGED_BEFORE_WRITE/);
 assert.equal(e.rows()[1][5],' MANUAL ');
 assert.equal(e.writes.length,0);
 assert.deepEqual(e.revisions,[]);
 console.log('ISSUE507_BATCH_EXTERNAL_MANUAL_PROTECTED');
}
// Existing MANUAL even with whitespace protects the source and price.
{
 const e=makeEnv({mode:'manual'});
 e.run([e.item('000111',115)]);
 assert.deepEqual(e.rows(),e.initial);
 assert.deepEqual(e.writes,[]);
 assert.deepEqual(e.revisions,[]);
}
// Formula in target D:F is never overwritten.
{
 const e=makeEnv({formula:[{row:2,col:4}]});
 assert.throws(()=>e.run([e.item('000111',115)]),/PRICE_HISTORY_BATCH_PROTECTED_FORMULA/);
 assert.deepEqual(e.writes,[]);
}
// Two row update second range fails: explicitly unverified, no silent success.
{
 const e=makeEnv({mode:'two',failWriteNumber:2});
 assert.throws(()=>e.run([e.item('000111',111),e.item('000333',333)]),/PRICE_HISTORY_BATCH_COMMIT_UNVERIFIED.*SIMULATED_SECOND/);
 assert.equal(e.rows()[1][3],111);
 assert.equal(e.rows()[2][3],300);
 assert.deepEqual(e.rows()[3],e.initial[3]);
 assert.deepEqual(e.revisions,[{from:d1}]);
 console.log('ISSUE507_BATCH_PARTIAL_FAILURE_EXPLICIT');
}
// Unrelated external code/date edit before update should survive.
{
 const e=makeEnv({beforePreflight:rows=>{rows[2][3]=888;rows[2][5]='API_FOREIGN';}});
 e.run([e.item('000111',111)]);
 assert.equal(e.rows()[2][3],888);
 assert.equal(e.rows()[2][5],'API_FOREIGN');
}
// Append reservation may be taken by external API after rowcount preflight.
// A previously updated row is explicitly unverified; no overwrite at taken slot.
{
 const e=makeEnv({atAppendRead:rows=>{rows.push(row(d2,'009999',999,'EXTERNAL'));}});
 assert.throws(()=>e.run([e.item('000111',111),e.item('000888',888)]),
  /PRICE_HISTORY_BATCH_COMMIT_UNVERIFIED.*APPEND_DESTINATION_OCCUPIED/);
 assert.equal(e.rows()[3][1],'009999');
 assert.equal(e.rows()[3][3],999);
 assert.deepEqual(e.writes,[{r:2,c:4,h:1,w:3}]);
 console.log('ISSUE507_BATCH_APPEND_PREEMPTION_BLOCKED');
}
// No update: appended row has full A:F evidence and correct date.
{
 const e=makeEnv({mode:'empty'});
 e.run([e.item('000888',888)]);
 assert.equal(e.rows()[1][0],d1);
 assert.equal(e.rows()[1][1],'000888');
 assert.equal(e.rows()[1][3],888);
 assert.deepEqual(e.writes,[{r:2,c:1,h:1,w:6}]);
}
console.log('ISSUE507_BATCH_PRICE_WRITER_REGRESSION_OK_SAME_CELL_TOCTOU_UNSOLVED');
