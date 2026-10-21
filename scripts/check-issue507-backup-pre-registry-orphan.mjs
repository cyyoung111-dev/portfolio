#!/usr/bin/env node
// Issue #507: synthetic, read-only reproduction of an orphaned system backup.
// Executes the real production functions; all Sheets/Properties are in-memory.
// A passing test verifies orphan creation failure remains protected without registry trust.
// It never accesses Google Sheets, GAS, trade data, credentials or the network.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../src/gas/apps_script.gs',import.meta.url),'utf8');
function productionFunction(name){
  const start=source.indexOf('function '+name+'(');
  assert.ok(start>=0,'missing production function '+name);
  const end=source.indexOf('\n}',start);
  assert.ok(end>start,'missing production function end '+name);
  return source.slice(start,end+2);
}
const production=[
  '_backupSheetBeforeWrite','_reconcileSystemBackups'
].map(productionFunction).join('\n');
const HEADER=['날짜','종목코드','종목명','수량','매수단가','매수원금',
  '평가단가','평가금액','손익','수익률(%)','평가단가소스','저장일시'];
function makeEnvironment(failurePoint){
  const registry=[];
  const props={};
  const tracking={created:0,registered:0,sourceWrites:0,backupWrites:0,
    deleted:0,copyAttempts:0};
  const sourceSheet={
    getName:()=> '스냅샷',getLastRow:()=> 3,getLastColumn:()=> 12,
    getRange:(row,col,count,width)=>({
      getValues:()=>{
        assert.equal(row,1);assert.equal(col,1);
        assert.equal(count,3);assert.equal(width,12);
        return [HEADER,Array(12).fill('SYNTH'),Array(12).fill('SYNTH')];
      },
      copyTo:other=>{
        tracking.copyAttempts++;
        if(failurePoint==='copy')throw Error('INJECTED_COPY_FAILURE');
        other.receiveCopy();
      }
    })
  };
  const sheets=[sourceSheet];
  const ss={
    getSheets:()=>sheets,
    insertSheet:name=>{
      tracking.created++;
      const backup={
        name,maxRows:1000,maxCols:26,dataCopied:false,
        getName(){return this.name;},
        getMaxRows(){return this.maxRows;},
        getMaxColumns(){return this.maxCols;},
        getLastRow(){return this.dataCopied?3:0;},
        getLastColumn(){return this.dataCopied?12:0;},
        deleteColumns(col,count){
          assert.equal(col,13);assert.equal(count,14);
          if(failurePoint==='trim')throw Error('INJECTED_TRIM_FAILURE');
          this.maxCols-=count;
        },
        insertRowsAfter(){throw Error('UNEXPECTED_GROWTH')},
        deleteRows(row,count){this.maxRows-=count;},
        getRange(row,col,height,width){
          return {receiveCopy:()=>{this.dataCopied=true;tracking.backupWrites++;},
            getValues:()=>this.dataCopied?[HEADER]:[],getFormulas:()=>[]};
        }
      };
      sheets.push(backup);
      return backup;
    },
    getSheetByName:name=>sheets.find(x=>x.getName()===name)||null
  };
  const context=vm.createContext({
    JSON,Date,Object,String,Number,Math,
    CONFIG:{SHEET_SNAPSHOT:'스냅샷',TIMEZONE:'Asia/Seoul'},
    SNAPSHOT_REPAIR_STATE_KEY:'SYNTHETIC_REPAIR',
    SYSTEM_BACKUP_SIGNATURE_VERSION:2,
    _snapshotBackupOperationId:'',
    Utilities:{formatDate:()=> '20261021_090701',getUuid:()=> 'f7a0f4-TEST'},
    PropertiesService:{getScriptProperties:()=>({
      getProperty:k=>props[k]||null,
      setProperty:(k,v)=>{props[k]=v;},
      deleteProperty:k=>{delete props[k];}
    })},
    _readSystemBackupRegistry:()=>registry.slice(),
    _writeSystemBackupRegistry:items=>{
      tracking.registered+=items.length;
      registry.splice(0,registry.length,...items);
    },
    _registerSystemBackup:record=>{
      tracking.registered++;
      registry.push(record);
    },
    _fundSheetCapacity:()=>({remainingCells:9500000}),
    _cleanupSystemBackups:()=>{throw Error('NO_CLEANUP_EXPECTED')},
    _sheetContentSignature:sh=>sh===sourceSheet?'source-fingerprint':
      sh.dataCopied?'backup-fingerprint':'0x0',
    _sheetFormulaReferenceCount:()=>0,
    _backupSourceFromSystemName:name=>String(name).startsWith('스냅샷_백업_')?'스냅샷':'',
    _isGasReferencedSheet:()=>false,
    _sheetHeaderSignature:sh=>sh===sourceSheet?'schema-v12':
      sh.dataCopied?'schema-v12':'schema-EMPTY',
    _systemBackupTimestampFromName:()=> '2026-10-21T00:07:01Z',
    _codeColumnForSheet:()=>2,
    _setCodeColumnText:()=>{},
    SpreadsheetApp:{flush:()=>{}}
  });
  vm.runInContext(production,context,{timeout:4000});
  return {ss,sourceSheet,sheets,registry,tracking,context,props};
}
for(const failurePoint of ['trim','copy']){
  const e=makeEnvironment(failurePoint);
  assert.throws(()=>e.context._backupSheetBeforeWrite(e.ss,e.sourceSheet,'스냅샷'),
    new RegExp('INJECTED_'+failurePoint.toUpperCase()+'_FAILURE'));
  assert.equal(e.tracking.created,1,'the incomplete tab remains physically present');
  assert.equal(e.sheets.length,2,'the original and orphan tabs are both present');
  assert.equal(e.sheets[1].getMaxRows(),1000);
  assert.equal(e.sheets[1].getLastRow(),0,'copy did not successfully populate the tab');
  assert.equal(e.sheets[1].getMaxColumns(),failurePoint==='trim'?26:12);
  assert.equal(e.registry.length,0,'registry registration occurs after copy');
  assert.equal(e.tracking.registered,0,'no trusted registry record exists');
  assert.equal(e.tracking.sourceWrites,0,'no original Snapshot write');
  assert.equal(e.tracking.deleted,0,'orphan was not deleted');
  const reconciled=e.context._reconcileSystemBackups(e.ss);
  assert.equal(reconciled.reconciled.length,0,
    'empty backup must not be automatically adopted as COMPLETED');
  assert.equal(reconciled.unresolved.length,1);
  assert.equal(reconciled.unresolved[0].classification,'UNKNOWN');
}
// Even a fully copied, self-signed orphan without a registry record must
// remain untrusted, because source-at-copy provenance is missing.
// The registry-writing failure must not be hidden by reconciliation.
{
  const e=makeEnvironment('register');
  e.context._registerSystemBackup=()=>{throw Error('INJECTED_REGISTRATION_FAILURE');};
  assert.throws(()=>e.context._backupSheetBeforeWrite(e.ss,e.sourceSheet,'스냅샷'),
    /INJECTED_REGISTRATION_FAILURE/);
  assert.equal(e.sheets.length,2);
  assert.equal(e.sheets[1].dataCopied,true);
  assert.equal(e.registry.length,0);
  const recovered=e.context._reconcileSystemBackups(e.ss);
  assert.equal(recovered.reconciled.length,0,
    'complete-looking unregistered backup must never be promoted');
  assert.equal(recovered.unresolved.length,1);
  assert.equal(recovered.unresolved[0].classification,'ORPHAN_LIKELY_SYSTEM');
  assert.match(recovered.unresolved[0].reason,/sourceSignature/);
  assert.equal(e.tracking.registered,0,'reconciler must never write a trusted registry row');
  assert.equal(e.registry.length,0,'pre-registry failure remains unregistered');
  assert.equal(e.tracking.deleted,0,'original orphan must remain recoverable as evidence');
  assert.equal(e.tracking.sourceWrites,0,'no original Snapshot modification');
}
console.log('ISSUE507_BACKUP_PRE_REGISTRY_ORPHAN_FAIL_CLOSED');
console.log('ISSUE507_BACKUP_ORPHAN_READONLY_CONTRACT_PASS');
