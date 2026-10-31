import {isolateGasBusinessLogic} from './gas-business-fixture.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Real production helpers, with Sheet-range fakes that forbid whole-Sheet
// clearContent(). A GAS stop at the EDITABLE_PRICES cell cannot wipe sibling
// LOAN, REAL_ESTATE, DIVDATA, snapshot settings, or code-less funds.
const gas=isolateGasBusinessLogic(fs.readFileSync('src/gas/apps_script.gs','utf8'));
const start=gas.indexOf('function _writeCodeSyncEditablesOnly_(');
const end=gas.indexOf('// Crash-safe transaction marker.',start);
assert.ok(start>=0 && end>start,'production Settings single-key helpers found');
const program=gas.slice(start,end);
const original=[
  ['LOAN',JSON.stringify({principal:12345})],
  ['REAL_ESTATE',JSON.stringify({address:'서울'})],
  ['DIVDATA',JSON.stringify({paid:789})],
  ['EDITABLE_PRICES',JSON.stringify([
    {name:'B',code:'2',targetWeight:37,notes:'preserve'},
    {name:'코드없는 TDF',code:'',assetType:'TDF',targetWeight:25}
  ])],
  ['SNAPSHOT_SETTINGS',JSON.stringify({retention:20})]
];
function scenario(rows,options={}) {
  const cells=[['키','값'],...rows.map(row=>[...row])];
  let clearCalls=0,writes=0,throwValue=!!options.throwValue;
  const sheet={
    getLastRow:()=>cells.length,
    getLastColumn:()=>2,
    getMaxRows:()=>Math.max(10,cells.length),
    insertRowsAfter(){},
    getRange(r,c,n=1,w=1) {
      const read=()=>Array.from({length:n},(_,i)=>
        Array.from({length:w},(_,j)=>cells[r+i-1]?.[c+j-1]??''));
      return {
        getValues:read,getValue:()=>cells[r-1]?.[c-1]??'',
        setValue(value) {
          if(throwValue) throw Error('INJECTED_SETTINGS_CELL_WRITE_FAILED');
          writes++;
          cells[r-1][c-1]=value;
        },
        setValues(value) {
          if(throwValue && r>1) throw Error('INJECTED_SETTINGS_CELL_WRITE_FAILED');
          writes++;
          value.forEach((data,i)=>{
            if(!cells[r+i-1]) cells[r+i-1]=['',''];
            data.forEach((item,j)=>{cells[r+i-1][c+j-1]=item;});
          });
        },
        clearContent(){clearCalls++;throw Error('WHOLE_SETTINGS_CLEAR_FORBIDDEN');}
      };
    }
  };
  let present=options.missingSheet?null:sheet,flushes=0;
  const ctx={
    CONFIG:{SHEET_SETTINGS:'설정'},
    SpreadsheetApp:{flush(){flushes++;}}
  };
  vm.createContext(ctx);
  vm.runInContext(program,ctx);
  return {
    ctx,run:(from,to)=>ctx._writeCodeSyncEditablesOnly_({
      getSheetByName:()=>present,
      insertSheet:()=>{present=sheet;return sheet;}
    },from,to),
    cells,counts:()=>({clearCalls,writes,flushes})
  };
}
const getPrior=()=>JSON.parse(original[3][1]);
const expected=getPrior(),desired=[
  {...expected[0],sector:'헬스케어',targetWeight:37},
  expected[1],
  {name:'C',code:'3',assetType:'주식'}
];
{
  const t=scenario(original);
  assert.equal(t.run(expected,desired),true);
  assert.deepEqual(JSON.parse(t.cells[4][1]),desired);
  assert.deepEqual(t.cells.slice(1,4),original.slice(0,3));
  assert.deepEqual(t.cells[5],original[4]);
  assert.equal(t.counts().clearCalls,0);
  assert.equal(t.counts().writes,1,'only one Settings value cell');
}
{
  const t=scenario(original,{throwValue:true});
  assert.throws(()=>t.run(expected,desired),/INJECTED_SETTINGS_CELL_WRITE_FAILED/);
  assert.deepEqual(t.cells.slice(1),original,
    'injected single-cell failure leaves all sibling and old asset data intact');
  assert.equal(t.counts().clearCalls,0);
}
{
  const t=scenario(original);
  assert.throws(()=>t.run([{name:'tampered',code:'9'}],desired),
    /CODE_DELETE_SETTINGS_CONCURRENT_CHANGED/,'Settings CAS rejects stale source');
  assert.deepEqual(t.cells.slice(1),original);
  assert.equal(t.counts().writes,0);
}
{
  const t=scenario([...original,{...original[3]}].map(row=>Array.isArray(row)?row:[...original[3]]));
  assert.throws(()=>t.run(expected,desired),/CODE_SYNC_SETTINGS_KEY_AMBIGUOUS/);
  assert.equal(t.counts().writes,0);
}
{
  const rows=original.filter(row=>row[0]!=='EDITABLE_PRICES');
  const t=scenario(rows);
  assert.equal(t.run([],desired),true,'first key may be inserted, no global rewrite');
  assert.deepEqual(t.cells.slice(1,1+rows.length),rows);
  assert.deepEqual(JSON.parse(t.cells.at(-1)[1]),desired);
  assert.equal(t.counts().clearCalls,0);
}
{
  const t=scenario(original.filter(row=>row[0]!=='EDITABLE_PRICES'));
  assert.throws(()=>t.run(expected,desired),/CODE_SYNC_SETTINGS_ORIGINAL_MISSING/);
  assert.equal(t.counts().writes,0);
}
{
  const t=scenario([],{missingSheet:true});
  assert.equal(t.run([],desired),true,'new empty workbook safe bootstrap');
  assert.equal(t.cells[1][0],'EDITABLE_PRICES');
  assert.deepEqual(JSON.parse(t.cells[1][1]),desired);
  assert.equal(t.counts().clearCalls,0);
}
console.log('✅ 실제 GAS Settings single-key CAS: 장애/중복/원본 변조/초기키·대출·부동산·배당 보존');
