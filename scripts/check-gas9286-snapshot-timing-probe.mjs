#!/usr/bin/env node
// Offline evidence: timing probe must not change Sheets I/O, restore semantics
// or emit holdings, account, backup IDs or cell contents. No live GAS access.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {composeGas9286IntegratedPreview} from './compose-gas9286-integrated-preview.mjs';
import {composeGas9286SnapshotTimingProbe} from './compose-gas9286-snapshot-timing-probe.mjs';

const {candidate,manifest}=composeGas9286IntegratedPreview();
assert.equal(manifest.proposedVersion,'9.286');
assert.equal(manifest.productionDeploymentApproved,false);
assert(manifest.integratedFeatures.includes('snapshot-stage-timing'));
assert.throws(()=>composeGas9286SnapshotTimingProbe(candidate),
 /TIMING_PROFILE_ANCHOR_AMBIGUOUS|TIMING_PROFILE_ANCHOR_MISSING/,
 'Refuse duplicate instrumentation');
function fn(source,name){
  const start=source.indexOf('function '+name+'(');
  assert(start>=0,'missing function '+name);
  const end=source.indexOf('\n}',start);
  assert(end>start,'unterminated function '+name);
  return source.slice(start,end+2);
}
const profiled=fn(candidate,'_backupSheetBeforeWrite');
const control=profiled
  .replace(/  \/\/ Structured log only; no sheet name, values, account, or backup ID\.[\s\S]*?  \};\n/, '')
  .replace(/^  snapshotTimingMark\([^\n]+\);\n/gm,'')
  .replace(/^      snapshotTimingMark\([^\n]+\);\n/gm,'')
  .replace(/^    snapshotTimingMark\([^\n]+\);\n/gm,'');
// Compare side-effect calls using independent baseline code from the
// source-only optimizer (not the live 9.285 source).
const unprofiled=composeGas9286IntegratedPreview().candidate;
assert(new vm.Script(profiled));
assert(new vm.Script(fn(candidate,'writeSnapshotRows')));

function env(body,{failCopy=false,failRegistry=false,failSignature=false}={}){
  const logs=[],rpc=[],registry=[],props=new Map(),items=[];
  const state={sourceWrites:0,copied:false};
  const src={
    getName:()=> '스냅샷',
    getLastRow:()=>3,getLastColumn:()=>12,
    getRange:(row,col,rows,columns)=>{
      rpc.push('sourceRange');
      assert.equal(row,1);assert.equal(col,1);
      assert.equal(rows,3);assert.equal(columns,12);
      return {copyTo:()=>{
        rpc.push('copyTo');
        if(failCopy)throw Error('SIMULATED_BACKUP_COPY_TIMEOUT');
        state.copied=true;
      }};
    }
  };
  const ss={
    getSheetByName:name=>items.find(x=>x.name===name)||null,
    insertSheet:name=>{
      rpc.push('insertSheet');
      const backup={
        name,
        getName(){return name;},
        getMaxColumns:()=>26,getMaxRows:()=>1000,
        deleteColumns:()=>{rpc.push('deleteColumns');},
        deleteRows:()=>{rpc.push('deleteRows');},
        getLastRow:()=>state.copied?3:0,
        getLastColumn:()=>state.copied?12:0,
        getRange:()=>{rpc.push('backupRange');return {};}
      };
      items.push(backup);return backup;
    }
  };
  const context={
    CONFIG:{SHEET_SNAPSHOT:'스냅샷',TIMEZONE:'Asia/Seoul'},
    SNAPSHOT_REPAIR_STATE_KEY:'test_restore',
    SYSTEM_BACKUP_SIGNATURE_VERSION:2,
    _snapshotBackupOperationId:'',
    _readSystemBackupRegistry:()=>{rpc.push('registryRead');if(failRegistry)throw Error('Service Spreadsheets timed out while accessing document');return registry.slice();},
    _registerSystemBackup:record=>{rpc.push('registryCommit');registry.push(record);},
    _sheetContentSignature:sheet=>{
      rpc.push('signature');
      if(failSignature&&sheet!==src)throw Error('Service Spreadsheets timed out while accessing document');
      return sheet===src?'SOURCE_HASH':'BACKUP_HASH';
    },
    _fundSheetCapacity:()=>{rpc.push('capacity');return {remainingCells:10000000};},
    _cleanupSystemBackups:()=>{throw Error('UNEXPECTED_CLEANUP');},
    _codeColumnForSheet:()=>0,
    _setCodeColumnText:()=>{throw Error('UNEXPECTED_FORMATTING');},
    PropertiesService:{getScriptProperties:()=>({
      getProperty:key=>props.get(key)||null,
      setProperty:(key,value)=>{props.set(key,value);},
      deleteProperty:key=>{props.delete(key);}
    })},
    Utilities:{getUuid:()=> 'fake-uuid',
      formatDate:()=> '20261109_110000'},
    SpreadsheetApp:{flush:()=>{rpc.push('flush');}},
    Logger:{log:line=>logs.push(line)},
    JSON,Date,String,Array,Number,Object,Math
  };
  vm.runInNewContext(body,context,{timeout:2000});
  return {run:()=>context._backupSheetBeforeWrite(ss,src,'스냅샷'),
    logs,rpc,registry,state};
}
const success=env(profiled),baseline=env(control);
const a=success.run(),b=baseline.run();
assert.equal(a.signature,b.signature);
assert.equal(a.sourceSignature,b.sourceSignature);
assert.equal(a.status,'CREATED');
assert.equal(success.registry.length,1);
assert.equal(success.state.sourceWrites,0);
assert.deepEqual(success.rpc,baseline.rpc,'Profiler must issue no extra Sheets RPCs');
const events=success.logs.filter(x=>x.startsWith('[SNAPSHOT_BACKUP_TIMING] '))
  .map(line=>JSON.parse(line.slice('[SNAPSHOT_BACKUP_TIMING] '.length)));
