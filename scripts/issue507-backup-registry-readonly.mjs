#!/usr/bin/env node
// Issue #507: backup registry evidence only. NEVER write/restore/delete a sheet.
// Prints aggregate safe metadata; never logs GAS responses, names, positions, or secrets.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {validateWebAppUrl} from './diagnose-krx-operational.mjs';
import {validateInventory} from './issue507-supervised-repair-dryrun-readonly.mjs';

export const TARGETS=Object.freeze([
  {label:'PRE_RECOVERY_20261019',name:'스냅샷_백업_20261019_507_0605복구전'},
  {label:'SYSTEM_20261020_1507',name:'스냅샷_백업_20261020_150704_df4655'},
  {label:'SYSTEM_20261021_1908',name:'스냅샷_백업_20261021_190811_803bd0'},
  {label:'SYSTEM_20261021_1947',name:'스냅샷_백업_20261021_194723_ebc4c5'}
]);
const STATUS=new Set(['','CREATED','COMPLETED','WRITE_FAILED']);
const CLASSES=new Set(['REGISTERED_COMPLETED','REGISTERED_INCOMPLETE',
  'REGISTERED_WRITE_FAILED','ORPHAN_LIKELY_SYSTEM','USER_MANAGED_BACKUP','UNKNOWN']);
function check(ok,code){if(!ok)throw Error('ISSUE507_BACKUP_READONLY_'+code);}
function count(n){check(Number.isSafeInteger(n)&&n>=0&&n<10000000,'BAD_COUNT');return n;}

// Only report categorical provenance metadata already returned by GAS.
// Do not reveal raw operation IDs, timestamps, sheet names or registry records.
function presence(value){
  if(typeof value!=='string')return 'UNKNOWN';
  return value.trim()?'PRESENT':'ABSENT';
}
// Verifiable operation families from GAS v9.244 Snapshot write callers.
// The suffix may contain dates, UUIDs or caller tokens: NEVER serialize it.
const SNAPSHOT_BACKUP_OPERATION_FAMILIES=new Set([
  'refreshFundValuations','rebuildDailySnapshots','repairOct08FundSourceOnly',
  'rewriteSnapshotDate','targetedKrxRecovery','saveDailyPriceHistory',
  'snapshotConsistencyRepair','repairPriceAndSnapshotForDate','backfill'
]);
function operationFamily(value){
  if(typeof value!=='string')return 'UNKNOWN';
  if(!value.trim())return 'ABSENT';
  const separator=value.indexOf('|');
  if(separator<=0)return 'UNCLASSIFIED';
  const candidate=value.slice(0,separator);
  return SNAPSHOT_BACKUP_OPERATION_FAMILIES.has(candidate)?candidate:'UNCLASSIFIED';
}
function ageBucket(createdAt,observedAt){
  const valid=value=>{
    if(typeof value!=='string'
      ||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value))return false;
    const timestamp=Date.parse(value);
    // Date.parse normalizes impossible calendar dates (for example Feb 30).
    // The server reports UTC Z, so round-trip every year/month/day/time field.
    return Number.isFinite(timestamp)
      &&new Date(timestamp).toISOString().slice(0,19)===value.slice(0,19);
  };
  if(!valid(createdAt)||!valid(observedAt))return 'UNVERIFIED';
  const age=Date.parse(observedAt)-Date.parse(createdAt);
  if(age<0)return 'FUTURE_OR_CLOCK_SKEW';
  if(age<3600000)return 'LESS_THAN_ONE_HOUR';
  if(age<86400000)return 'ONE_TO_24_HOURS';
  return 'AT_LEAST_24_HOURS';
}
function provenanceSummary(record,observedAt){
  if(!record.systemGeneratedBackup)return {
    operationIdPresence:'NOT_REGISTERED',creationAgeBucket:'NOT_REGISTERED',
    operationFamily:'NOT_REGISTERED',
    updateTimePresence:'NOT_REGISTERED',completionTimePresence:'NOT_REGISTERED',
    orphanAdopted:'UNVERIFIED'
  };
  return {
    operationIdPresence:presence(record.operationId),
    operationFamily:operationFamily(record.operationId),
    creationAgeBucket:ageBucket(record.createdAt,observedAt),
    updateTimePresence:presence(record.updatedAt),
    completionTimePresence:presence(record.completedAt),
    orphanAdopted:record.orphanAdopted===true?'YES':
      record.orphanAdopted===false?'NO':'UNVERIFIED'
  };
}

