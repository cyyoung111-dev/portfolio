#!/usr/bin/env node
// Offline production-function simulation. NO GAS endpoints, user data, or writes.
// Measures Sheets RPC-equivalent calls/cells, NOT live Google Sheets latency.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {composeSnapshotBackupReadPreview} from './snapshot-backup-read-optimization-preview.mjs';

const pinned=fs.readFileSync('src/gas/apps_script.gs','utf8');
const blob=createHash('sha1').update('blob '+Buffer.byteLength(pinned)+'\0')
  .update(pinned).digest('hex');
assert.equal(blob,'954fd4aeae767ddac0cb161d3a81003b5b699d1c',
  'Production GAS pin changed; re-review the optimization before running tests');
const proposed=composeSnapshotBackupReadPreview(pinned);
assert.equal(proposed.source.slice(0,pinned.indexOf('function _backupSheetBeforeWrite(')),
  pinned.slice(0,pinned.indexOf('function _backupSheetBeforeWrite(')));
function fn(source,name){
  const start=source.indexOf('function '+name+'(');
  assert(start>=0,'missing GAS function '+name);
  const end=source.indexOf('\n}',start);
  assert(end>start,'missing GAS function end '+name);
  return source.slice(start,end+2);
}
const names=['_sheetContentSignature','_backupSheetBeforeWrite'];
function fixture(gas,{rows=16636,copy=true,failCopy=false,operationId='' }={}){
  const calls=[],registry=[],properties=new Map();
  const events={copies:0,backupWrites:0,sourceWrites:0,creates:0,flushes:0};
  const width=12;
  const values=Array.from({length:rows},(_,i)=>{
    const row=Array(width).fill('');
    row[0]=i===0?'날짜':'2026-11-06';
    row[1]=i===0?'종목코드':String(i).padStart(6,'0');
    row[7]=i===0?'평가액':i===1?4:0;
    return row;
  });
  const formulas=Array.from({length:rows},()=>Array(width).fill(''));
  formulas[1][7]='=2+2'; // full copy must preserve an actual formula.
  const sheets=[];
  function sheet(name,data,formula,{maxRows=rows,maxColumns=width}={}){
    const item={name,data,formula,maxRows,maxColumns,
      getName(){return this.name;},
      getLastRow(){return this.data.length;},
      getLastColumn(){return this.data.length?width:0;},
      getMaxRows(){return this.maxRows;},
      getMaxColumns(){return this.maxColumns;},
      deleteRows(_start,count){this.maxRows-=count;},
      deleteColumns(_start,count){this.maxColumns-=count;},
      insertRowsAfter(_last,count){this.maxRows+=count;},
      getRange(row,column,height,columns){
        assert(row>=1&&column>=1&&height>=1&&columns>=1);
        const cellCount=height*columns;
        const slice=grid=>Array.from({length:height},(_,i)=>
          (grid[row+i-1]||Array(width).fill('')).slice(column-1,column-1+columns));
        const target={
          receiveCopy:(sourceRows,sourceFormulas)=>{
            item.data=sourceRows.map(x=>x.slice());
            item.formula=sourceFormulas.map(x=>x.slice());
            events.backupWrites++;
          },
          setValues:sourceRows=>{
            calls.push({sheet:name,operation:'setValues',cells:cellCount});
            item.data=sourceRows.map(x=>x.slice());
            item.formula=sourceRows.map(()=>Array(columns).fill(''));
            if(name==='스냅샷')events.sourceWrites++;
            else events.backupWrites++;
          },
          getValues:()=>{
            calls.push({sheet:name,operation:'getValues',cells:cellCount});
            return slice(item.data);
          },
          getFormulas:()=>{
            calls.push({sheet:name,operation:'getFormulas',cells:cellCount});
            return slice(item.formula);
          }
        };
        if(copy)target.copyTo=destination=>{
          events.copies++;
          calls.push({sheet:name,operation:'copyTo',cells:cellCount});
          if(failCopy)throw Error('SIMULATED_COPY_TIMEOUT');
          destination.receiveCopy(slice(item.data),slice(item.formula));
        };
        return target;
      }
    };
    sheets.push(item);
    return item;
  }
  const source=sheet('스냅샷',values,formulas);
  const ss={
    getSheetByName:name=>sheets.find(s=>s.name===name)||null,
    insertSheet:name=>{
      events.creates++;
      return sheet(name,[],[],{maxRows:1000,maxColumns:26});
    }
  };
  const context=vm.createContext({
    _snapshotBackupOperationId:operationId,
    CONFIG:{SHEET_SNAPSHOT:'스냅샷',TIMEZONE:'Asia/Seoul'},
    SNAPSHOT_REPAIR_STATE_KEY:'test-repair',
    SYSTEM_BACKUP_SIGNATURE_VERSION:2,
    PropertiesService:{getScriptProperties:()=>({
      getProperty:key=>properties.get(key)||null,
      setProperty:(key,val)=>{properties.set(key,val);},
      deleteProperty:key=>{properties.delete(key);}
    })},
    _readSystemBackupRegistry:()=>registry.slice(),
    _registerSystemBackup:record=>{
      const previous=registry.findIndex(x=>x.name===record.name);
      if(previous<0)registry.push(record);
      else registry[previous]=record;
    },
    _fundSheetCapacity:()=>({remainingCells:10000000}),
    _cleanupSystemBackups:()=>{throw Error('UNEXPECTED_BACKUP_CLEANUP');},
    _codeColumnForSheet:()=>2,
    _setCodeColumnText:()=>{},
    Utilities:{
      formatDate:()=> '20261109_103000',
      getUuid:()=> 'abcdef-test',
      DigestAlgorithm:{SHA_256:'SHA_256'},
      computeDigest:(_algo,payload)=>Array.from(createHash('sha256')
        .update(payload).digest()).map(byte=>byte>127?byte-256:byte)
    },
    SpreadsheetApp:{flush:()=>{events.flushes++;}},
    Date,JSON,Object,Array,String,Math,Number
  });
  vm.runInContext(names.map(n=>fn(gas,n)).join('\n'),context,{timeout:5000});
  const run=()=>{
    const begin=performance.now();
    const record=context._backupSheetBeforeWrite(ss,source,'스냅샷');
    return {record,simulatedRuntimeMs:Number((performance.now()-begin).toFixed(2))};
  };
  const metrics=()=>({
    totalCellsRead:calls.filter(x=>x.operation.startsWith('get'))
      .reduce((total,x)=>total+x.cells,0),
    sourceValueReads:calls.filter(x=>x.sheet==='스냅샷'&&x.operation==='getValues').length,
    sourceFormulaReads:calls.filter(x=>x.sheet==='스냅샷'&&x.operation==='getFormulas').length,
    totalGetValuesCalls:calls.filter(x=>x.operation==='getValues').length,
    totalGetFormulasCalls:calls.filter(x=>x.operation==='getFormulas').length,
    backupCopies:events.copies,backupWrites:events.backupWrites,
    sourceWrites:events.sourceWrites,flushes:events.flushes,
    createdTabs:events.creates,registeredBackups:registry.length
  });
  return {run,metrics,calls,events,registry,sheets,source};
}
const baseline=fixture(pinned);
const optimized=fixture(proposed.source);
const a=baseline.run(),b=optimized.run(),m0=baseline.metrics(),m1=optimized.metrics();
assert.equal(a.record.signature,a.record.sourceSignature);
assert.equal(b.record.signature,b.record.sourceSignature);
assert.equal(a.record.signature,b.record.signature);
assert.equal(m0.sourceValueReads,2,'Baseline must reread source full grid');
assert.equal(m1.sourceValueReads,1,'Proposal must only read source for signature');
assert.equal(m1.sourceFormulaReads,1,'Source formula signature must remain');
assert.equal(m1.totalGetValuesCalls,m0.totalGetValuesCalls-1);
assert.equal(m1.totalCellsRead,m0.totalCellsRead-16636*12);
assert.equal(m1.sourceWrites,0);
assert.equal(m1.backupCopies,1);
assert.equal(optimized.sheets[1].formula[1][7],'=2+2',
  'Backup must preserve formulas when copyTo is available');
