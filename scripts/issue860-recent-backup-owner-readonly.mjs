#!/usr/bin/env node
// #860: inspect ONLY named recent Snapshot backup provenance via existing GAS
// read-only API. Requires protected workflow credentials. NEVER restore/delete,
// write ScriptProperties, change financial sheets or print private GAS payloads.
import assert from 'node:assert/strict';
import {validateWebAppUrl} from './diagnose-krx-operational.mjs';

export const TARGETS=Object.freeze([
 {id:'N09_0101',name:'스냅샷_백업_20261109_010117_9eff75'},
 {id:'N08_2103',name:'스냅샷_백업_20261108_210327_84581d'},
 {id:'N08_2052',name:'스냅샷_백업_20261108_205238_26a041'},
 {id:'N08_2007',name:'스냅샷_백업_20261108_200729_2b5f7b'},
 {id:'N08_1958',name:'스냅샷_백업_20261108_195859_63350a'},
 {id:'N08_1948',name:'스냅샷_백업_20261108_194830_ce8e5f'},
 {id:'N08_0046',name:'스냅샷_백업_20261108_004639_e2e6dc'},
 {id:'N08_0039',name:'스냅샷_백업_20261108_003917_03fe82'},
 {id:'N06_2042_CONTROL',name:'스냅샷_백업_20261106_204202_9fabc7'}
]);
const ALLOWED_CLASSES=new Set([
 'REGISTERED_COMPLETED','REGISTERED_INCOMPLETE',
 'REGISTERED_WRITE_FAILED','ORPHAN_LIKELY_SYSTEM',
 'USER_MANAGED_BACKUP','UNKNOWN'
]);
const ALLOWED_STATUS=new Set(['','CREATED','COMPLETED','WRITE_FAILED']);
function ensure(ok,code){if(!ok)throw Error('ISSUE860_READONLY_'+code);}
function safeCount(n){ensure(Number.isSafeInteger(n)&&n>=0&&n<=1000000,'COUNT');return n;}
export function summarizeRecentBackupEvidence(payload,targets=TARGETS){
 const workbook=payload?.workbook,sheets=workbook?.sheets;
 ensure(payload?.status==='ok'&&Array.isArray(sheets)&&sheets.length>0&&sheets.length<=250,'SCHEMA');
 ensure(new Set(sheets.map(x=>x?.name)).size===sheets.length,'DUPLICATE_SHEET_NAMES');
 const byName=new Map(sheets.map(x=>[x.name,x]));
 const result=targets.map(target=>{
  const record=byName.get(target.name);
  if(!record)return {id:target.id,exists:false,decision:'MISSING_PRESERVE_EVIDENCE'};
  ensure(record.role==='BACKUP'&&record.backup===true
   &&record.backupSource==='스냅샷'
   &&typeof record.systemGeneratedBackup==='boolean'
   &&ALLOWED_STATUS.has(record.backupStatus)
   &&ALLOWED_CLASSES.has(record.backupClassification)
   &&(record.signatureMatch===null||typeof record.signatureMatch==='boolean'),
   'BACKUP_SCHEMA');
  const registered=record.systemGeneratedBackup;
  const expectedClass=registered?
   (record.backupStatus==='COMPLETED'?'REGISTERED_COMPLETED'
    :record.backupStatus==='WRITE_FAILED'?'REGISTERED_WRITE_FAILED':'REGISTERED_INCOMPLETE'):
   'ORPHAN_LIKELY_SYSTEM';
  ensure(record.backupClassification===expectedClass,'PROVENANCE_MISMATCH');
  const physicalRows=safeCount(record.lastRow),physicalColumns=safeCount(record.lastColumn);
  const allocatedRows=safeCount(record.maxRows),allocatedColumns=safeCount(record.maxColumns);
  return {id:target.id,exists:true,
   registered,registryStatus:record.backupStatus||'UNREGISTERED',
   classification:record.backupClassification,physicalRows,physicalColumns,
   allocatedCells:allocatedRows*allocatedColumns,
   backupSignatureMatchesRegistry:record.signatureMatch,
   operationIdPresent:registered?Boolean(String(record.operationId||'').trim()):false,
   // No transaction ID or raw timestamp/backup sheet name leaves the runner.
   sourceAtCopyVerified:false,ownerExecutionLinked:false,
   mayRestore:false,mayDelete:false,
   decision:physicalRows===0?'EMPTY_UNTRUSTED_PROTECTED':
     registered&&record.backupStatus==='COMPLETED'&&record.signatureMatch===true?
       'REGISTERED_COMPLETED_BUT_SOURCE_PROOF_UNVERIFIED':'PRESERVE_PENDING_OWNER_PROOF'
  };
 });
 return {kind:'ISSUE860_RECENT_BACKUP_OWNER_READONLY',
  source:'GAS_DIAGNOSE_WORKBOOK_CELLS',targetCount:result.length,
  found:result.filter(x=>x.exists).length,
  empty:result.filter(x=>x.physicalRows===0).length,
  registered:result.filter(x=>x.registered===true).length,
  ownerExecutionLinked:false,sourceAtCopyVerified:false,
  restoreAllowed:false,deleteAllowed:false,
  financeWrites:0,gasDeployments:0,telegramSends:0,
  targets:result};
}
const request=async({url,token,action,fetchImpl,timeoutMs=25000})=>{
 let r;
 try{
  r=await fetchImpl(url,{
   method:'POST',headers:{'content-type':'application/x-www-form-urlencoded;charset=UTF-8'},
   body:new URLSearchParams({action,accessToken:token}),
   redirect:'follow',signal:AbortSignal.timeout(timeoutMs)});
 }catch{throw Error('ISSUE860_READONLY_NETWORK_OR_TIMEOUT_'+action);}
 ensure(r?.ok===true,'HTTP_'+action);
 try{return await r.json();}
 catch{throw Error('ISSUE860_READONLY_JSON_'+action);}
};
export async function run({url,token,fetchImpl=fetch}={}){
 const endpoint=validateWebAppUrl(url);
 ensure(typeof token==='string'&&token.length>=12,'AUTH_REQUIRED');
 const check=await request({url:endpoint,token,action:'getAutomationStatus',fetchImpl});
 ensure(check?.status==='ok'&&check?.gasVersion==='9.284','PRODUCTION_VERSION_DRIFT');
 const stage=String(check.automation?.portfolioClose?.stage||check.automation?.closeRun?.stage||'');
 if(['PRICE','FUND','RUNNING'].includes(stage))
  return {kind:'ISSUE860_BACKUP_DIAGNOSTIC_BUSY_SKIPPED',
   reason:'PORTFOLIO_WRITER_ACTIVE',financeWrites:0,gasDeployments:0};
 // Exactly one slow read: the existing GAS workbook API computes formula
 // reference counts and registered backup digests. Never retry on timeout.
 const payload=await request({url:endpoint,token,action:'diagnoseWorkbookCells',
  fetchImpl,timeoutMs:295000});
 return summarizeRecentBackupEvidence(payload);
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
 try{
  const out=await run({url:process.env.GAS_WEB_APP_URL,
   token:process.env.GAS_ACCESS_TOKEN});
  console.log(JSON.stringify(out));
 }catch(e){
  const code=String(e?.message||'ISSUE860_READONLY_UNKNOWN');
  console.error(/^ISSUE860_READONLY_[A-Z0-9_]+$/.test(code)?code:'ISSUE860_READONLY_UNVERIFIED');
  process.exitCode=1;
 }
}