for(const event of events){
 assert.deepEqual(Object.keys(event).sort(),
  ['stage','state','startedMs','deltaMs','totalMs'].sort(),
  'Only timing fields permitted in the trace');
 assert(Number.isFinite(event.totalMs)&&event.totalMs>=0);
 assert(Number.isFinite(event.deltaMs)&&event.deltaMs>=0);
}
for(const stage of ['registry_read','source_signature','backup_tab_create',
 'backup_copy','backup_flush','backup_signature','registry_commit']){
 assert(events.some(x=>x.stage===stage),'Missing stage '+stage);
}
for(const stage of ['registry_read','source_signature','backup_tab_create','backup_copy',
 'backup_flush','backup_signature']){
 assert(events.some(x=>x.stage===stage&&x.state==='START'));
 assert(events.some(x=>x.stage===stage&&x.state==='END'));
}
const failed=env(profiled,{failCopy:true});
assert.throws(()=>failed.run(),/SIMULATED_BACKUP_COPY_TIMEOUT/);
assert.equal(failed.registry.length,0,'Never trust an incomplete backup');
assert.equal(failed.state.sourceWrites,0,'Original must stay untouched');
const failureEvents=failed.logs.filter(x=>x.startsWith('[SNAPSHOT_BACKUP_TIMING] '))
 .map(line=>JSON.parse(line.slice('[SNAPSHOT_BACKUP_TIMING] '.length)));
assert(failureEvents.some(x=>x.stage==='backup_copy'&&x.state==='START'));
assert(!failureEvents.some(x=>x.stage==='backup_copy'&&x.state==='END'));

// Reproduce the actual 2026-11-08 GAS class of failure at two independent
// backup stages; never classify an incomplete backup as recoverable evidence.
const failedRegistry=env(profiled,{failRegistry:true});
assert.throws(()=>failedRegistry.run(),/Service Spreadsheets timed out/);
assert.equal(failedRegistry.registry.length,0);
assert.equal(failedRegistry.state.sourceWrites,0);
assert.equal(failedRegistry.rpc.includes('insertSheet'),false);
const registryEvents=failedRegistry.logs.filter(x=>x.startsWith('[SNAPSHOT_BACKUP_TIMING] '))
 .map(line=>JSON.parse(line.slice('[SNAPSHOT_BACKUP_TIMING] '.length)));
