#!/usr/bin/env node
// Issue #507 — production FUND_UNITS reconciliation Snapshot lost-update reproducer.
// Executes the actual GAS _reconcileFundUnitDerivedRows in an isolated Node VM.
// No live GAS / Google Sheets / credentials / financial accounts / network.
// PASS confirms preservation of unrelated rows; same-cell cross-writer race remains.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const gas=fs.readFileSync('src/gas/apps_script.gs','utf8');
const name='_reconcileFundUnitDerivedRows';
const start=gas.indexOf('function '+name+'(');
assert.ok(start>=0,'actual production FUND_UNITS reconciler missing');
const end=gas.indexOf('\n}',start);
assert.ok(end>start,'actual production reconciler closing brace missing');
const helperName='_writeFundDerivedChangedCells_';
const hstart=gas.indexOf('function '+helperName+'(');
assert.ok(hstart>=0,'missing production scoped derived write helper');
const hend=gas.indexOf('\n}',hstart);
assert.ok(hend>hstart);
const production=gas.slice(hstart,hend+2)+'\n'+gas.slice(start,end+2);
assert.doesNotMatch(gas.slice(start,end+2),
  /snap\.getRange\(2,\s*1,\s*writeCount,\s*width\)\.setValues/,
  'fund reconciler must not full-rewrite Snapshot');
assert.match(gas,/reconciliation\s*=\s*_reconcileFundUnitDerivedRows\(ss,\s*code,\s*provider,\s*startDate,\s*affectedTo\)/,
  'handleSaveFundUnits no longer calls the reconciler; re-evaluate production entry points');

const date='2026-01-14', otherDate='2026-01-15', fundCode='F00001', provider='SYNTH_PROVIDER';
const clone=x=>JSON.parse(JSON.stringify(x));
const hdr=Array.from({length:12},(_,i)=>'H'+(i+1));
const target=[date,fundCode,'SYNTH_FUND',2,50,100,50,100,0,0,'FUND_NAV',''];
const other=(d)=>[d,'000222','SYNTH_STOCK',3,10,30,11,33,3,10,'SYNTH_PRICE',''];

