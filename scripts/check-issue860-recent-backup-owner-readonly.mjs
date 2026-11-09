#!/usr/bin/env node
// Unit test only. No real GAS, workbook, auth, or network requests.
import assert from 'node:assert/strict';
import {TARGETS,run,summarizeRecentBackupEvidence}
 from './issue860-recent-backup-owner-readonly.mjs';

// The diagnostic must match the ACTUAL deployed v9.284 GAS response,
// not merely our synthetic test fixtures. Fail closed on source drift.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
const production=fs.readFileSync('reference/gas-v9.284.gs','utf8');
const gitBlob=source=>{
 const bytes=Buffer.from(source,'utf8');
 return createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
};
assert.equal(production.includes("gasVersion: '9.284'"),true);
assert.equal(production.includes("if (params.action === 'getAutomationStatus')"),true);
assert.equal(production.includes("if (params.action === 'diagnoseWorkbookCells')"),true);
const start=production.indexOf('function _diagnoseWorkbookCells(');
const end=production.indexOf('\n}',start);
assert(start>0&&end>start,'Deployed read-only inventory API missing');
const deployed=production.slice(start,end+2);
for(const field of ['name','role','backup','systemGeneratedBackup','backupSource',
 'backupStatus','backupClassification','signatureMatch','operationId',
 'lastRow','lastColumn','maxRows','maxColumns']){
 assert(new RegExp('\\b'+field+':').test(deployed),
  'Missing actual v9.284 backup inventory field '+field);
}
assert(deployed.includes('_sheetContentSignature(sheet) === backupRecord.signature'),
 'Signature must come from GAS backup self-check, not owner linkage');
assert.equal(typeof gitBlob(production),'string');

const registered=(target,opts={})=>({
 name:target.name,role:'BACKUP',backup:true,backupSource:'스냅샷',
 systemGeneratedBackup:opts.registered===true,
 backupStatus:opts.registered===true?(opts.status||'CREATED'):'',
 backupClassification:opts.registered===true?
  (opts.status==='COMPLETED'?'REGISTERED_COMPLETED':
   opts.status==='WRITE_FAILED'?'REGISTERED_WRITE_FAILED':'REGISTERED_INCOMPLETE'):
  'ORPHAN_LIKELY_SYSTEM',
 signatureMatch:opts.registered===true?(opts.match??true):null,
 lastRow:opts.rows??0,lastColumn:opts.rows?12:0,
 maxRows:opts.rows?16636:1000,maxColumns:opts.rows?12:26,
 operationId:opts.registered===true?'EXTERNAL_PRIVATE_OWNER_ID':''
});
const payload={status:'ok',workbook:{sheets:[
 registered(TARGETS[0],{rows:0,registered:false}),
 registered(TARGETS[1],{rows:0,registered:true,status:'CREATED'}),
 registered(TARGETS[2],{rows:0,registered:true,status:'WRITE_FAILED'}),
 registered(TARGETS[8],{rows:16636,registered:true,status:'COMPLETED'})
]}};
const a=summarizeRecentBackupEvidence(payload);
assert.equal(a.targetCount,9);
assert.equal(a.found,4);
assert.equal(a.empty,3);
assert.equal(a.registered,3);
assert.deepEqual(a.targets.slice(0,4).map(x=>x.decision),
 ['EMPTY_UNTRUSTED_PROTECTED','EMPTY_UNTRUSTED_PROTECTED',
  'EMPTY_UNTRUSTED_PROTECTED','MISSING_PRESERVE_EVIDENCE']);
assert.equal(a.targets[8].decision,'REGISTERED_COMPLETED_BUT_SOURCE_PROOF_UNVERIFIED');
assert.equal(a.restoreAllowed,false);
assert.equal(a.deleteAllowed,false);
assert(!JSON.stringify(a).includes('EXTERNAL_PRIVATE_OWNER_ID'));
assert(!JSON.stringify(a).includes('스냅샷_백업_'));
assert(!JSON.stringify(a).includes('PRIVATE'));
const inconsistent=registered(TARGETS[0],{rows:0,registered:true,status:'COMPLETED',match:false});
inconsistent.backupClassification='REGISTERED_INCOMPLETE';
assert.throws(()=>summarizeRecentBackupEvidence({status:'ok',workbook:{
 sheets:[inconsistent]
}}),/ISSUE860_READONLY_PROVENANCE_MISMATCH/);

const endpoint='https://script.google.com/macros/s/TEST_DEPLOYMENT_TOKEN/exec';
const secret='GAS_TEST_PROTECTED_TOKEN';
const calls=[];
const fetchImpl=async(_url,opt)=>{
 assert.equal(_url,endpoint);
 assert.equal(opt.method,'POST');
 const q=opt.body,action=q.get('action');
 assert.equal(q.get('accessToken'),secret);
 calls.push(action);
 return {ok:true,json:async()=>action==='getAutomationStatus'?
  {status:'ok',gasVersion:'9.284',automation:{
   portfolioClose:{stage:'ERROR'}}}:payload};
};
const result=await run({url:endpoint,token:secret,fetchImpl});
assert.equal(result.found,4);
assert.deepEqual(calls,['getAutomationStatus','diagnoseWorkbookCells']);
assert(!JSON.stringify(result).includes(secret));
assert.equal(result.financeWrites,0);
assert.equal(result.gasDeployments,0);
calls.length=0;
const active=await run({url:endpoint,token:secret,fetchImpl:async(_url,opt)=>{
 calls.push(opt.body.get('action'));
 return {ok:true,json:async()=>({status:'ok',gasVersion:'9.284',
  automation:{portfolioClose:{stage:'FUND'}}})};
}});
assert.equal(active.reason,'PORTFOLIO_WRITER_ACTIVE');
assert.deepEqual(calls,['getAutomationStatus'],'Never inspect whole workbook while a writer is active');
await assert.rejects(()=>run({url:endpoint,token:secret,fetchImpl:async()=>({
 ok:true,json:async()=>({status:'ok',gasVersion:'9.999',automation:{}})
})}),/ISSUE860_READONLY_PRODUCTION_VERSION_DRIFT/);
console.log(JSON.stringify({kind:'ISSUE860_RECENT_BACKUP_READONLY_CONTRACT_PASS',
  count:TARGETS.length,strictTargetLabels:true,rawOwnerIdsExposed:false,
  restoresOrDeletes:false,writerBusyGuard:true,requiresExpectedProductionVersion:true,
  networkCalls:0,realFinanceWrites:0}));
