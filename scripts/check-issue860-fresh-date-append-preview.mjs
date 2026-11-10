#!/usr/bin/env node
// #860 source-only regression. No Apps Script, Sheet, backup or Telegram network.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {composeIssue860Gas9289PerfCandidate} from './compose-issue860-gas9289-perf-candidate.mjs';
import {composeIssue860FreshDateAppendPreview} from './compose-issue860-fresh-date-append-preview.mjs';
import {assertGasReleaseReady} from './deploy-gas.mjs';

function fn(source, name) {
  const i=source.indexOf('function '+name+'('),j=source.indexOf('\n}',i);
  assert(i>=0&&j>i,'MISSING_'+name);
  return source.slice(i,j+2);
}
function evaluate(source,{existingDate='2026-11-09',writeDate='2026-11-10',overwrite=true}={}) {
  const history=[[existingDate,'005930','TEST',1,100,100,200,200,100,100,'NH','']];
  const newRow=[writeDate,'005930','TEST',1,100,100,210,210,110,110,'NH',''];
  const calls={backup:0,scoped:0,revision:0,log:0,settled:0};
  const sheet={
    getLastRow:()=>history.length+1,getLastColumn:()=>12,
    getRange:(r,c,h,w)=>({getValues:()=>{
      assert.equal(r,2);assert.equal(c,1);assert.equal(h,history.length);
      assert.equal(w,12);return history.map(x=>x.slice());
    }})
  };
  const ss={getSheetByName:()=>sheet};
  const ctx=vm.createContext({
    _issue507GateInside_:true,
    CONFIG:{SHEET_SNAPSHOT:'스냅샷'},
    LockService:{getScriptLock:()=>({hasLock:()=>true,waitLock:()=>{},releaseLock:()=>{}})},
    PropertiesService:{getScriptProperties:()=>({setProperty:()=>{}})},
    Logger:{log:s=>{if(String(s).includes('ISSUE860_FRESH_DATE_APPEND'))calls.log++;}},
    _snapshotBackupOperationId:'',
    _normalizeDate:x=>String(x||'').slice(0,10),
    _cleanCode:x=>String(x||'').trim(),
    _dedupeSnapshotRows:rows=>rows,
    _isFundCode:code=>/^F\d{5}$/.test(String(code)),
    _snapshotIntegrityKey:row=>String(row[1]||''),
    _classifyRawSnapshotDuplicateGroups:()=>[],
    _mergeSnapshotRowsSafely:(_same,incoming)=>incoming,
    _snapshotRowsSignature:rows=>JSON.stringify(rows),
    _backupSnapshotBeforeWrite:()=>{calls.backup++;return{name:'synthetic-backup'};},
    _writeSnapshotDateScoped_:(_ss,_sheet,date,before,desired)=>{
      assert.equal(_ss,ss);assert.equal(_sheet,sheet);
      assert.equal(date,writeDate);assert.equal(before.length,history.length);
      assert.equal(desired.length,1);assert.equal(desired[0][1],'005930');
      calls.scoped++;
    },
    _touchSnapshotIntegritySourceRevision:()=>{calls.revision++;},
    _markSnapshotBackupStatus:()=>{calls.settled++;},
    _cleanupCurrentSystemBackup:()=>({status:'VERIFIED'}),
    _normalizeCodeRows:rows=>rows,
    SpreadsheetApp:{flush:()=>{}},
    Array,Object,Number,String,Boolean,Math,JSON
  });
  vm.runInContext(fn(source,'writeSnapshotRows'),ctx);
  ctx.writeSnapshotRows(ss,writeDate,[newRow],overwrite);
  return calls;
}
const base=composeIssue860Gas9289PerfCandidate().candidate;
assert.equal(assertGasReleaseReady(base),'9.289');
const preview=composeIssue860FreshDateAppendPreview(base);
assert.equal(preview.sourceOnly,true);
assert.equal(preview.approvedForDeploy,false);
assert.equal(preview.financialWrites,0);
assert.equal(preview.gasDeployments,0);
assert.notEqual(preview.source,base);
assert.throws(()=>assertGasReleaseReady(preview.source),/GAS_RELEASE_SOURCE_NOT_APPROVED/);
assert.throws(()=>composeIssue860FreshDateAppendPreview(preview.source),
 /ISSUE860_APPEND_ALREADY_APPLIED|ISSUE860_APPEND_SOURCE_DRIFT/);
new vm.Script(preview.source,{filename:'unapproved-issue860-fresh-date-append.gs'});
const originalFuncs=new Map([...base.matchAll(/^function ([A-Za-z_$][\w$]*)\s*\(/gm)].map(m=>[m[1],fn(base,m[1])]));
const proposedFuncs=new Map([...preview.source.matchAll(/^function ([A-Za-z_$][\w$]*)\s*\(/gm)].map(m=>[m[1],fn(preview.source,m[1])]));
assert.deepEqual([...proposedFuncs.keys()],[...originalFuncs.keys()]);
const changed=[...originalFuncs.keys()].filter(name=>originalFuncs.get(name)!==proposedFuncs.get(name));
assert.deepEqual(changed,['writeSnapshotRows']);
for(const name of [
  '_writeSnapshotDateScoped_','_backupSheetBeforeWrite','_backupSnapshotBeforeWrite',
  'diagnoseSnapshotIntegrity','_snapshotRewritePlan',
  'saveDailyPriceHistory','_refreshFundValuations',
  'runDailyPortfolioClose1900','runPortfolioCloseWatchdog2030',
  'runTradeV2MigrationApply','runTradeV2MigrationRestore',
  '_issue507GateEnter_','_issue507GateInvoke_'
])assert.equal(proposedFuncs.get(name),originalFuncs.get(name),'PROTECTED_'+name);
const appendBefore=evaluate(base);
const appendAfter=evaluate(preview.source);
assert.equal(appendBefore.backup,1,'Baseline takes full backup on fresh date');
assert.equal(appendAfter.backup,0,'New-date append must not copy historical snapshot');
assert.equal(appendAfter.scoped,1,'Same verified journaled date writer used');
assert.equal(appendAfter.revision,1);
assert.equal(appendAfter.log,1);
const repairBefore=evaluate(base,{existingDate:'2026-11-10'});
const repairAfter=evaluate(preview.source,{existingDate:'2026-11-10'});
assert.deepEqual(repairAfter,repairBefore,'Historical same-date correction must preserve backup');
assert.equal(repairAfter.backup,1);
const nonOverwrite=evaluate(preview.source,{overwrite:false});
assert.equal(nonOverwrite.backup,1,'Non-overwrite path is not eligible for fast append');
assert.equal(nonOverwrite.scoped,1);
console.log(JSON.stringify({
 kind:'ISSUE860_FRESH_DATE_APPEND_SOURCE_ONLY_PASS',
 candidateBase:'9.289',changedFunctions:changed,
 scenarios:['new-date-append','same-date-repair','non-overwrite'],
 freshDayBackupCopies:{before:appendBefore.backup,after:appendAfter.backup},
 existingDateBackupCopies:repairAfter.backup,verifiedScopedWriterUnchanged:true,
 productionApproved:false,financialWrites:0,gasDeployments:0,telegramSends:0
}));