function createEnvironment({sameDate=false,onSnapshotBackup}={}){
  const foreignDate=sameDate?date:otherDate;
  const initial=clone([hdr,target,other(foreignDate)]);
  let stored=clone(initial);
  let snapshotWrites=0, priceWrites=0, backupCount=0, flushes=0, mutationCount=0;
  let finalized=0, backupStates=[];
  const makeSheet=(sheetName,rows,width)=>{
    const data=rows;
    return {
      getLastRow:()=>data.length,
      getLastColumn:()=>width,
      getMaxRows:()=>100,
      insertRowsAfter:()=>{throw Error('UNEXPECTED_EXPANSION');},
      getRange:(r,c,h,w)=>{
        assert.ok(Number.isInteger(r)&&Number.isInteger(c)&&Number.isInteger(h)&&Number.isInteger(w));
        const get=()=>clone(data.slice(r-1,r-1+h).map(row=>row.slice(c-1,c-1+w)));
        return {
          getValues:get,
          getFormulas:()=>get().map(row=>row.map(()=>'')),
          setValues:values=>{
            assert.equal(values.length,h);
            values.forEach((row,i)=>{
              assert.equal(row.length,w);
              assert.ok(data[r-1+i],sheetName+' overwrite beyond original rows');
              row.forEach((v,j)=>{data[r-1+i][c-1+j]=v;});
            });
            if(sheetName==='스냅샷')snapshotWrites++;
            else priceWrites++;
          },
        };
      },
    };
  };
  const snapshotSheet=makeSheet('스냅샷',stored,12);
  const priceRows=[
    ['D','CODE','NAME','PRICE','SAVED','SOURCE'],
    [date,fundCode,'SYNTH_FUND',123,'','FUND_NAV'],
  ];
  const priceSheet=makeSheet('가격이력',priceRows,6);
  const ss={
    getSheetByName:(s)=>s==='스냅샷'?snapshotSheet:s==='가격이력'?priceSheet:null,
    insertSheet:()=>{throw Error('NO_SHEET_CREATION_EXPECTED');},
  };
  const context=vm.createContext({
    JSON,Array,Object,String,Number,Math,Date,parseFloat,parseInt,isFinite,
    CONFIG:{SHEET_SNAPSHOT:'스냅샷',SHEET_PH:'가격이력',SHEET_TRADES:'거래이력'},
    FUND_NAV_SHEET:'펀드기준가격',FUND_UNITS_SHEET:'펀드좌수',
    _readFundUnits:()=>[{code:fundCode,name:'SYNTH_FUND',provider,units:2,startDate:'2026-01-01'}],
    _fundUnitsAtDate:()=>({units:2}),
    _fundNavEvaluationFromRows:()=>({units:2,evalAmt:123,carried:false}),
    _normalizeDate:s=>String(s||'').slice(0,10),
    _cleanCode:s=>String(s||'').trim(),
    _fundConfiguredCodeForPriceRow:r=>String(r[1]||'').trim(),
    _isFundCode:s=>/^F\d{5}$/.test(s),
    _fundNavExpectedPublicationDate:()=>false,
    _calcCodeHoldingsAtDate:()=>{throw Error('UNEXPECTED_TRADE_REPLAY');},
    _applyFundUnitLifecycleToSnapshotHoldings:()=>{throw Error('UNEXPECTED_LIFECYCLE');},
    _normalizeCodeRows:(rows)=>rows.map(r=>r.slice()),
    _setCodeColumnText:()=>{},
    _backupSheetBeforeWrite:(_ss,sheet,source)=>{
      backupCount++;
      assert.equal(source,'스냅샷','only Snapshot backup expected');
      assert.equal(sheet,snapshotSheet);
      if(onSnapshotBackup){
        const changed=stored.find(row=>row[1]==='000222');
        assert.ok(changed);
        onSnapshotBackup(changed,stored);
        mutationCount++;
      }
      return {name:'SYNTHETIC_BACKUP',source,status:'PREPARED'};
    },
    _markSnapshotBackupStatus:(record,state)=>{backupStates.push(state);},
    _cleanupCurrentSystemBackup:()=>{finalized++;},
    SpreadsheetApp:{flush:()=>{flushes++;}},
  });
  vm.runInContext(production,context,{filename:'production-gas-fund-reconciler.js'});
  const run=()=>clone(context._reconcileFundUnitDerivedRows(ss,fundCode,provider,date,date));
  return {
    run,
    snapshot:()=>clone(stored),
    initial:()=>clone(initial),
    foreign:()=>clone(stored.find(r=>r[1]==='000222')),
    fund:()=>clone(stored.find(r=>r[1]===fundCode)),
    stats:()=>({snapshotWrites,priceWrites,backupCount,flushes,mutationCount,finalized,backupStates}),
  };
}
function assertFundUpdated(e){
  assert.equal(e.fund()[3],1,'fund recalculation must be executed');
  assert.equal(e.fund()[7],123,'fund valuation recalculation must be executed');
  assert.ok(e.stats().snapshotWrites>0,'production reconciler must write fund cells');
  assert.equal(e.stats().priceWrites,0,'unrelated price/NAV writes must not pollute this proof');
  assert.equal(e.stats().backupCount,1,'backup precedes Snapshot write');
  assert.deepEqual(e.stats().backupStates,['COMPLETED']);
}
// Baseline: unrelated date stays intact without a competing editor.
{
  const e=createEnvironment();
  const result=e.run();
  assert.equal(result.snapshotRows,1);
  assertFundUpdated(e);
  assert.equal(e.foreign()[3],3);
}
// CROSS-DATE: inject direct Sheets API update after full-sheet getValues,
// during Snapshot backup. The production full rewrite silently loses it.
{
  const e=createEnvironment({onSnapshotBackup:r=>{
    r[3]=9; r[5]=90; r[7]=99; r[10]='EXTERNAL_EDIT';
  }});
  const result=e.run();
  assert.equal(result.snapshotRows,1);
  assertFundUpdated(e);
  assert.equal(e.stats().mutationCount,1);
  assert.equal(e.foreign()[3],9,'external other-date quantity must survive');
  assert.equal(e.foreign()[5],90,'external other-date cost must survive');
  assert.equal(e.foreign()[10],'EXTERNAL_EDIT','external other-date source must survive');
  console.log('ISSUE507_FUND_DERIVED_OTHER_DATE_PRESERVED');
}
// SAME-DATE, OTHER-CODE: date-scoped by itself is not enough if all codes
// are re-written from a stale sheet image, and GAS ScriptLock is irrelevant
// to an external Sheets API client.
{
  const e=createEnvironment({sameDate:true,onSnapshotBackup:r=>{
    r[3]=8; r[5]=80; r[7]=88; r[10]='EXTERNAL_EDIT';
  }});
  e.run();
  assertFundUpdated(e);
  assert.equal(e.foreign()[3],8,'external same-date other-code quantity must survive');
  assert.equal(e.foreign()[10],'EXTERNAL_EDIT','external same-date other-code source must survive');
  console.log('ISSUE507_FUND_DERIVED_SAME_DATE_OTHER_CODE_PRESERVED');
}
// A same-length external row identity change is invisible to getLastRow.
// The fund writer must reject it before writing any valuation cells.
{
  const e=createEnvironment({onSnapshotBackup:(_foreign,rows)=>{
    rows[1][1]='F00999';
    rows[1][2]='EXTERNAL_REPLACEMENT';
  }});
  assert.throws(()=>e.run(),/날짜\/종목 식별자 외부 변경/);
  assert.equal(e.stats().snapshotWrites,0);
  assert.equal(e.snapshot()[1][1],'F00999');
  assert.ok(e.stats().backupStates.includes('WRITE_FAILED'));
  console.log('ISSUE507_FUND_DERIVED_ROW_IDENTITY_DRIFT_BLOCKED');
}
console.log('ISSUE507_FUND_DERIVED_SCOPED_CONTRACT_OK_SAME_CELL_TOCTOU_UNSOLVED');