export function summarizeWorkbook(payload,targets=TARGETS){
  const workbook=payload?.workbook, all=workbook?.sheets;
  check(payload?.status==='ok'&&workbook&&Array.isArray(all)
    &&all.length>0&&all.length<=600,'SCHEMA');
  check(new Set(all.map(r=>r?.name)).size===all.length,'DUPLICATE_SHEET_NAMES');
  return targets.map(target=>{
    const record=all.find(r=>r?.name===target.name);
    check(record&&record.backup===true&&record.role==='BACKUP'
      &&typeof record.systemGeneratedBackup==='boolean'
      &&(record.systemGeneratedBackup
        ?record.backupSource==='스냅샷'
        :record.backupSource===''||record.backupSource==='스냅샷')
      &&STATUS.has(record.backupStatus)
      &&CLASSES.has(record.backupClassification)
      &&(record.signatureMatch===null||typeof record.signatureMatch==='boolean')
      &&typeof record.sourceSheetExists==='boolean','TARGET_SCHEMA');
    const physicalRows=count(record.lastRow),columns=count(record.lastColumn);
    const registered=record.systemGeneratedBackup;
    const consistentClassification=registered
      ?(record.backupStatus==='COMPLETED'&&record.backupClassification==='REGISTERED_COMPLETED'
        ||record.backupStatus==='WRITE_FAILED'&&record.backupClassification==='REGISTERED_WRITE_FAILED'
        ||record.backupStatus==='CREATED'&&record.backupClassification==='REGISTERED_INCOMPLETE')
      :record.backupStatus===''&&record.signatureMatch===null
        &&['ORPHAN_LIKELY_SYSTEM','USER_MANAGED_BACKUP','UNKNOWN'].includes(record.backupClassification);
    check(consistentClassification,'REGISTRY_CLASS');
    return {
      label:target.label,registryPresent:registered,registryState:record.backupStatus||'UNREGISTERED',
      classification:record.backupClassification,
      // A CREATED backup may have no settling operation ID. This is an
      // observation only; neither absence nor age establishes why it stalled.
      registrationMetadata:provenanceSummary(record,workbook.generatedAt),
      backupContentSignatureMatchesRegistry:record.signatureMatch,
      // GAS defaults unregistered backups to source-exists=true.
      // That does not prove the original sheet actually exists.
      sourceSheetExists:registered?record.sourceSheetExists:null,
      lastRowIncludingHeader:physicalRows,lastColumn:columns,
      // A matching signature attests only backup content vs registry; does not
      // prove the backup covered the whole source at the correct operation.
      sourceAtCopySignatureVerified:false,ledgerCoverageVerified:false,
      fullSheetRestoreVerified:false,restoreAllowed:false,deleteAllowed:false
    };
  });
}
export function report(before,after,items){
  check(before?.dates&&after?.dates&&before.dates.join('|')===after.dates.join('|')
    &&before.cursor===after.cursor&&before.pendingFrom===after.pendingFrom,'QUEUE_CHANGED');
  check(Array.isArray(items)&&items.length===TARGETS.length
    &&items.every((r,i)=>r.label===TARGETS[i].label),'SUMMARY');
  return {
    mode:'BACKUP_REGISTRY_READ_ONLY',gasVersion:'9.244',
    deferredQueueStableWithinCall:true,
    sourceDigestVerified:false,sourceRevisionVerified:false,
    backupInventoryCount:items.length,backups:items,
    restoreAllowed:false,deleteAllowed:false,writesPerformed:0,
    note:'Registry content signature confirms only the backup as currently recorded, not original sheet coverage or original sourceSignature. No ScriptLock, no full source hash and no historical ledger reconciliation; NEVER restore or delete automatically.'
  };
}
async function request(url,token,action,fetchImpl){
  let res;
  try{
    res=await fetchImpl(url,{
      method:'POST',redirect:'follow',
      headers:{'content-type':'application/x-www-form-urlencoded;charset=UTF-8'},
      body:new URLSearchParams({action,accessToken:token}),
      signal:AbortSignal.timeout(330000)
    });
  }catch{throw Error('ISSUE507_BACKUP_READONLY_NETWORK');}
  check(res?.ok===true,'HTTP');
  try{return await res.json();}
  catch{throw Error('ISSUE507_BACKUP_READONLY_JSON');}
}
export async function runReadonly({url,token,fetchImpl=fetch}){
  const endpoint=validateWebAppUrl(url);
  check(typeof token==='string'&&token.trim(),'AUTH_MISSING');
  const invalid=token==='ISSUE507_BACKUP_INVALID'
    ?'ISSUE507_BACKUP_INVALID_2':'ISSUE507_BACKUP_INVALID';
  const denied=await request(endpoint,invalid,'getAutomationStatus',fetchImpl);
  check(denied?.status==='error'&&denied.message==='인증 실패','AUTH_GUARD');
  const beforeStatus=await request(endpoint,token,'getAutomationStatus',fetchImpl);
  const before=validateInventory(beforeStatus);
  const work=await request(endpoint,token,'diagnoseWorkbookCells',fetchImpl);
  const summarized=summarizeWorkbook(work);
  const afterStatus=await request(endpoint,token,'getAutomationStatus',fetchImpl);
  const after=validateInventory(afterStatus);
  return report(before,after,summarized);
}
function productionContract({unregisteredPreRecovery=false,missingSource=false}={}){
  // Execute the actual production GAS workbook reader against memory-only
  // simulated sheets. Do not claim an actual workbook was inspected here.
  const gas=fs.readFileSync(new URL('../src/gas/apps_script.gs',import.meta.url),'utf8');
  assert.match(gas,/if \(params\.action === 'diagnoseWorkbookCells'\) return handleDiagnoseWorkbookCells\(\);/);
  assert.match(gas,/'diagnoseWorkbookCells'/);
  const names=['_backupSourceFromSystemName','_diagnoseWorkbookCells',
    'handleDiagnoseWorkbookCells'];
  const production=names.map(name=>{
    const start=gas.indexOf('function '+name+'(');
    const end=start<0?-1:gas.indexOf('\n}',start);
    assert.ok(start>=0&&end>start,'production function missing: '+name);
    return gas.slice(start,end+2);
  }).join('\n');
  const source={getName:()=> '스냅샷',getMaxRows:()=>1000,getMaxColumns:()=>12,getLastRow:()=>30,getLastColumn:()=>12};
  const old={getName:()=> TARGETS[0].name,getMaxRows:()=>1000,getMaxColumns:()=>12,getLastRow:()=>100,getLastColumn:()=>12,__hash:'correct'};
  const newest={getName:()=> TARGETS[1].name,getMaxRows:()=>1000,getMaxColumns:()=>12,getLastRow:()=>7,getLastColumn:()=>12,__hash:'changed'};
  // The new 10/21 targets are synthetic registry-state fixtures only:
  // their hashes are not claims about source-at-copy completeness.
  const oct1908={getName:()=>TARGETS[2].name,getMaxRows:()=>12000,
    getMaxColumns:()=>12,getLastRow:()=>10728,getLastColumn:()=>12,__hash:'oct1908-mock'};
  const oct1947={getName:()=>TARGETS[3].name,getMaxRows:()=>12000,
    getMaxColumns:()=>12,getLastRow:()=>9105,getLastColumn:()=>12,__hash:'oct1947-mock'};
  const sheets=missingSource?[old,newest,oct1908,oct1947]:[source,old,newest,oct1908,oct1947];
  const ss={getSheets:()=>sheets,getSheetByName:name=>sheets.find(x=>x.getName()===name)||null};
  const registry=[
    ...(!unregisteredPreRecovery?[{name:TARGETS[0].name,source:'스냅샷',
      status:'COMPLETED',signature:'correct',createdAt:'',completedAt:''}]:[]),
    {name:TARGETS[1].name,source:'스냅샷',status:'CREATED',
      signature:'old-hash',createdAt:'',completedAt:''},
    {name:TARGETS[2].name,source:'스냅샷',status:'COMPLETED',
      signature:'oct1908-mock',createdAt:'',completedAt:''},
    {name:TARGETS[3].name,source:'스냅샷',status:'WRITE_FAILED',
      signature:'not-a-match',createdAt:'',completedAt:''}
  ];
  const sandbox={
    _readSystemBackupRegistry:()=>registry,
    _sheetFormulaReferenceCounts:(_ss,names)=>Object.fromEntries(names.map(n=>[n,0])),
    _sheetContentSignature:sh=>sh.__hash||'source',
    _sheetRole:name=>name==='스냅샷'?'OPERATIONAL':'BACKUP',
    _isGasReferencedSheet:name=>name==='스냅샷',
    GOOGLE_SHEETS_CELL_LIMIT:10000000,
    SYSTEM_BACKUP_KEEP_BY_SOURCE:{'스냅샷':0},
    getss:()=>ss,jsonOk:x=>({status:'ok',...x}),jsonError:x=>({status:'error',message:x})
  };
  vm.runInNewContext(production,vm.createContext(sandbox),{timeout:3000});
  return sandbox.handleDiagnoseWorkbookCells();
}
export async function selfTest(){
  const fixture=productionContract();
  const out=summarizeWorkbook(fixture);
  assert.equal(out.length,TARGETS.length);
  assert.equal(out[0].backupContentSignatureMatchesRegistry,true);
  assert.equal(out[0].registryState,'COMPLETED');
  assert.equal(out[1].backupContentSignatureMatchesRegistry,false);
  assert.equal(out[1].registryState,'CREATED');
  assert.equal(out[1].lastRowIncludingHeader,7);
  assert.equal(out[2].registryState,'COMPLETED');
  assert.equal(out[2].backupContentSignatureMatchesRegistry,true);
  assert.equal(out[2].sourceAtCopySignatureVerified,false);
  assert.equal(out[3].registryState,'WRITE_FAILED');
  assert.equal(out[3].classification,'REGISTERED_WRITE_FAILED');
  assert.equal(out[3].backupContentSignatureMatchesRegistry,false);
  assert.equal(out[3].restoreAllowed,false);
  assert.ok(out.every(x=>!x.restoreAllowed&&!x.sourceAtCopySignatureVerified));
  // Actual production GAS naming regex does NOT match the 10/19 human
  // pre-recovery suffix. An unregistered backup must be reported, not crash.
  const unregistered=productionContract({unregisteredPreRecovery:true});
  const unregReport=summarizeWorkbook(unregistered);
  assert.equal(unregReport[0].registryPresent,false);
  assert.equal(unregReport[0].registryState,'UNREGISTERED');
  assert.equal(unregReport[0].classification,'USER_MANAGED_BACKUP');
  assert.equal(unregReport[0].backupContentSignatureMatchesRegistry,null);
  assert.equal(unregReport[0].sourceSheetExists,null);
  assert.equal(unregReport[0].restoreAllowed,false);
  // P2 regression: actual GAS returns true by default for an unregistered
  // backup despite a physically absent original source sheet.
  const withoutSource=productionContract({unregisteredPreRecovery:true,missingSource:true});
  const rawUnregistered=withoutSource.workbook.sheets.find(x=>x.name===TARGETS[0].name);
  assert.equal(rawUnregistered.sourceSheetExists,true);
  const missingReport=summarizeWorkbook(withoutSource);
  assert.equal(missingReport[0].registryPresent,false);
  assert.equal(missingReport[0].sourceSheetExists,null);
  assert.equal(missingReport[0].restoreAllowed,false);
  assert.equal(missingReport[1].registryPresent,true);
  assert.equal(missingReport[1].sourceSheetExists,false);
  assert.equal(unregReport[1].registryState,'CREATED');

  // Real GAS includes provenance metadata on each backup diagnostic row.
  // Only presence/category is retained; raw identifiers and times must not leak.
  const metadata=structuredClone(fixture);
  metadata.workbook.generatedAt='2026-10-21T13:06:00.000Z';
  const created=metadata.workbook.sheets.find(x=>x.name===TARGETS[2].name);
  created.backupStatus='CREATED';
  created.backupClassification='REGISTERED_INCOMPLETE';
  created.createdAt='2026-10-21T10:00:00.000Z';
  created.updatedAt='';created.completedAt='';
  created.operationId='rewriteSnapshotDate|PRIVATE_OPERATION_ID_DO_NOT_LEAK';
  created.orphanAdopted=false;
  const state=summarizeWorkbook(metadata);
  assert.equal(state[2].registrationMetadata.operationIdPresence,'PRESENT');
  assert.equal(state[2].registrationMetadata.operationFamily,'rewriteSnapshotDate');
  assert.equal(state[2].registrationMetadata.creationAgeBucket,'ONE_TO_24_HOURS');
  assert.equal(state[2].registrationMetadata.updateTimePresence,'ABSENT');
  assert.equal(state[2].registrationMetadata.completionTimePresence,'ABSENT');
  assert.equal(state[2].registrationMetadata.orphanAdopted,'NO');
  assert.equal(state[0].registrationMetadata.operationIdPresence,'ABSENT');
  assert.equal(unregReport[0].registrationMetadata.operationIdPresence,'NOT_REGISTERED');
  assert.equal(unregReport[0].registrationMetadata.operationFamily,'NOT_REGISTERED');
  assert.ok(!JSON.stringify(state).includes('PRIVATE_OPERATION_ID_DO_NOT_LEAK'));
  assert.ok(!JSON.stringify(state).includes('2026-10-21T10:00:00.000Z'));
  const noOperation=structuredClone(metadata);
  noOperation.workbook.sheets.find(x=>x.name===TARGETS[2].name).operationId='';
  assert.equal(summarizeWorkbook(noOperation)[2].registrationMetadata.operationIdPresence,'ABSENT');
  assert.equal(summarizeWorkbook(noOperation)[2].registrationMetadata.operationFamily,'ABSENT');
  noOperation.workbook.sheets.find(x=>x.name===TARGETS[2].name).operationId='rewriteSnapshotDateTypo|PRIVATE_OPERATION_ID_DO_NOT_LEAK';
  assert.equal(summarizeWorkbook(noOperation)[2].registrationMetadata.operationFamily,'UNCLASSIFIED');
  noOperation.workbook.sheets.find(x=>x.name===TARGETS[2].name).operationId='2026-10-21T10:00:00Z';
  assert.equal(summarizeWorkbook(noOperation)[2].registrationMetadata.operationFamily,'UNCLASSIFIED');
  noOperation.workbook.sheets.find(x=>x.name===TARGETS[2].name).operationId='snapshotConsistencyRepair|PRIVATE_OPERATION_ID_DO_NOT_LEAK';
  assert.equal(summarizeWorkbook(noOperation)[2].registrationMetadata.operationFamily,'snapshotConsistencyRepair');
  assert.ok(!JSON.stringify(summarizeWorkbook(noOperation)).includes('PRIVATE_OPERATION_ID_DO_NOT_LEAK'));
  noOperation.workbook.sheets.find(x=>x.name===TARGETS[2].name).operationId='';

  noOperation.workbook.sheets.find(x=>x.name===TARGETS[2].name).createdAt='INVALID';
  assert.equal(summarizeWorkbook(noOperation)[2].registrationMetadata.creationAgeBucket,'UNVERIFIED');
  noOperation.workbook.sheets.find(x=>x.name===TARGETS[2].name).createdAt='2026-02-30T10:00:00.000Z';
  assert.equal(summarizeWorkbook(noOperation)[2].registrationMetadata.creationAgeBucket,'UNVERIFIED');
  noOperation.workbook.sheets.find(x=>x.name===TARGETS[2].name).createdAt='2026-02-29T10:00:00.000Z';
  assert.equal(summarizeWorkbook(noOperation)[2].registrationMetadata.creationAgeBucket,'UNVERIFIED');
  const leap=structuredClone(metadata);
  leap.workbook.generatedAt='2024-03-01T00:00:00.000Z';
  leap.workbook.sheets.find(x=>x.name===TARGETS[2].name).createdAt='2024-02-29T23:30:00.000Z';
  assert.equal(summarizeWorkbook(leap)[2].registrationMetadata.creationAgeBucket,'LESS_THAN_ONE_HOUR');
  const skews=structuredClone(metadata);
  skews.workbook.sheets.find(x=>x.name===TARGETS[2].name).createdAt='2026-10-22T10:00:00.000Z';
  assert.equal(summarizeWorkbook(skews)[2].registrationMetadata.creationAgeBucket,'FUTURE_OR_CLOCK_SKEW');
  // Preservation gate: provenance categorization must never imply restoration.
  assert.ok(state.every(x=>x.restoreAllowed===false&&x.deleteAllowed===false));

  const invalid=structuredClone(fixture);
  invalid.workbook.sheets=invalid.workbook.sheets.filter(x=>x.name!==TARGETS[1].name);
  assert.throws(()=>summarizeWorkbook(invalid),/TARGET_SCHEMA/);
  const missingOct21=structuredClone(fixture);
  missingOct21.workbook.sheets=missingOct21.workbook.sheets.filter(
    x=>x.name!==TARGETS[3].name);
  assert.throws(()=>summarizeWorkbook(missingOct21),/TARGET_SCHEMA/);
  const duplicate=structuredClone(fixture);
  duplicate.workbook.sheets.push(structuredClone(duplicate.workbook.sheets[0]));
  assert.throws(()=>summarizeWorkbook(duplicate),/DUPLICATE_SHEET_NAMES/);
  const wrongSource=structuredClone(fixture);
  wrongSource.workbook.sheets.find(x=>x.name===TARGETS[0].name).backupSource='가격이력';
  assert.throws(()=>summarizeWorkbook(wrongSource),/TARGET_SCHEMA/);
  const old='2026-01-22';
  const status={status:'ok',gasVersion:'9.244',automation:{
    gasVersion:'9.244',tradeSnapshotDeferredDates:[old],
    tradeSnapshotDeferredCount:1,tradeSnapshotDeferredOldestDate:old,
    tradeSnapshotDeferredCursor:'',pendingTradeSnapshotRebuildFrom:''
  }};
  const actions=[];
  const transport=async(_url,options)=>{
    const action=options.body.get('action'),tok=options.body.get('accessToken');
    actions.push(action);
    const val=tok==='TOKEN'
      ?(action==='getAutomationStatus'?status:fixture)
      :{status:'error',message:'인증 실패'};
    return {ok:true,json:async()=>val};
  };
  const live=await runReadonly({url:'https://script.google.com/macros/s/TEST/exec',
    token:'TOKEN',fetchImpl:transport});
  assert.deepEqual(actions,['getAutomationStatus','getAutomationStatus',
    'diagnoseWorkbookCells','getAutomationStatus']);
  assert.equal(live.backups.length,TARGETS.length);
  assert.equal(live.backups[2].registryState,'COMPLETED');
  assert.equal(live.backups[3].registryState,'WRITE_FAILED');
  assert.ok(live.backups.every(x=>x.sourceAtCopySignatureVerified===false));
  assert.equal(live.restoreAllowed,false);
  assert.equal(live.deleteAllowed,false);
  assert.equal(live.writesPerformed,0);
  const drift={...status,automation:{...status.automation,tradeSnapshotDeferredDates:['2026-01-23'],
    tradeSnapshotDeferredOldestDate:'2026-01-23'}};
  const before=validateInventory(status),after=validateInventory(drift);
  assert.throws(()=>report(before,after,out),/QUEUE_CHANGED/);
  assert.ok(!JSON.stringify(live).includes('correct'));
  console.log('Issue #507 backup registry READ ONLY contract: PASS');
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
  try{
    if(process.argv.includes('--self-test'))await selfTest();
    else console.log(JSON.stringify(await runReadonly({
      url:process.env.GAS_WEB_APP_URL,token:process.env.GAS_ACCESS_TOKEN
    })));
  }catch(e){
    if(process.argv.includes('--self-test'))console.error(String(e?.stack||e).slice(0,1800));
    else console.error(/^ISSUE507_BACKUP_READONLY_[A-Z_]+$/.test(String(e?.message||''))
      ?String(e.message):'ISSUE507_BACKUP_READONLY_UNKNOWN');
    process.exitCode=1;
  }
}
