import {isolateGasBusinessLogic} from './gas-business-fixture.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Run the PRODUCTION GAS proof and mutation functions, not a reimplementation.
const gas=isolateGasBusinessLogic(fs.readFileSync('src/gas/apps_script.gs','utf8'));
function extract(name){
  const i=gas.indexOf('function '+name+'('), j=i>=0?gas.indexOf('\n}\n',i)+3:-1;
  assert.ok(i>=0&&j>i,name+' production GAS function required');
  return gas.slice(i,j);
}
const source=[extract('_oct08FundSourceOnlyProof_'),
  extract('handleRepairOct08FundSourceOnly')].join('\n');
const DAY='2026-10-08';
const codes=[...Array.from({length:37},(_,i)=>'A'+String(i).padStart(5,'0')),
  'F00001','F00002'];
const expected=codes.map(c=>[DAY,c,'Name_'+c,c.startsWith('F')?1:10,100,1000,
  c.startsWith('F')?3000:200,c.startsWith('F')?3000:2000,
  c.startsWith('F')?2000:1000,100,
  c.startsWith('F')?'FUND_NAV':'KRX','']);
const stored=expected.map(r=>r.slice());
stored[37][10]='FUND_NAV_CARRY@2026-10-07';
stored[38][10]='FUND_NAV_CARRY@2026-10-06';
const base={date:DAY,status:'MISMATCH',expectedRowCount:39,storedRowCount:39,
  expectedRows:expected,storedRows:stored,
  sourceMismatches:[{code:'F00001'},{code:'F00002'}],
  duplicateKeys:[],conflictKeys:[],missingCodes:[],unexpectedCodes:[],
  qtyMismatches:[],costAmtMismatches:[],evalUnitMismatches:[],
  evalAmtMismatches:[],sourceDataErrors:[]};
function make({numerical=false,manual=false,failSecondWrite=false}={}){
  let rows=stored.map(r=>r.slice()),writes=[],events=[],locked=false,failedOnce=false;
  if(manual)rows[37][10]='MANUAL';
  const original=JSON.parse(JSON.stringify(base));
  original.storedRows=rows.map(r=>r.slice());
  if(numerical){original.storedRows[0][7]=2001;
    original.evalAmtMismatches=[{code:codes[0]}];}
  const sh={getLastRow(){return 40;},
    getRange(row,col,numRows,numColumns){
      if(row===2&&col===1&&numRows===39&&numColumns===12)
        return{getValues(){return rows.map(r=>r.slice());}};
      assert.equal(col,11,'only source K cells can ever be written');
      assert.ok(row>=2&&row<=40);
      return{setValue(value){
        if(failSecondWrite&&writes.length===1&&!failedOnce){failedOnce=true;throw new Error('MUTATION_PARTIAL');}
        events.push('source-write');writes.push({row,col,value});
        rows[row-2][10]=value;}};
    }};
  const context={
    LockService:{getScriptLock:()=>({
      waitLock(){assert.equal(locked,false);locked=true;events.push('lock');},
      releaseLock(){assert.equal(locked,true);locked=false;events.push('unlock');}
    })},
    Utilities:{getUuid:()=>'TEST_UUID'},
    SpreadsheetApp:{flush:()=>events.push('flush')},
    CONFIG:{SHEET_SNAPSHOT:'스냅샷'},
    getss:()=>({getSheetByName:n=>(assert.equal(n,'스냅샷'),sh)}),
    _snapshotBackupOperationId:null,
    _normalizeDate:x=>String(x||''),
    _cleanCode:x=>String(x||''),
    diagnoseSnapshotIntegrity(){
      events.push('proof');
      const done=rows[37][10]===expected[37][10]&&
        rows[38][10]===expected[38][10];
      if(done)return{...original,status:'VALID',storedRows:rows.map(r=>r.slice()),
        sourceMismatches:[]};
      return original;
    },
    _backupSnapshotBeforeWrite(){
      assert.ok(locked);events.push('backup');
      return{signature:'SIGNED_BACKUP'};},
    _settleSnapshotBackupOperation(_ss,_id,ok){events.push('settle:'+ok);},
    _touchSnapshotIntegritySourceRevision(){events.push('touch-revision');},
    jsonOk:x=>({status:'ok',...x}),
    jsonError:e=>({status:'error',message:e}),
    Logger:{log:()=>{}},
  };
  vm.createContext(context);
  vm.runInContext(source,context,{timeout:2500});
  return{context,events,writes,rows,isLocked:()=>locked,
    run:()=>context.handleRepairOct08FundSourceOnly()};
}
const ok=make();const result=ok.run();
assert.equal(result.status,'ok');
assert.equal(result.mode,'APPLIED');
assert.equal(result.changed,2);
assert.equal(result.verified,'VALID');
assert.deepEqual(ok.writes.map(x=>x.col),[11,11]);
assert.deepEqual(ok.writes.map(x=>x.row),[39,40]);
assert.ok(ok.events.indexOf('backup')<ok.events.indexOf('source-write'));
assert.ok(ok.events.indexOf('lock')<ok.events.indexOf('backup'));
assert.equal(ok.isLocked(),false);
assert.equal(ok.run().mode,'ALREADY_VALID','replay must not rewrite');
assert.equal(ok.writes.length,2);
const bad=make({numerical:true});assert.equal(bad.run().status,'error');
assert.equal(bad.writes.length,0);assert.equal(bad.isLocked(),false);
const manual=make({manual:true});assert.equal(manual.run().status,'error');
assert.equal(manual.writes.length,0);
const partial=make({failSecondWrite:true});
assert.equal(partial.run().status,'error');
assert.ok(partial.events.includes('settle:false'));
assert.equal(partial.isLocked(),false);
assert.equal(partial.rows[37][10],stored[37][10],
  'best-effort rollback must restore first fund source');
console.log('Production GAS v9.231 source-only VM: immutable full-data proof, 2 cells, signed backup, lock, rollback, replay PASS');