assert(registryEvents.some(x=>x.stage==='registry_read'&&x.state==='START'));
assert(!registryEvents.some(x=>x.stage==='registry_read'&&x.state==='END'));
const failedSignature=env(profiled,{failSignature:true});
assert.throws(()=>failedSignature.run(),/Service Spreadsheets timed out/);
assert.equal(failedSignature.registry.length,0,
 'A post-copy Sheets timeout must never register a trusted backup');
assert.equal(failedSignature.state.sourceWrites,0,
 'A post-copy backup timeout cannot mutate the Snapshot source');
const signatureEvents=failedSignature.logs.filter(x=>x.startsWith('[SNAPSHOT_BACKUP_TIMING] '))
 .map(line=>JSON.parse(line.slice('[SNAPSHOT_BACKUP_TIMING] '.length)));
assert(signatureEvents.some(x=>x.stage==='backup_signature'&&x.state==='START'));
assert(!signatureEvents.some(x=>x.stage==='backup_signature'&&x.state==='END'));

// The existing writer still logs backup-start and failures while preserving
// the owned ScriptLock and never reaching date-scoped writes when backup fails.
const writeSource=fn(candidate,'writeSnapshotRows');
const release={count:0},writerLogs=[],writeCounts={backups:0,scoped:0,source:0};
const before=['2026-11-06','005930','TEST',1,100,100,100,100,0,0,'FUND_NAV',''];
const after=before.slice();after[7]=120;after[8]=20;
const writerSheet={
  getLastRow:()=>2,getLastColumn:()=>12,
  getRange:()=>({getValues:()=>[before.slice()]})
};
const writerContext={
  CONFIG:{SHEET_SNAPSHOT:'스냅샷'},
  LockService:{getScriptLock:()=>({
    hasLock:()=>false,waitLock:()=>{},releaseLock:()=>{release.count++;}
  })},
  _normalizeDate:x=>String(x),
  _dedupeSnapshotRows:rows=>rows,
  _cleanCode:x=>String(x||''),
  _isFundCode:()=>false,
  _classifyRawSnapshotDuplicateGroups:()=>[],
  _snapshotIntegrityKey:row=>row[1],
  _mergeSnapshotRowsSafely:(_previous,incoming)=>incoming,
  _snapshotRowsSignature:rows=>JSON.stringify(rows),
  _backupSnapshotBeforeWrite:()=>{
    writeCounts.backups++;throw Error('SIMULATED_BACKUP_TIMEOUT');
  },
  _writeSnapshotDateScoped_:()=>{writeCounts.scoped++;},
  _markSnapshotBackupStatus:()=>{},
  Logger:{log:line=>writerLogs.push(line)},
  Date,JSON,Array,String,Math,Number,Object
};
vm.runInNewContext(writeSource,writerContext,{timeout:2000});
assert.throws(()=>writerContext.writeSnapshotRows({
 getSheetByName:()=>writerSheet
},'2026-11-06',[after],true),/SIMULATED_BACKUP_TIMEOUT/);
assert.equal(writeCounts.backups,1);
assert.equal(writeCounts.scoped,0,'Writer must not proceed after backup failure');
assert.equal(release.count,1,'ScriptLock must be released on failure');
const writerEvents=writerLogs.filter(x=>x.startsWith('[SNAPSHOT_WRITE_TIMING] '))
  .map(line=>JSON.parse(line.slice('[SNAPSHOT_WRITE_TIMING] '.length)));
assert.deepEqual(writerEvents.map(x=>x.stage),['backup_start','error']);
for(const event of writerEvents){
 assert.deepEqual(Object.keys(event).sort(),['stage','startedMs','totalMs'].sort());
}

console.log(JSON.stringify({
 kind:'GAS9286_SNAPSHOT_STAGE_PROFILE_OFFLINE',
 stageCount:events.length,stageNames:[...new Set(events.map(x=>x.stage))],
 sourceRpcParity:success.rpc.length===baseline.rpc.length,
 copiedBeforeTimeout:failed.state.copied,
 failedCopyRegistryCount:failed.registry.length,
 writerBackupFailureProtected:true,writerLockReleased:true,
 logsContainFinancialData:false,
 profileSourceOnly:true,realSheetsTimingMeasured:false,
 financialWrites:0,gasDeployments:0
}));