assert.equal(optimized.registry.length,1);
assert.equal(b.record.status,'CREATED','Backup proof must be registered');

for(const gas of [pinned,proposed.source]){
  const reuse=fixture(gas,{rows:32,operationId:'same-operation'});
  const first=reuse.run(),second=reuse.run();
  assert.equal(first.record.name,second.record.name);
  assert.equal(second.record.reused,true);
  assert.equal(reuse.metrics().backupCopies,1,
    'Within-operation verified backup must be reused, not copied again');

  const fallback=fixture(gas,{rows:32,copy:false});
  const result=fallback.run();
  assert.equal(result.record.status,'CREATED');
  assert.equal(fallback.metrics().backupWrites,1,
    'No-copyTo fallback must still populate a backup');
  assert.equal(fallback.metrics().sourceWrites,0);

  const failed=fixture(gas,{rows:32,failCopy:true});
  assert.throws(()=>failed.run(),/SIMULATED_COPY_TIMEOUT/);
  assert.equal(failed.metrics().createdTabs,1,
    'An incomplete backup tab is intentionally preserved');
  assert.equal(failed.metrics().registeredBackups,0,
    'Failed copy must never create a trusted recovery record');
  assert.equal(failed.metrics().sourceWrites,0);
}
console.log(JSON.stringify({
  kind:'SNAPSHOT_BACKUP_READ_OPTIMIZATION_PREVIEW',
  evidence:'SYNTHETIC_PRODUCTION_FUNCTION_VM_NOT_LIVE_LATENCY',
  sourceVersion:'9.285',syntheticRows:16636,columns:12,
  removedFullGridCellsRead:m0.totalCellsRead-m1.totalCellsRead,
  before:m0,after:m1,
  measuredVmMilliseconds:{before:a.simulatedRuntimeMs,after:b.simulatedRuntimeMs},
  cases:['copyTo_formula_preserved','verified_operation_backup_reused',
    'no_copyTo_fallback','copy_timeout_fail_closed'],
  pinnedGASModified:false,financialWrites:0,productionGasDeployed:false
}));
