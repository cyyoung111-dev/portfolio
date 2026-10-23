#!/usr/bin/env node
// Issue #507 — synthetic read-volume characterization of the REAL production
// DATE_DISCOVERY helpers. No external APIs, real user data, sheet or GAS writes.
// Counts grid cells read; does NOT assert actual latency or production bottleneck.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync('src/gas/apps_script.gs','utf8');
const names=['_normalizeDate','_dateOffset','_latestConfirmedSnapshotDate',
  '_collectDailySnapshotDates','_readSettingsMap'];
function production(name) {
  const start=source.indexOf('function '+name+'(');
  assert.ok(start>=0,'production function missing: '+name);
  const end=source.indexOf('\n}',start);
  assert.ok(end>start,'production function boundary missing: '+name);
  return source.slice(start,end+2);
}
const productionCode=names.map(production).join('\n');
const readOnlySource=names.filter(n=>n!=='_normalizeDate'&&n!=='_dateOffset')
  .map(production).join('\n');
assert.doesNotMatch(readOnlySource,/\.setValues\(|\.appendRow\(|\.deleteRow\(|\.clearContents\(|\.setProperty\(/,
  'profiled production helpers must remain read-only');

const config=Object.freeze({SHEET_PH:'PRICE_HISTORY',
  SHEET_SNAPSHOT:'SNAPSHOT',SHEET_ETF_DIVIDENDS:'DIVIDENDS',
  SHEET_TRADES:'TRADES',SHEET_SETTINGS:'SETTINGS',TIMEZONE:'Asia/Seoul'});
const NAV='FUND_NAV',FX='환율이력';
const widths=Object.freeze({PRICE_HISTORY:1,SNAPSHOT:1,FUND_NAV:5,
  DIVIDENDS:5,'환율이력':1,TRADES:1,SETTINGS:2});
const cutoff='2026-10-20';

export function fixture(rowsPerSheet=1200) {
  assert.ok(Number.isSafeInteger(rowsPerSheet)&&rowsPerSheet>=10&&rowsPerSheet<=150000,
    'PROFILE_BAD_FIXTURE_ROWS');
  const reading=[],mutations=[];
  const values={};
  for(const [sheet,width] of Object.entries(widths)) {
    const count=sheet==='SETTINGS'?1:rowsPerSheet;
    values[sheet]=Array.from({length:count},()=>Array(width).fill(''));
    if(sheet!=='SETTINGS')for(const row of values[sheet])row[0]='2025-01-02';
  }
  values.SNAPSHOT.at(-1)[0]='2026-01-23';
  values.PRICE_HISTORY.at(-1)[0]='2026-01-16';
  values.FUND_NAV.at(-1)[4]='2026-01-17';
  values.DIVIDENDS.at(-1)[3]='2026-01-19';
  values['환율이력'].at(-1)[0]='2026-01-20';
  values.TRADES.at(-1)[0]='2026-01-21';
  values.SETTINGS[0]=['DIVDATA',JSON.stringify({TEST:{events:[
    {date:'2026-01-17',payDate:'2026-01-22'}]}})];
  const sheets={};
  for(const [name,data] of Object.entries(values)) {
    sheets[name]={
      getLastRow:()=>data.length+1,
      getLastColumn:()=>widths[name],
      getRange:(startRow,startColumn,numRows,numColumns)=>{
        assert.ok(startRow>=2&&startColumn>=1&&numRows>=0&&numColumns>=1);
        assert.ok(startRow-2+numRows<=data.length);
        assert.ok(startColumn-1+numColumns<=widths[name]);
        return {getValues:()=>{
          reading.push({sheet:name,rows:numRows,columns:numColumns,
            cells:numRows*numColumns});
          return data.slice(startRow-2,startRow-2+numRows)
            .map(row=>row.slice(startColumn-1,startColumn-1+numColumns));
        }};
      },
      setValues:()=>{mutations.push('setValues');throw Error('PROFILE_WRITE_PROHIBITED')},
      appendRow:()=>{mutations.push('appendRow');throw Error('PROFILE_WRITE_PROHIBITED')},
      deleteRow:()=>{mutations.push('deleteRow');throw Error('PROFILE_WRITE_PROHIBITED')}
    };
  }
  const ss={getSheetByName:name=>sheets[name]||null,
    insertSheet:()=>{mutations.push('insertSheet');throw Error('PROFILE_WRITE_PROHIBITED')}};
  const ctx=vm.createContext({CONFIG:config,FUND_NAV_SHEET:NAV,
    today:()=>cutoff,
    Utilities:{formatDate:date=>date.toISOString().slice(0,10)},
    Logger:{log:()=>{}},Date});
  vm.runInContext(productionCode,ctx);
  return {ss,ctx,reading,mutations,values};
}

export function readVolume(rows=1200){
  const f=fixture(rows);
  const last=f.ctx._latestConfirmedSnapshotDate(f.ss,false);
  assert.equal(last,'2026-01-23');
  const first=Object.keys(f.ctx._collectDailySnapshotDates(
    f.ss,'2026-01-16',last,{})).sort();
  // The calendar includes weekdays and explicitly recorded weekend evidence.
  for(const date of ['2026-01-16','2026-01-17','2026-01-19','2026-01-20',
      '2026-01-21','2026-01-22','2026-01-23'])
    assert.ok(first.includes(date),'missing source/calendar candidate: '+date);
  assert.ok(!first.includes('2026-01-18'),'unsourced Sunday must stay excluded');
  const latestSnapshotScan=f.reading[0].cells;
  const volume=f.reading.reduce((n,r)=>n+r.cells,0);
  const calls=f.reading.length;
  const bySheet=Object.fromEntries(Object.keys(widths).map(sheet=>[
    sheet,{calls:f.reading.filter(x=>x.sheet===sheet).length,
      cells:f.reading.filter(x=>x.sheet===sheet).reduce((n,r)=>n+r.cells,0)}]));
  f.reading.length=0;
  const later=Object.keys(f.ctx._collectDailySnapshotDates(
    f.ss,'2026-01-21',last,{})).sort();
  const laterVolume=f.reading.reduce((n,r)=>n+r.cells,0);
  // Critical finding: date filtering occurs AFTER Sheets getValues().
  // Moving the pending cursor forward does not shrink source-grid reads.
  assert.equal(laterVolume,volume-latestSnapshotScan,
    'a later pending cursor must not be incorrectly credited with lower read volume');
  assert.ok(later.every(date=>date>='2026-01-21'));
  assert.equal(f.mutations.length,0,'no mutation of any simulated sheet');
  return {mode:'SYNTHETIC_PRODUCTION_VM_READ_PROFILE',productionFunctions:names,
    syntheticRowsPerSheet:rows,callCount:calls,totalGridCellsRead:volume,
    bySheet,sourceCollectionCellsEvenWithLaterCursor:laterVolume,
    pendingCursorNarrowsGridRead:false,observedProductionLatency:false,
    measuredGoogleSheetsRuntime:false,sheetWrites:0};
}

function selfTest(){
  const a=readVolume(100),b=readVolume(1200);
  assert.equal(b.totalGridCellsRead/a.totalGridCellsRead>10,true);
  assert.equal(a.bySheet.SNAPSHOT.calls,2);
  assert.equal(a.bySheet.SETTINGS.calls,1);
  assert.ok(a.bySheet.FUND_NAV.cells>a.bySheet.PRICE_HISTORY.cells);
  assert.equal(b.sheetWrites,0);
  assert.equal(b.measuredGoogleSheetsRuntime,false);
  console.log('Issue #507 production DATE_DISCOVERY synthetic read profile: PASS');
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href) {
  try{
    if(process.argv.includes('--self-test'))selfTest();
    else console.log(JSON.stringify(readVolume(1200)));
  }catch(e){
    console.error(String(e?.message||'PROFILE_UNKNOWN').replace(/[^A-Za-z0-9_ :.-]/g,'').slice(0,220));
    process.exitCode=1;
  }
}
