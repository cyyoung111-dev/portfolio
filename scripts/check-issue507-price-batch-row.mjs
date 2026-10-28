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
assert.match(production,/ph\.getRange\(group\.start,4,group\.items\.length,3\)\.setValues/);
assert.doesNotMatch(production,/getRange\(startRow,\s*4,\s*prices\.length,\s*1\)\.setValues/);
const copy=x=>JSON.parse(JSON.stringify(x));
const d1='2026-01-14',d2='2026-01-15';
const header=['DATE','CODE','NAME','PRICE','STAMP','SOURCE','USER'];
const row=(d,code,price,source='KRX',saved='',custom='')=>[d,code,'SYNTHETIC',price,saved,source,custom];
const mk=(mode)=>{
 switch(mode){
  case 'normal':return [header,row(d1,'000111',100,'OLD','',''),row(d2,'000222',200,'KRX','','FOREIGN')];
  case 'two':return [header,row(d1,'000111',100,'OLD','',''),row(d2,'000222',200,'KRX','','FOREIGN'),row(d1,'000333',300,'OLD','','')];
  case 'contiguous':return [header,row(d1,'000111',100,'OLD','',''),row(d1,'000333',300,'OLD','',''),row(d2,'000222',200,'KRX','','FOREIGN')];
  case 'legacy5':return [header.slice(0,5),row(d1,'000111',100,'OLD').slice(0,5)];
  case 'bulk':return [header,...Array.from({length:120},(_,i)=>row(d1,String(100000+i),i+100,'OLD'))];
  case 'manual':return [header,row(d1,'000111',100,' MANUAL ','2026-01-14 12:00:00','KEEP'),
    row(d2,'000222',200,'KRX','','FOREIGN')];
  case 'empty':return [header];
  default:throw Error('fixture '+mode);
 }
};
function makeEnv({mode='normal',beforePreflight,atAppendRead,failWriteNumber=0,formula=[],dateReadback='',timestampReadback='',timestampUpdateReadback='',sheetTimezone='Asia/Seoul',timestampOffset='+09:00',writerSource=production}={}){
 const stored=copy(mk(mode)), initial=copy(stored);
 const writes=[],reads=[],revisions=[],formats=[],inserts=[];let attempts=0,fullScans=0,appendCalled=false,failed=false,flushes=0;
 const width=mode==='empty'?6:mode==='legacy5'?5:7;
 const last=()=>{for(let i=stored.length-1;i>=0;i--){
   if(stored[i].some(x=>x!==''&&x!=null))return i+1;
 }return 0};
 const sheet={
  getLastRow:last,getLastColumn:()=>width,
  getRange:(r,c,h=1,w=1)=>{
   if(c===1&&r===initial.length+1&&!appendCalled&&atAppendRead){appendCalled=true;atAppendRead(stored);}
   const get=()=>Array.from({length:h},(_,i)=>Array.from({length:w},(_,j)=>stored[r-1+i]?.[c-1+j]??''));
   return{
    getValues:()=>{
      reads.push({r,c,h,w});
      if(c===1&&r===2&&h===initial.length-1&&w>=5) {
        fullScans++;
        if(fullScans===2&&beforePreflight)beforePreflight(stored);
      }
      const result=copy(get());
      if(dateReadback&&c===1&&r===initial.length+1&&writes.length){
        for(const row of result)if(row[0]){
          const value=new Date(row[0]+'T08:00:00Z');
          if(dateReadback==='DRIFT')value.setUTCDate(value.getUTCDate()+1);
          row[0]=value;
        }
      }
      if(timestampReadback&&c===1&&r===initial.length+1&&writes.length){
        for(const row of result)if(row[4]){
          row[4]=new Date(String(row[4]).replace(' ','T')+timestampOffset);
          if(timestampReadback==='DRIFT')row[4].setUTCSeconds(row[4].getUTCSeconds()+1);
        }
      }
      if(timestampUpdateReadback&&c===4&&r===2&&writes.length){
        for(const row of result)if(row[1]){
          row[1]=new Date(String(row[1]).replace(' ','T')+timestampOffset);
          if(timestampUpdateReadback==='DRIFT')row[1].setUTCSeconds(row[1].getUTCSeconds()+1);
        }
      }
      return result;
    },
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
 const ss={getSpreadsheetTimeZone:()=>sheetTimezone,getSheetByName:key=>key==='가격이력'?sheet:null,insertSheet:key=>{inserts.push(key);return sheet;}};
 const ctx=vm.createContext({
  Date,CONFIG:{SHEET_PH:'가격이력',TIMEZONE:'Asia/Seoul'},
  Utilities:{formatDate:(value,tz,pattern)=>{
    const opts={timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit'};
    if(pattern.includes('HH'))Object.assign(opts,{hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
    const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',opts).formatToParts(value).map(p=>[p.type,p.value]));
    return `${parts.year}-${parts.month}-${parts.day}`+(pattern.includes('HH')?` ${parts.hour}:${parts.minute}:${parts.second}`:'');
  }},
  _cleanCode:x=>String(x||'').trim(),
  _normalizeDate:x=>String(x||'').slice(0,10),
  _normalizeCodeRows:x=>copy(x),
  _setCodeColumnText:()=>formats.push('CODE_TEXT'),
  _touchSnapshotIntegritySourceRevision:x=>revisions.push(copy(x)),
  SpreadsheetApp:{flush:()=>{flushes++;}},
  Logger:{log:()=>{}},
 });
 const normalizeStart=gas.indexOf('function _normalizeDate('),normalizeEnd=gas.indexOf('\n}',normalizeStart)+2;
 vm.runInContext(gas.slice(normalizeStart,normalizeEnd),ctx);
 vm.runInContext(writerSource,ctx,{filename:'production-price-batch.js'});
 const item=(code,price,source='KRX',savedAt='')=>({code,name:'SYNTHETIC',price,source,savedAt});
 return{run:(items,date=d1)=>ctx.batchUpsertPriceHistory(ss,date,items),item,
  rows:()=>copy(stored),initial,writes,reads,revisions,formats,inserts,stats:()=>({attempts,flushes})};
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
// Legacy five populated columns: missing F must normalize to an empty value,
// not block all updates by comparing a five-element row with A:F (six cells).
{
 const e=makeEnv({mode:'legacy5'});
 e.run([e.item('000111',115)]);
 assert.deepEqual(e.rows()[1].slice(3,6),[115,'','KRX']);
 assert.deepEqual(e.writes,[{r:2,c:4,h:1,w:3}]);
 console.log('ISSUE507_BATCH_LEGACY_FIVE_COLUMN_COMPATIBLE');
}
// Consecutive updates share a D:F range; unrelated rows are not overwritten.
{
 const e=makeEnv({mode:'contiguous'});
 e.run([e.item('000111',111),e.item('000333',333)]);
 assert.deepEqual(e.writes,[{r:2,c:4,h:2,w:3}]);
 assert.deepEqual(e.rows()[3],e.initial[3]);
}
// A 120-symbol batch must not issue per-row read/verify requests.
{
 const e=makeEnv({mode:'bulk'});
 const all=Array.from({length:120},(_,i)=>e.item(String(100000+i),i+500));
 e.run(all);
 assert.deepEqual(e.writes,[{r:2,c:4,h:120,w:3}]);
 assert.ok(e.reads.length<=5,'bulk reads must be O(1), not O(symbols)');
 assert.equal(e.rows()[120][3],619);
 console.log('ISSUE507_BATCH_BOUNDED_SHEETS_IO');
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
 assert.equal(e.rows()[3][3],300);
 assert.deepEqual(e.rows()[2],e.initial[2]);
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
// Actual production normalizer: DATE-formatted Sheets readback is a Date,
// while setValues received YYYY-MM-DD. Calendar equality is sufficient only
// for column A; wrong dates and every other changed field remain failures.
{
 const e=makeEnv({mode:'empty',dateReadback:'MATCH'});
 e.run([e.item('000888',888)]);assert.equal(e.revisions.length,1);
 const drift=makeEnv({mode:'empty',dateReadback:'DRIFT'});
 assert.throws(()=>drift.run([drift.item('000888',888)]),/APPEND_UNVERIFIED/);
 const old=production.replace(/if \(!appended\[index\] \|\| _normalizeDate\(appended\[index\]\[0\]\) !== _normalizeDate\(row\[0\]\)\s*\|\| !sameObservation\(appended\[index\]\.slice\(1\),row\.slice\(1\),3\)\)/,'if (!same(appended[index],row))');
 assert.notEqual(old,production);
 const mutation=makeEnv({mode:'empty',dateReadback:'MATCH',writerSource:old});
 assert.throws(()=>mutation.run([mutation.item('000888',888)]),/APPEND_UNVERIFIED/);
 console.log('ISSUE507_BATCH_NATIVE_DATE_READBACK_AND_WRONG_DATE_MUTATION_PASS');
}

{
 const sameStamp=makeEnv({mode:'empty',timestampReadback:'MATCH'});
 sameStamp.run([sameStamp.item('000888',888,'KRX','2026-01-14 08:39:42')]);
 const drift=makeEnv({mode:'empty',timestampReadback:'DRIFT'});
 assert.throws(()=>drift.run([drift.item('000888',888,'KRX','2026-01-14 08:39:42')]),/APPEND_UNVERIFIED/);
 const old=production.replace('!sameObservation(appended[index].slice(1),row.slice(1),3)','!same(appended[index].slice(1),row.slice(1))');
 assert.notEqual(old,production);
 const mutant=makeEnv({mode:'empty',timestampReadback:'MATCH',writerSource:old});
 assert.throws(()=>mutant.run([mutant.item('000888',888,'KRX','2026-01-14 08:39:42')]),/APPEND_UNVERIFIED/);
 console.log('PASS native timestamp identity, one-second mismatch rejection, old comparison mutation');
}

// The real workbook is America/Los_Angeles; parsed Sheet DATE_TIME values
// represent its wall time, while CONFIG.TIMEZONE remains Asia/Seoul.
for (const [day,offset] of [['2026-01-14','-08:00'],['2026-07-14','-07:00']]) {
 const stamp=day+' 08:41:45';
 const options={mode:'empty',timestampReadback:'MATCH',sheetTimezone:'America/Los_Angeles',timestampOffset:offset};
 const same=makeEnv(options);same.run([same.item('000888',888,'KRX',stamp)],day);
 const drift=makeEnv({...options,timestampReadback:'DRIFT'});
 assert.throws(()=>drift.run([drift.item('000888',888,'KRX',stamp)],day),/APPEND_UNVERIFIED/);
 const mutant=makeEnv({...options,writerSource:production.replace("sheetTimezone, 'yyyy-MM-dd HH:mm:ss'","CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm:ss'")});
 assert.throws(()=>mutant.run([mutant.item('000888',888,'KRX',stamp)],day),/APPEND_UNVERIFIED/);
}
console.log('PASS sheet timezone winter/summer, one-second mismatch and wrong-timezone mutation');

{
 const options={mode:'normal',timestampUpdateReadback:'MATCH',sheetTimezone:'America/Los_Angeles',timestampOffset:'-08:00'};
 const same=makeEnv(options);same.run([same.item('000111',111,'MANUAL','2026-01-14 08:41:45')]);
 const drift=makeEnv({...options,timestampUpdateReadback:'DRIFT'});
 assert.throws(()=>drift.run([drift.item('000111',111,'MANUAL','2026-01-14 08:41:45')]),/WRITE_UNVERIFIED/);
}
console.log('PASS manual update spreadsheet timezone and one-second mismatch');
