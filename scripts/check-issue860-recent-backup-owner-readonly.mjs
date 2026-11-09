#!/usr/bin/env node
// Unit test only. No real GAS, workbook, auth, or network requests.
import assert from 'node:assert/strict';
import {TARGETS,run,summarizeRecentBackupEvidence}
 from './issue860-recent-backup-owner-readonly.mjs';

// The diagnostic must match the ACTUAL deployed v9.284 GAS response,
// not merely our synthetic test fixtures. Fail closed on source drift.
import fs from 'node:fs';
import {composeFundSnapshot9287SourcePreview} from './compose-fund-snapshot-9287-source-preview.mjs';
import {composeGas9288TradeV2From9287Preview} from './compose-gas9288-trade-v2-from-9287-preview.mjs';
const production=fs.readFileSync('reference/gas-v9.284.gs','utf8');
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
for(const {version,source} of [
 {version:'9.287',source:composeFundSnapshot9287SourcePreview().candidate},
 {version:'9.288',source:composeGas9288TradeV2From9287Preview().candidate}
]){
 assert(source.includes("var ISSUE507_GATE_API_VERSION='"+version+"'"));
 assert(source.includes("if (params.action === 'diagnoseWorkbookCells')"));
 const begin=source.indexOf('function _diagnoseWorkbookCells('),end=source.indexOf('\n}',begin);
 assert(begin>=0&&end>begin,'missing '+version+' inventory');
 const live=source.slice(begin,end+2);
 for(const field of ['name','role','backup','systemGeneratedBackup','backupSource',
  'backupStatus','backupClassification','signatureMatch','operationId',
  'lastRow','lastColumn','maxRows','maxColumns'])
  assert(new RegExp('\\b'+field+':').test(live),'missing '+version+' '+field);
 assert(live.includes('_sheetContentSignature(sheet) === backupRecord.signature'),
  'verified live 9.287/9.288 backup digest');
}

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
  {status:'ok',gasVersion:'9.287',automation:{gasVersion:'9.287',
   portfolioClose:{stage:'COMPLETE'},fundAttempt:{state:'DONE'}}}:payload};
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
 return {ok:true,json:async()=>({status:'ok',gasVersion:'9.287',
  automation:{gasVersion:'9.287',portfolioClose:{stage:'FUND'}}})};
}});
assert.equal(active.reason,'PORTFOLIO_WRITER_ACTIVE');
assert.deepEqual(calls,['getAutomationStatus'],'Never inspect whole workbook while a writer is active');
for(const version of ['9.284','9.288']){
 const observed=await run({url:endpoint,token:secret,fetchImpl:async(_url,opt)=>({
  ok:true,json:async()=>opt.body.get('action')==='getAutomationStatus'
   ?{status:'ok',gasVersion:version,automation:{gasVersion:version,
     portfolioClose:{stage:'COMPLETE'},fundAttempt:{state:'DONE'}}}:payload
 })});
 assert.equal(observed.found,4,'Known GAS version permits inventory: '+version);
}
for(const stage of ['START','STARTED','IN_PROGRESS','FUND_PENDING','BACKUP','NAV_WRITE']){
 const actions=[];
 const blocked=await run({url:endpoint,token:secret,fetchImpl:async(_url,opt)=>{
  actions.push(opt.body.get('action'));
  return {ok:true,json:async()=>({status:'ok',gasVersion:'9.287',
   automation:{gasVersion:'9.287',portfolioClose:{stage}}})};
 }});
 assert.equal(blocked.reason,'PORTFOLIO_WRITER_ACTIVE',stage);
 assert.deepEqual(actions,['getAutomationStatus']);
}
for(const state of ['IN_PROGRESS','RETRYING']){
 const actions=[];
 const blocked=await run({url:endpoint,token:secret,fetchImpl:async(_url,opt)=>{
  actions.push(opt.body.get('action'));
  return {ok:true,json:async()=>({status:'ok',gasVersion:'9.287',
   automation:{gasVersion:'9.287',portfolioClose:{stage:'COMPLETE'},
    fundAttempt:{state}}})};
 }});
 assert.equal(blocked.reason,'PORTFOLIO_WRITER_ACTIVE');
 assert.deepEqual(actions,['getAutomationStatus']);
}
for(const [outer,inner] of [['9.289','9.289'],['9.287','9.288'],['9.999','9.999']])
 await assert.rejects(()=>run({url:endpoint,token:secret,fetchImpl:async()=>({
  ok:true,json:async()=>({status:'ok',gasVersion:outer,
   automation:{gasVersion:inner,portfolioClose:{stage:'COMPLETE'}}})
 })}),/ISSUE860_READONLY_PRODUCTION_VERSION_DRIFT/);
await assert.rejects(()=>run({url:endpoint,token:secret,fetchImpl:async()=>({
 ok:true,json:async()=>({status:'ok',gasVersion:'9.999',automation:{}})
})}),/ISSUE860_READONLY_PRODUCTION_VERSION_DRIFT/);
// One-shot transport errors must be classified without leaking exception text,
// endpoint, token, or mistaking a STATUS timeout for an INVENTORY timeout.
for(const [errorName,expected] of [
 ['TimeoutError','TIMEOUT_STATUS'],['AbortError','TIMEOUT_STATUS'],
 ['Error','NETWORK_STATUS']
]){
 let count=0;
 await assert.rejects(()=>run({url:endpoint,token:secret,fetchImpl:async()=>{
  count++;
  throw Object.assign(new Error('DO_NOT_EXPOSE_PRIVATE_REQUEST'),{name:errorName});
 }}),new RegExp('ISSUE860_READONLY_'+expected));
 assert.equal(count,1,'Never retry live status after transport failure');
}
let inventoryRequests=0;
await assert.rejects(()=>run({url:endpoint,token:secret,fetchImpl:async(_url,opt)=>{
 inventoryRequests++;
 if(opt.body.get('action')==='getAutomationStatus')
  return {ok:true,json:async()=>({status:'ok',gasVersion:'9.287',automation:{gasVersion:'9.287',
   portfolioClose:{stage:'COMPLETE'},fundAttempt:{state:'DONE'}}})};
 throw Object.assign(new Error('DO_NOT_EXPOSE_PRIVATE_RESPONSE'),{name:'TimeoutError'});
}}),/ISSUE860_READONLY_TIMEOUT_INVENTORY/);
assert.equal(inventoryRequests,2,'Only one inventory request following a status check');
await assert.rejects(()=>run({url:endpoint,token:secret,fetchImpl:async()=>({
 ok:true,json:async()=>{throw Error('DO_NOT_EXPOSE_PRIVATE_RESPONSE');}
})}),/ISSUE860_READONLY_JSON_STATUS/);

console.log(JSON.stringify({kind:'ISSUE860_RECENT_BACKUP_READONLY_CONTRACT_PASS',
  count:TARGETS.length,strictTargetLabels:true,rawOwnerIdsExposed:false,
  currentVersions:['9.287','9.288'],unexpectedVersionBlocked:true,
  restoresOrDeletes:false,writerBusyGuard:true,requiresExpectedProductionVersion:true,
  networkCalls:0,realFinanceWrites:0}));
