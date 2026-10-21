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

function createEnvironment({sameDate=false,onSnapshotBackup,onDerivedBackup,includeNav=false,includePriceChange=false,zeroUnits=false,manual=false,failSnapWriteAt=0,appendFund=false,snapshotWidth=12}={}){
  const foreignDate=sameDate?date:otherDate;
  const originalFund=clone(target); if(manual)originalFund[10]='MANUAL';
  const extendSnapshot=r=>{
    const out=clone(r);
    while(out.length<snapshotWidth)out.push('');
    return out;
  };
  const extendedForeign=extendSnapshot(other(foreignDate));
  if(snapshotWidth>12){extendedForeign[12]='UNRELATED_EXTRA_COL13';extendedForeign[13]='UNRELATED_EXTRA_COL14';}
  const initial=clone([extendSnapshot(hdr),...(appendFund?[]:[extendSnapshot(originalFund)]),extendedForeign]);
  let stored=clone(initial);
  let snapshotWrites=0, priceWrites=0, navWrites=0, backupCount=0, flushes=0, mutationCount=0;
  let failedOnce=false;
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
        const get=()=>Array.from({length:h},(_,i)=>
          Array.from({length:w},(_,j)=>clone(data[r-1+i]?.[c-1+j] ?? '')));
        return {
          getValues:get,
          getFormulas:()=>get().map(row=>row.map(()=>'')),
          setValues:values=>{
            if(sheetName==='스냅샷' && failSnapWriteAt && !failedOnce && snapshotWrites+1===failSnapWriteAt){failedOnce=true;throw Error('SYNTHETIC_SNAPSHOT_WRITE_FAILURE');}
            assert.equal(values.length,h);
            values.forEach((row,i)=>{
              assert.equal(row.length,w);
              data[r-1+i] ||= Array.from({length:width},()=> '');
              row.forEach((v,j)=>{data[r-1+i][c-1+j]=v;});
            });
            if(sheetName==='스냅샷')snapshotWrites++;
            else if(sheetName==='가격이력')priceWrites++;
            else navWrites++;
          },
        };
      },
    };
  };
  const snapshotSheet=makeSheet('스냅샷',stored,snapshotWidth);
  const priceRows=[
    ['D','CODE','NAME','PRICE','SAVED','SOURCE'],
    [date,fundCode,'SYNTH_FUND',includePriceChange?100:123,'',manual?'MANUAL':'FUND_NAV'],
    [foreignDate,'000222','SYNTH_STOCK',11,'','SYNTH_PRICE'],
  ];
  const priceSheet=makeSheet('가격이력',priceRows,6);
  const navRows=[
    ['DATE','CODE','NAME','NAV','SOURCE_DATE','UNITS','EVAL','SAVED','PROVIDER'],
    [date,fundCode,'SYNTH_FUND',100,date,1,100,'',provider],
    [foreignDate,'F00002','SYNTH_OTHER_FUND',99,foreignDate,4,396,'',provider],
  ];
  const navSheet=makeSheet('펀드기준가격',navRows,9);
  const tradeRows=[
    Array(11).fill('TRADES_HEADER'),
    [date,'buy','SYNTH_ACCOUNT','SYNTH_FUND',fundCode,1,100,'SYNTH',0,'',''],
  ];
  const tradeSheet=makeSheet('거래이력',tradeRows,11);
  const ss={
    getSheetByName:(s)=>s==='스냅샷'?snapshotSheet:s==='가격이력'?priceSheet:s==='펀드기준가격'&&includeNav?navSheet:s==='거래이력'&&appendFund?tradeSheet:null,
    insertSheet:()=>{throw Error('NO_SHEET_CREATION_EXPECTED');},
  };
  const context=vm.createContext({
    JSON,Array,Object,String,Number,Math,Date,parseFloat,parseInt,isFinite,
    CONFIG:{SHEET_SNAPSHOT:'스냅샷',SHEET_PH:'가격이력',SHEET_TRADES:'거래이력'},
    FUND_NAV_SHEET:'펀드기준가격',FUND_UNITS_SHEET:'펀드좌수',
    _readFundUnits:()=>[{code:fundCode,name:'SYNTH_FUND',provider,units:2,startDate:'2026-01-01'}],
    _fundUnitsAtDate:()=>({units:zeroUnits?0:2}),
    _fundNavEvaluationFromRows:()=>({units:2,evalAmt:123,carried:false}),
    _normalizeDate:s=>String(s||'').slice(0,10),
    _cleanCode:s=>String(s||'').trim(),
    _fundConfiguredCodeForPriceRow:r=>String(r[1]||'').trim(),
    _isFundCode:s=>/^F\d{5}$/.test(s),
    _fundNavExpectedPublicationDate:()=>false,
    _calcCodeHoldingsAtDate:()=> {
      if(!appendFund)throw Error('UNEXPECTED_TRADE_REPLAY');
      return {SYNTH_FUND:{code:fundCode,name:'SYNTH_FUND',qty:1,costAmt:100}};
    },
    _applyFundUnitLifecycleToSnapshotHoldings:()=>{if(!appendFund)throw Error('UNEXPECTED_LIFECYCLE');},
    _normalizeCodeRows:(rows)=>rows.map(r=>r.slice()),
    _setCodeColumnText:()=>{},
    _backupSheetBeforeWrite:(_ss,sheet,source)=>{
      backupCount++;
      if(source==='스냅샷' && onSnapshotBackup){
        assert.equal(sheet,snapshotSheet);
        const changed=stored.find(row=>row[1]==='000222');
        assert.ok(changed);
        onSnapshotBackup(changed,stored);
        mutationCount++;
      }
      if(source!=='스냅샷' && onDerivedBackup){onDerivedBackup({source,rows:source==='가격이력'?priceRows:navRows}); mutationCount++;}
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
    price:()=>clone(priceRows),
    nav:()=>clone(navRows),
    initial:()=>clone(initial),
    foreign:()=>clone(stored.find(r=>r[1]==='000222')),
    fund:()=>clone(stored.find(r=>r[1]===fundCode)),
    stats:()=>({snapshotWrites,priceWrites,navWrites,backupCount,flushes,mutationCount,finalized,backupStates}),
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
// Full production reconciler: NAV and PRICE target fields may change, but
// a different date/code edited by another client after backup remains intact.
{
  const e=createEnvironment({includeNav:true,includePriceChange:true,
    onDerivedBackup:({source,rows})=>{
      const foreign=rows.find(r=>r[1]===(source==='가격이력'?'000222':'F00002'));
      assert.ok(foreign);
      if(source==='가격이력')foreign[3]=901;
      else foreign[5]=77;
    }});
  const result=e.run();
  assert.equal(result.navRows,1);
  assert.equal(result.priceRows,1);
  assert.equal(e.nav()[1][5],2);
  assert.equal(e.nav()[1][6],123);
  assert.equal(e.nav()[2][5],77,'unrelated NAV rows must not be copied over');
  assert.equal(e.price()[1][3],123);
  assert.equal(e.price()[2][3],901,'unrelated price rows must not be copied over');
  assert.ok(e.stats().navWrites>0 && e.stats().priceWrites>0);
  assert.equal(e.stats().backupCount,3);
  assert.deepEqual(e.stats().backupStates,['COMPLETED','COMPLETED','COMPLETED']);
  console.log('ISSUE507_FUND_DERIVED_NAV_PRICE_UNRELATED_ROWS_PRESERVED');
}
// 0 units removes only this fund's Snapshot physical row; never compact or
// move a different code, and zero NAV is a defined derived value.
{
  const e=createEnvironment({zeroUnits:true,sameDate:true});
  e.run();
  assert.ok(e.snapshot()[1].every(v=>v===''),'zero-unit target row must be cleared');
  assert.equal(e.snapshot()[2][1],'000222');
  assert.equal(e.snapshot()[2][3],3);
  assert.equal(e.price()[1][3],0);
  console.log('ISSUE507_FUND_DERIVED_ZERO_UNIT_SNAPSHOT_SLOT_PRESERVED');
}
// Manual price and Snapshot fields must remain user-managed.
{
  const e=createEnvironment({manual:true});
  const before=e.snapshot()[1];
  const pbefore=e.price()[1];
  const result=e.run();
  assert.deepEqual(e.snapshot()[1],before);
  assert.deepEqual(e.price()[1],pbefore);
  assert.ok(result.manualPreserved>=2);
  console.log('ISSUE507_FUND_DERIVED_MANUAL_FIELDS_PROTECTED');
}
// Inject a failure on the second disjoint fund change. The first changed
// field range must be restored, not leave a partially updated valuation.
{
  const e=createEnvironment({failSnapWriteAt:2});
  const before=e.snapshot();
  assert.throws(()=>e.run(),/SYNTHETIC_SNAPSHOT_WRITE_FAILURE/);
  assert.deepEqual(e.snapshot(),before,'fund Snapshot changes must be compensated');
  assert.ok(e.stats().backupStates.includes('WRITE_FAILED'));
  console.log('ISSUE507_FUND_DERIVED_PARTIAL_WRITE_ROLLBACK_CONFIRMED');
}
// Production reconciler must append the actual missing fund holding using
// the physical Snapshot width, including unrelated custom columns.
// The pre-fix 12-cell row fails strict setValues on a 14-column sheet.
{
  const e=createEnvironment({appendFund:true,snapshotWidth:14});
  const before=e.snapshot();
  assert.equal(before.length,2);
  assert.equal(before[1][12],'UNRELATED_EXTRA_COL13');
  const result=e.run();
  assert.equal(result.snapshotRows,1);
  const updated=e.snapshot();
  assert.equal(updated.length,3,'missing fund Snapshot row must be appended');
  assert.equal(updated[2].length,14,'appended fund row must have physical width 14');
  assert.equal(updated[2][0],date);
  assert.equal(updated[2][1],fundCode);
  assert.equal(updated[2][5],100);
  assert.equal(updated[2][7],123);
  assert.deepEqual(updated[2].slice(12),['',''],'extra columns must be padded only on new row');
  assert.deepEqual(updated[1],before[1],'unrelated 14-column row must retain all cells');
  assert.ok(e.stats().snapshotWrites>0);
  console.log('ISSUE507_FUND_DERIVED_APPEND_WIDE_SNAPSHOT_PADDED');
}
console.log('ISSUE507_FUND_DERIVED_SCOPED_CONTRACT_OK_SAME_CELL_TOCTOU_UNSOLVED');
