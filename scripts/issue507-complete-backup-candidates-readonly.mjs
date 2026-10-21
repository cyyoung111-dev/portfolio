#!/usr/bin/env node
// Issue #507: inspect additional REGISTERED_COMPLETED Snapshot backups only.
// STRICT READ ONLY: never call a writer, change a registry, restore or delete.
// Never print sheet names, codes, accounts, source rows, operation IDs or tokens.
import assert from 'node:assert/strict';
import {TARGETS,summarizeWorkbook} from './issue507-backup-registry-readonly.mjs';
import {validateInventory} from './issue507-supervised-repair-dryrun-readonly.mjs';
import {validateWebAppUrl} from './diagnose-krx-operational.mjs';

const STATUSES=new Set(['CREATED','COMPLETED','WRITE_FAILED']);
function guard(ok,code){if(!ok)throw Error('ISSUE507_BACKUP_CANDIDATES_'+code);}
function bounded(n){guard(Number.isSafeInteger(n)&&n>=0&&n<10000000,'BAD_SIZE');return n;}

export function classifyCandidates(payload){
  // Also validates both previously audited target backups against production schema.
  summarizeWorkbook(payload);
  const all=payload.workbook.sheets;
  const exclude=new Set(TARGETS.map(x=>x.name));
  const related=all.filter(x=>x&&x.role==='BACKUP'&&x.backup===true
    &&x.systemGeneratedBackup===true&&x.backupSource==='스냅샷'
    &&!exclude.has(x.name));
  related.forEach(x=>{
    guard(typeof x.name==='string'&&x.name.length>0
      &&STATUSES.has(x.backupStatus)
      &&typeof x.sourceSheetExists==='boolean'
      &&(x.signatureMatch===true||x.signatureMatch===false||x.signatureMatch===null),
      'INVALID_REGISTRY_ROW');
    bounded(x.lastRow);bounded(x.lastColumn);
    guard((x.backupStatus==='COMPLETED'&&x.backupClassification==='REGISTERED_COMPLETED')
      ||(x.backupStatus==='CREATED'&&x.backupClassification==='REGISTERED_INCOMPLETE')
      ||(x.backupStatus==='WRITE_FAILED'&&x.backupClassification==='REGISTERED_WRITE_FAILED'),
      'INVALID_REGISTRY_CLASS');
  });
  const completed=related.filter(x=>x.backupStatus==='COMPLETED');
  const selfMatched=completed.filter(x=>x.signatureMatch===true&&x.sourceSheetExists===true)
    .sort((a,b)=>a.name.localeCompare(b.name));
  const MAX=20;
  return {
    mode:'ISSUE507_COMPLETE_BACKUP_CANDIDATES_READ_ONLY',
    additionalRegisteredSnapshotBackups:related.length,
    additionalRegisteredCompleted:completed.length,
    completedSelfMatchedWithExistingSource:selfMatched.length,
    completedUnverified:completed.length-selfMatched.length,
    candidates:selfMatched.slice(0,MAX).map((x,i)=>({
      label:'CANDIDATE_'+String(i+1).padStart(2,'0'),
      lastRowIncludingHeader:bounded(x.lastRow),lastColumn:bounded(x.lastColumn),
      registryStatus:'COMPLETED',backupSelfSignatureMatched:true,
      sourceAtCopySignatureVerified:false,ledgerDateCodeCoverageVerified:false,
      fullRestoreVerified:false,restoreAllowed:false,deleteAllowed:false
    })),
    truncated:selfMatched.length>MAX,
    sourceDigestVerified:false,sourceRevisionVerified:false,
    sourceAtCopySignatureVerified:false,ledgerDateCodeCoverageVerified:false,
    restoreAllowed:false,deleteAllowed:false,writesPerformed:0,
    note:'Self-signature means only backup content matches registry now. Candidates are neither historical full-source evidence nor authorized restoration images. Opaque ordinals are execution-local.'
  };
}
async function request(url,token,action,fetchImpl){
  let response;
  try{
    response=await fetchImpl(url,{method:'POST',redirect:'follow',
      headers:{'content-type':'application/x-www-form-urlencoded;charset=UTF-8'},
      body:new URLSearchParams({action,accessToken:token}),
      signal:AbortSignal.timeout(330000)});
  }catch{throw Error('ISSUE507_BACKUP_CANDIDATES_NETWORK');}
  guard(response?.ok===true,'HTTP');
  try{return await response.json();}
  catch{throw Error('ISSUE507_BACKUP_CANDIDATES_JSON');}
}
export async function runReadonly({url,token,fetchImpl=fetch}){
  const endpoint=validateWebAppUrl(url);
  guard(typeof token==='string'&&token.trim().length>0,'TOKEN_REQUIRED');
  const invalid=token==='ISSUE507_INVALID_A'?'ISSUE507_INVALID_B':'ISSUE507_INVALID_A';
  const denied=await request(endpoint,invalid,'getAutomationStatus',fetchImpl);
  guard(denied?.status==='error'&&denied.message==='인증 실패','AUTH_GUARD');
  const before=validateInventory(await request(endpoint,token,'getAutomationStatus',fetchImpl));
  const result=classifyCandidates(await request(endpoint,token,'diagnoseWorkbookCells',fetchImpl));
  const after=validateInventory(await request(endpoint,token,'getAutomationStatus',fetchImpl));
  guard(before.dates.join('|')===after.dates.join('|')
    &&before.cursor===after.cursor&&before.pendingFrom===after.pendingFrom,'QUEUE_DRIFT');
  return {...result,deferredQueueStableWithinCall:true};
}
export async function selfTest(){
  const original={
    status:'ok',workbook:{sheets:[
      {name:TARGETS[0].name,role:'BACKUP',backup:true,
        systemGeneratedBackup:false,backupSource:'',backupStatus:'',
        backupClassification:'USER_MANAGED_BACKUP',signatureMatch:null,
        sourceSheetExists:true,lastRow:100,lastColumn:12},
      {name:TARGETS[1].name,role:'BACKUP',backup:true,
        systemGeneratedBackup:true,backupSource:'스냅샷',backupStatus:'WRITE_FAILED',
        backupClassification:'REGISTERED_WRITE_FAILED',signatureMatch:true,
        sourceSheetExists:true,lastRow:55,lastColumn:12},
      {name:'스냅샷_백업_20261017_120000_abc123',role:'BACKUP',backup:true,
        systemGeneratedBackup:true,backupSource:'스냅샷',backupStatus:'COMPLETED',
        backupClassification:'REGISTERED_COMPLETED',signatureMatch:true,
        sourceSheetExists:true,lastRow:200,lastColumn:12},
      {name:'스냅샷_백업_20261018_120000_def456',role:'BACKUP',backup:true,
        systemGeneratedBackup:true,backupSource:'스냅샷',backupStatus:'COMPLETED',
        backupClassification:'REGISTERED_COMPLETED',signatureMatch:false,
        sourceSheetExists:true,lastRow:160,lastColumn:12}
    ]}
  };
  const found=classifyCandidates(original);
  assert.equal(found.additionalRegisteredSnapshotBackups,2);
  assert.equal(found.additionalRegisteredCompleted,2);
  assert.equal(found.completedSelfMatchedWithExistingSource,1);
  assert.equal(found.completedUnverified,1);
  assert.equal(found.candidates.length,1);
  assert.equal(found.candidates[0].lastRowIncludingHeader,200);
  assert.equal(found.restoreAllowed,false);
  assert.equal(found.writesPerformed,0);
  assert.ok(!JSON.stringify(found).includes('abc123'));
  assert.ok(!JSON.stringify(found).includes('def456'));
  const corrupt=structuredClone(original);
  corrupt.workbook.sheets[2].backupClassification='REGISTERED_WRITE_FAILED';
  assert.throws(()=>classifyCandidates(corrupt),/INVALID_REGISTRY_CLASS/);
  const missing=structuredClone(original);
  missing.workbook.sheets[2].signatureMatch=false;
  assert.equal(classifyCandidates(missing).completedSelfMatchedWithExistingSource,0);
  const date='2026-01-14';
  const status={status:'ok',gasVersion:'9.244',automation:{
    gasVersion:'9.244',tradeSnapshotDeferredDates:[date],
    tradeSnapshotDeferredCount:1,tradeSnapshotDeferredOldestDate:date,
    tradeSnapshotDeferredCursor:'',pendingTradeSnapshotRebuildFrom:''}};
  const calls=[];
  const transport=async(_url,options)=>{
    const action=options.body.get('action'),token=options.body.get('accessToken');
    calls.push(action);
    return {ok:true,json:async()=>token==='TOKEN'
      ?(action==='getAutomationStatus'?status:original)
      :{status:'error',message:'인증 실패'}};
  };
  const result=await runReadonly({url:'https://script.google.com/macros/s/TEST/exec',
    token:'TOKEN',fetchImpl:transport});
  assert.deepEqual(calls,['getAutomationStatus','getAutomationStatus',
    'diagnoseWorkbookCells','getAutomationStatus']);
  assert.equal(result.completedSelfMatchedWithExistingSource,1);
  assert.equal(result.deferredQueueStableWithinCall,true);
  assert.equal(result.restoreAllowed,false);
  assert.equal(result.writesPerformed,0);
  console.log('ISSUE507_COMPLETE_BACKUP_CANDIDATES_READ_ONLY_CONTRACT_OK');
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
  try{
    if(process.argv.includes('--self-test'))await selfTest();
    else console.log(JSON.stringify(await runReadonly({
      url:process.env.GAS_WEB_APP_URL,token:process.env.GAS_ACCESS_TOKEN})));
  }catch(e){
    if(process.argv.includes('--self-test'))console.error(String(e?.stack||e).slice(0,1800));
    else console.error(/^ISSUE507_BACKUP_CANDIDATES_[A-Z_]+$/.test(String(e?.message||''))
      ?String(e.message):'ISSUE507_BACKUP_CANDIDATES_UNKNOWN');
    process.exitCode=1;
  }
}
