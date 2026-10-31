#!/usr/bin/env node
import {isolateGasBusinessLogic} from './gas-business-fixture.mjs';
// Issue #507: execute REAL GAS _updateTodaySnapshotSource in a synthetic VM.
// No live Sheets API, credentials, personal financial or production data.
// Success proves scoped row/cell preservation, NOT cross-client same-cell CAS.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const gas = isolateGasBusinessLogic(fs.readFileSync('src/gas/apps_script.gs','utf8'));
const functionName='_updateTodaySnapshotSource';
const begin=gas.indexOf('function '+functionName+'(');
const finish=gas.indexOf('\n}',begin);
assert.ok(begin>=0 && finish>begin,'production Snapshot source function unavailable');
const production=gas.slice(begin,finish+2);
assert.doesNotMatch(production,/getRange\(2,\s*11,\s*rowCount,\s*2\)\.setValues/,
  'production writer must never overwrite entire K:L source range');
const copy=x=>JSON.parse(JSON.stringify(x));
const date='2026-01-14', otherDate='2026-01-15';
const row=(d,c,source,saved='')=>[d,c,'SYNTHETIC',1,10,10,11,11,1,10,source,saved,'USER_CUSTOM'];
const starting=[
  ['DATE','CODE','NAME','QTY','COST','AMT','PRICE','VALUE','PNL','RETURN','SOURCE','SAVED','CUSTOM'],
  row(date,'000111','OLD_A','A_STAMP'),
  row(otherDate,'000222','OLD_B','B_STAMP'),
  row(date,'000333','MANUAL','MANUAL_STAMP'),
  row(date,'000444','OLD_C','C_STAMP'),
];
function makeEnv({beforeFirstTarget,atFirstTarget,failWriteNumber=0,onFailure}={}) {
  const stored=copy(starting);let writes=0,attempts=0,flushes=0,revisions=[],preflightInjected=false,writeInjected=false,failed=false;
  const sheet={
    getLastRow:()=>stored.length,
    getLastColumn:()=>13,
    getRange:(r,c,h=1,w=1)=>{
      assert.ok(Number.isInteger(r)&&Number.isInteger(c)&&r>=1&&c>=1&&h>0&&w>0);
      if(c===11&&!preflightInjected&&beforeFirstTarget){
        preflightInjected=true;beforeFirstTarget(stored);
      }
      const read=()=>Array.from({length:h},(_,i)=>
        Array.from({length:w},(_,j)=>stored[r-1+i]?.[c-1+j]??''));
      return {
        getValues:()=>copy(read()),
        getFormulas:()=>read().map(a=>a.map(v=>typeof v==='string'&&v.startsWith('=')?v:'')),
        setValues:(values)=>{
          assert.equal(values.length,h);
          assert.ok(values.every(v=>v.length===w),'Range.setValues width must match');
          attempts++;
          if(!writeInjected&&atFirstTarget){writeInjected=true;atFirstTarget(stored);}
          if(!failed&&failWriteNumber&&attempts===failWriteNumber){
            failed=true;
            if(onFailure)onFailure(stored);
            throw Error('SYNTHETIC_SECOND_RANGE_WRITE_FAILURE');
          }
          values.forEach((row,i)=>row.forEach((value,j)=>{stored[r-1+i][c-1+j]=value;}));
          writes++;
        }
      };
    }
  };
  const ctx=vm.createContext({
    CONFIG:{SHEET_SNAPSHOT:'스냅샷'},
    _normalizeDate:x=>String(x||'').slice(0,10),
    _cleanCode:x=>String(x||'').trim(),
    _touchSnapshotIntegritySourceRevision:meta=>{revisions.push(copy(meta));},
    SpreadsheetApp:{flush:()=>{flushes++;}},
  });
  vm.runInContext(production,ctx,{filename:'production-today-source.js'});
  const ss={getSheetByName:name=>name==='스냅샷'?sheet:null};
  return{
    run:(sources={ '000111':'KRX' })=>ctx._updateTodaySnapshotSource(ss,date,sources),
    rows:()=>copy(stored),
    stats:()=>({writes,attempts,flushes,revisions:copy(revisions)})
  };
}
const byCode=(x,c)=>x.rows().find(r=>r[1]===c);
const custom=(e,c)=>byCode(e,c)?.[12];
// 1. Existing behavior: update source and clear saved time only for target.
{
 const x=makeEnv();
 assert.equal(x.run(),1);
 assert.equal(byCode(x,'000111')[10],'KRX');
 assert.equal(byCode(x,'000111')[11],'');
 assert.equal(byCode(x,'000222')[10],'OLD_B');
 assert.equal(byCode(x,'000222')[11],'B_STAMP');
 assert.equal(byCode(x,'000333')[10],'MANUAL');
 assert.equal(byCode(x,'000333')[11],'MANUAL_STAMP');
 assert.equal(custom(x,'000111'),'USER_CUSTOM');
 assert.equal(x.stats().writes,1,'one physical K:L range only');
 assert.deepEqual(x.stats().revisions,[{date}]);
}
// 2. NOOP and MANUAL-only must skip writes, flush, revision metadata.
{
 const x=makeEnv();
 assert.equal(x.run({'000333':'KRX'}),0);
 assert.equal(x.run({'000111':'OLD_A'}),0);
 assert.equal(x.run({}),0);
 assert.deepEqual(x.stats(),{writes:0,attempts:0,flushes:0,revisions:[]});
}
// 3. External different-date edit happens AFTER writer's whole-sheet read,
// right before writer commits. Its K:L changes must survive intact.
{
 const x=makeEnv({atFirstTarget:rows=>{
   rows[2][10]='EXTERNAL_B';rows[2][11]='NEW_B_STAMP';
 }});
 assert.equal(x.run(),1);
 assert.equal(byCode(x,'000222')[10],'EXTERNAL_B');
 assert.equal(byCode(x,'000222')[11],'NEW_B_STAMP');
 console.log('ISSUE507_TODAY_SOURCE_OTHER_DATE_EXTERNAL_EDIT_PRESERVED');
}
// 4. Same date but another code, including MANUAL, must also remain untouched.
{
 const x=makeEnv({atFirstTarget:rows=>{
   rows[4][10]='EXTERNAL_C';rows[4][11]='NEW_C_STAMP';
 }});
 assert.equal(x.run(),1);
 assert.equal(byCode(x,'000444')[10],'EXTERNAL_C');
 assert.equal(byCode(x,'000333')[10],'MANUAL');
 console.log('ISSUE507_TODAY_SOURCE_SAME_DATE_OTHER_CODE_PRESERVED');
}
// 5. External edit in target K:L after initial read must fail before writes.
{
 const x=makeEnv({beforeFirstTarget:rows=>{
   rows[1][10]='EXTERNAL_TARGET';
 }});
 assert.throws(()=>x.run(),/대상셀 외부 변경/);
 assert.equal(byCode(x,'000111')[10],'EXTERNAL_TARGET');
 assert.equal(x.stats().writes,0);
}
// 6. A stale physical row can be reassigned to a different security.
{
 const x=makeEnv({beforeFirstTarget:rows=>{
   rows[1][1]='001999';
 }});
 assert.throws(()=>x.run(),/날짜\/종목 외부 변경/);
 assert.equal(x.stats().writes,0);
}
// 7. Reverting one of two disjoint physical K:L writes must not touch other
// dates, codes or custom columns when second write fails.
{
 const x=makeEnv({failWriteNumber:2});
 const baseline=x.rows();
 assert.throws(()=>x.run({'000111':'KRX','000444':'TOSS'}),/SYNTHETIC_SECOND_RANGE_WRITE_FAILURE/);
 assert.deepEqual(x.rows(),baseline,'only previously attempted K:L was compensated');
 assert.deepEqual(x.stats().revisions,[]);
 console.log('ISSUE507_TODAY_SOURCE_PARTIAL_WRITE_COMPENSATED');
}
// 8. Regression for Codex P2: after the first physical K:L write, another
// Sheets writer may replace/sort the row. Its new instrument can coincidentally
// carry the exact value we just wrote. Compensation must verify A:C BEFORE
// touching K:L; a matching "KRX" value is not permission to overwrite.
{
 const x=makeEnv({failWriteNumber:2,onFailure:rows=>{
   rows[1][0]=otherDate;
   rows[1][1]='009999';
   rows[1][2]='REASSIGNED_EXTERNAL';
   // K:L intentionally remains ['KRX',''] (the intended first write).
 }});
 assert.throws(()=>x.run({'000111':'KRX','000444':'TOSS'}),/COMMIT_UNVERIFIED/);
 const reassigned=x.rows()[1];
 assert.equal(reassigned[1],'009999');
 assert.equal(reassigned[10],'KRX','never roll back other code even when K:L matches our after-image');
 assert.equal(reassigned[11],'');
 assert.deepEqual(x.stats().revisions,[],'failed reconciliation must not claim source revision');
 console.log('ISSUE507_TODAY_SOURCE_ROLLBACK_ROW_REASSIGNMENT_BLOCKED');
}
// 8. If an external writer modifies a changed K:L before compensation,
// do not overwrite it; surface COMMIT_UNVERIFIED for read-only diagnosis.
{
 const x=makeEnv({failWriteNumber:2,onFailure:rows=>{
   rows[1][10]='EXTERNAL_AFTER_FIRST';
 }});
 assert.throws(()=>x.run({'000111':'KRX','000444':'TOSS'}),/COMMIT_UNVERIFIED/);
 assert.equal(byCode(x,'000111')[10],'EXTERNAL_AFTER_FIRST');
 assert.deepEqual(x.stats().revisions,[]);
 console.log('ISSUE507_TODAY_SOURCE_UNVERIFIED_EXTERNAL_OVERLAP_BLOCKED');
}
console.log('ISSUE507_TODAY_SOURCE_SCOPED_PRODUCTION_CONTRACT_OK_SAME_CELL_TOCTOU_UNSOLVED');
